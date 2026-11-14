#!/usr/bin/env bash
set -euo pipefail

MODE=full
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--database-only" ]; }; then
    echo "Nutzung: $0 [--database-only]" >&2
    exit 2
fi
if [ "$#" -eq 1 ]; then
    MODE=database-only
fi
S3_BACKEND="${RESTORE_TEST_S3_BACKEND:-minio}"
if [ "$MODE" = full ] && [ "$S3_BACKEND" != minio ] && [ "$S3_BACKEND" != seaweedfs ]; then
    echo "Fehler: RESTORE_TEST_S3_BACKEND muss 'minio' oder 'seaweedfs' sein." >&2
    exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="secops-restore-test-$(date +%Y%m%d%H%M%S)-$$"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
ENV_FILE="$TEMP_DIR/.env.restore-test"
BACKUP_DIR="$TEMP_DIR/backups"
TEST_DATA_DIR="$TEMP_DIR/test-data"
STACK_STARTED=0

mkdir -p "$BACKUP_DIR" "$TEST_DATA_DIR"

compose() {
    docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" \
        -f "$SCRIPT_DIR/docker-compose.minio.yml" \
        -f "$SCRIPT_DIR/docker-compose.backup-restore-test.yml" "$@"
}

report_resources() {
    echo "Containers ($PROJECT):"
    docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
        --format '{{.ID}} {{.Names}} {{.Status}}'
    echo "Volumes ($PROJECT):"
    docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}'
    echo "Networks ($PROJECT):"
    docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}'
}

project_resources_exist() {
    if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
        docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
        docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q .; then
        return 0
    fi
    for service in db minio minio-create-bucket restore-test-mc backup clamav seaweedfs; do
        if docker container inspect "$PROJECT-$service-1" >/dev/null 2>&1; then
            return 0
        fi
    done
    for volume in restore_test_pgdata minio_data clamav_data; do
        if docker volume inspect "${PROJECT}_$volume" >/dev/null 2>&1; then
            return 0
        fi
    done
    docker network inspect "${PROJECT}_default" >/dev/null 2>&1
}

cleanup() {
    local result=$?
    trap - EXIT
    if [ "$STACK_STARTED" -eq 1 ]; then
        echo "[TEST] Ressourcen vor dem gezielten Cleanup:"
        report_resources
        if ! compose down --volumes --remove-orphans; then
            echo "[TEST] FEHLER: Compose-Cleanup für '$PROJECT' fehlgeschlagen." >&2
            result=1
        fi
        if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
            docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
            docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q .; then
            echo "[TEST] FEHLER: Ressourcen des Testprojekts '$PROJECT' sind übrig geblieben." >&2
            report_resources
            result=1
        else
            echo "[TEST] Cleanup verifiziert: keine Container, Volumes oder Netzwerke für '$PROJECT'."
        fi
    fi
    rm -rf -- "$TEMP_DIR"
    exit "$result"
}
trap cleanup EXIT

for command_name in docker openssl python3 shasum; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Fehler: '$command_name' wird für den Restore-Test benötigt." >&2
        exit 1
    fi
done
docker info >/dev/null

if project_resources_exist; then
    echo "Fehler: Das eindeutige Testprojekt '$PROJECT' existiert bereits; es wird nichts verändert." >&2
    exit 1
fi

free_port() {
    python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}

POSTGRES_DB=restore_test
POSTGRES_USER=restore_test_admin
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
BACKUP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
MINIO_ROOT_USER=restoretest
MINIO_ROOT_PASSWORD="$(openssl rand -hex 24)"
RESTORE_TEST_S3_ACCESS_KEY="$(openssl rand -hex 16)"
RESTORE_TEST_S3_SECRET_KEY="$(openssl rand -hex 32)"
DMS_S3_REGION=us-east-1
DMS_S3_BUCKET="restore-source-${PROJECT#secops-restore-test-}"
DMS_S3_FORCE_PATH_STYLE=true
MINIO_API_PORT="$(free_port)"
MINIO_CONSOLE_PORT="$(free_port)"
RESTORE_TEST_TMPDIR="$TEMP_DIR"
RESTORE_TEST_BACKUP_IMAGE="${RESTORE_TEST_BACKUP_IMAGE:-postgres:16-bookworm}"
RESTORE_TEST_MINIO_IMAGE="${RESTORE_TEST_MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-02-07T23-21-09Z}"
RESTORE_TEST_MC_IMAGE="${RESTORE_TEST_MC_IMAGE:-quay.io/minio/mc:RELEASE.2025-02-08T19-14-21Z}"
RESTORE_TEST_S3_IMAGE="${RESTORE_TEST_S3_IMAGE:-chrislusf/seaweedfs:latest}"
if [ "$S3_BACKEND" = minio ]; then
    S3_SERVICE=minio
    DMS_S3_ENDPOINT=http://minio:9000
    DMS_S3_ACCESS_KEY="$MINIO_ROOT_USER"
    DMS_S3_SECRET_KEY="$MINIO_ROOT_PASSWORD"
    RESTORE_TEST_S3_ACCESS_KEY="$MINIO_ROOT_USER"
    RESTORE_TEST_S3_SECRET_KEY="$MINIO_ROOT_PASSWORD"
else
    S3_SERVICE=seaweedfs
    DMS_S3_ENDPOINT=http://seaweedfs:8333
    DMS_S3_ACCESS_KEY="$RESTORE_TEST_S3_ACCESS_KEY"
    DMS_S3_SECRET_KEY="$RESTORE_TEST_S3_SECRET_KEY"
    python3 - "$TEMP_DIR/seaweedfs-s3.json" "$RESTORE_TEST_S3_ACCESS_KEY" "$RESTORE_TEST_S3_SECRET_KEY" <<'PY'
import json
import sys

with open(sys.argv[1], "w", encoding="utf-8") as config:
    json.dump(
        {
            "identities": [
                {
                    "name": "restore-test",
                    "credentials": [
                        {
                            "accessKey": sys.argv[2],
                            "secretKey": sys.argv[3],
                        }
                    ],
                    "actions": ["Read", "Write", "List", "Tagging", "Admin"],
                }
            ]
        },
        config,
    )
PY
    chmod 600 "$TEMP_DIR/seaweedfs-s3.json"
fi

cat > "$ENV_FILE" <<EOF
POSTGRES_DB=$POSTGRES_DB
POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
BACKUP_ENCRYPTION_KEY=$BACKUP_ENCRYPTION_KEY
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
DMS_S3_REGION=$DMS_S3_REGION
DMS_S3_ENDPOINT=$DMS_S3_ENDPOINT
DMS_S3_BUCKET=$DMS_S3_BUCKET
DMS_S3_ACCESS_KEY=$DMS_S3_ACCESS_KEY
DMS_S3_SECRET_KEY=$DMS_S3_SECRET_KEY
DMS_S3_FORCE_PATH_STYLE=$DMS_S3_FORCE_PATH_STYLE
RESTORE_TEST_S3_BACKEND=$S3_BACKEND
RESTORE_TEST_S3_ACCESS_KEY=$RESTORE_TEST_S3_ACCESS_KEY
RESTORE_TEST_S3_SECRET_KEY=$RESTORE_TEST_S3_SECRET_KEY
RESTORE_TEST_S3_IMAGE=$RESTORE_TEST_S3_IMAGE
MINIO_API_PORT=$MINIO_API_PORT
MINIO_CONSOLE_PORT=$MINIO_CONSOLE_PORT
RESTORE_TEST_TMPDIR="$RESTORE_TEST_TMPDIR"
RESTORE_TEST_DATA_DIR="$TEST_DATA_DIR"
RESTORE_TEST_BACKUP_IMAGE=$RESTORE_TEST_BACKUP_IMAGE
RESTORE_TEST_MINIO_IMAGE=$RESTORE_TEST_MINIO_IMAGE
RESTORE_TEST_MC_IMAGE=$RESTORE_TEST_MC_IMAGE
EOF
chmod 600 "$ENV_FILE"

TEST_SUFFIX="${PROJECT#secops-restore-test-}"
SOURCE_BUCKET="restore-source-$TEST_SUFFIX"
SNAPSHOT_BUCKET="restore-snapshot-$TEST_SUFFIX"
DOCUMENT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
OBJECT_KEY="documents/$DOCUMENT_ID.txt"
FIXTURE="$TEST_DATA_DIR/document.txt"
printf 'SecurityOps isolated DMS restore test: %s\n' "$DOCUMENT_ID" > "$FIXTURE"
EXPECTED_SHA256="$(shasum -a 256 "$FIXTURE" | awk '{print $1}')"

assert_mc_bind_mount_isolation() {
    local container actual_mount expected_mount
    container="$(compose ps -q restore-test-mc)"
    if [ -z "$container" ]; then
        echo "Fehler: Der Test-MC-Container wurde nicht erstellt." >&2
        exit 1
    fi
    actual_mount="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}|{{.Destination}}|{{.RW}}{{"\n"}}{{end}}{{end}}' "$container")"
    expected_mount="$TEST_DATA_DIR|/test-data|false"
    if [ "$actual_mount" != "$expected_mount" ]; then
        echo "Fehler: Der Test-MC-Container darf nur das schreibgeschützte Testdatenverzeichnis vom Host einbinden." >&2
        echo "Erwartet: $expected_mount" >&2
        echo "Erhalten: $actual_mount" >&2
        exit 1
    fi
    echo "[TEST] MC-Mount-Isolation verifiziert: nur das schreibgeschützte Testdatenverzeichnis ist vom Host eingebunden."
}

export RESTORE_ENV_FILE="$ENV_FILE"
RESTORE_COMPOSE_FILES="$SCRIPT_DIR/docker-compose.minio.yml
$SCRIPT_DIR/docker-compose.backup-restore-test.yml"
export RESTORE_COMPOSE_FILES
export RESTORE_COMPOSE_PROJECT="$PROJECT"
export RESTORE_DB_SERVICE=db
export RESTORE_DB_USER="$POSTGRES_USER"
export RESTORE_QUIESCE_SERVICES=""
export RESTORE_RESUME_SERVICES=""

echo "[TEST] Projekt: $PROJECT"
if [ "$MODE" = full ]; then
    echo "[TEST] Starte ausschließlich db, $S3_SERVICE und den Test-MC-Container; ClamAV bleibt ungestartet."
else
    echo "[TEST] Starte ausschließlich den PostgreSQL-Container; MinIO und ClamAV bleiben ungestartet."
fi
STACK_STARTED=1
if [ "$MODE" = full ]; then
    compose up -d db "$S3_SERVICE" restore-test-mc
    assert_mc_bind_mount_isolation
else
    compose up -d db
fi

DB_CONTAINER="$(compose ps -q db)"
if [ -z "$DB_CONTAINER" ]; then
    echo "Fehler: Der Test-PostgreSQL-Container wurde nicht erstellt." >&2
    exit 1
fi
for _ in $(seq 1 60); do
    DB_HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$DB_CONTAINER")"
    if [ "$DB_HEALTH" = healthy ]; then
        break
    fi
    sleep 2
done
if [ "$DB_HEALTH" != healthy ]; then
    echo "Fehler: Test-PostgreSQL wurde nicht healthy (Status: $DB_HEALTH)." >&2
    exit 1
fi

if [ "$MODE" = full ]; then
    S3_READY=0
    for _ in $(seq 1 60); do
        if compose exec -T restore-test-mc mc alias set local "$DMS_S3_ENDPOINT" \
            "$DMS_S3_ACCESS_KEY" "$DMS_S3_SECRET_KEY" >/dev/null 2>&1; then
            S3_READY=1
            break
        fi
        sleep 2
    done
    if [ "$S3_READY" -ne 1 ]; then
        echo "Fehler: S3-Testdienst '$S3_SERVICE' wurde nicht bereit." >&2
        S3_CONTAINER="$(compose ps -aq "$S3_SERVICE")"
        if [ -n "$S3_CONTAINER" ]; then
            docker logs "$S3_CONTAINER" >&2
        fi
        exit 1
    fi
    compose exec -T restore-test-mc mc mb "local/$SOURCE_BUCKET"
    compose exec -T restore-test-mc mc mb "local/$SNAPSHOT_BUCKET"
    if [ "$S3_BACKEND" = minio ]; then
        compose exec -T restore-test-mc mc anonymous set none "local/$SOURCE_BUCKET"
        compose exec -T restore-test-mc mc anonymous set none "local/$SNAPSHOT_BUCKET"
    fi
    compose exec -T restore-test-mc mc cp \
        --attr "Content-Type=text/plain;X-Amz-Meta-Document-Id=$DOCUMENT_ID;X-Amz-Meta-Checksum=$EXPECTED_SHA256" \
        /test-data/document.txt "local/$SOURCE_BUCKET/$OBJECT_KEY"
fi

compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE TABLE restore_test_documents (
    document_id UUID PRIMARY KEY,
    storage_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content_type TEXT NOT NULL,
    sha256 TEXT NOT NULL
);
INSERT INTO restore_test_documents
    (document_id, storage_key, title, content_type, sha256)
VALUES
    ('$DOCUMENT_ID', '$OBJECT_KEY', 'Restore baseline', 'text/plain', '$EXPECTED_SHA256');
SQL

echo "[TEST] Erzeuge verschlüsseltes PostgreSQL-Backup mit backup_cron.sh."
compose up -d backup
BACKUP_CONTAINER="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" \
    --filter 'label=com.docker.compose.service=backup' | head -n 1)"
if [ -z "$BACKUP_CONTAINER" ]; then
    echo "Fehler: Der Test-Backup-Container wurde nicht erstellt." >&2
    exit 1
fi
BACKUP_EXIT_CODE="$(docker wait "$BACKUP_CONTAINER")"
docker logs "$BACKUP_CONTAINER"
if [ "$BACKUP_EXIT_CODE" != 0 ]; then
    echo "Fehler: backup_cron.sh endete mit Status $BACKUP_EXIT_CODE." >&2
    exit 1
fi
ARCHIVE_COUNT="$(find "$BACKUP_DIR" -type f -name 'secops_backup_*.tar.gz.enc' | wc -l | tr -d ' ')"
if [ "$ARCHIVE_COUNT" != 1 ]; then
    echo "Fehler: Erwartete genau ein verschlüsseltes Archiv, gefunden: $ARCHIVE_COUNT." >&2
    exit 1
fi
BACKUP_ARCHIVE="$(find "$BACKUP_DIR" -type f -name 'secops_backup_*.tar.gz.enc' -print)"

if [ "$MODE" = full ]; then
    echo "[TEST] Erstelle getrennten $S3_BACKEND-Snapshot und entferne das Quellobjekt."
    compose exec -T restore-test-mc mc mirror --preserve \
        "local/$SOURCE_BUCKET/" "local/$SNAPSHOT_BUCKET/"
    compose exec -T restore-test-mc mc rm "local/$SOURCE_BUCKET/$OBJECT_KEY"
    if compose exec -T restore-test-mc mc stat "local/$SOURCE_BUCKET/$OBJECT_KEY" >/dev/null 2>&1; then
        echo "Fehler: Das Quellobjekt wurde vor dem Restore nicht entfernt." >&2
        exit 1
    fi
    compose exec -T restore-test-mc mc mirror --preserve \
        "local/$SNAPSHOT_BUCKET/" "local/$SOURCE_BUCKET/"
fi

compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "UPDATE restore_test_documents SET title = 'Mutated after backup' WHERE document_id = '$DOCUMENT_ID';"

echo "[TEST] Stelle PostgreSQL-Backup mit restore.sh im isolierten Compose-Projekt wieder her."
"$SCRIPT_DIR/restore.sh" "$BACKUP_ARCHIVE"

RESTORED_ROW="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT storage_key || '|' || title || '|' || content_type || '|' || sha256 FROM restore_test_documents WHERE document_id = '$DOCUMENT_ID';")"
EXPECTED_ROW="$OBJECT_KEY|Restore baseline|text/plain|$EXPECTED_SHA256"
if [ "$RESTORED_ROW" != "$EXPECTED_ROW" ]; then
    echo "Fehler: Wiederhergestellte Datenbankmetadaten stimmen nicht überein." >&2
    echo "Erwartet: $EXPECTED_ROW" >&2
    echo "Erhalten: $RESTORED_ROW" >&2
    exit 1
fi

if [ "$MODE" = full ]; then
    compose exec -T restore-test-mc mc cat \
        "local/$SOURCE_BUCKET/$OBJECT_KEY" > "$TEMP_DIR/restored-document.txt"
    RESTORED_SHA256="$(shasum -a 256 "$TEMP_DIR/restored-document.txt" | awk '{print $1}')"
    if [ "$RESTORED_SHA256" != "$EXPECTED_SHA256" ]; then
        echo "Fehler: SHA-256 des wiederhergestellten DMS-Objekts stimmt nicht überein." >&2
        exit 1
    fi
    compose exec -T restore-test-mc mc stat --json \
        "local/$SOURCE_BUCKET/$OBJECT_KEY" > "$TEMP_DIR/restored-object.json"
    python3 - "$TEMP_DIR/restored-object.json" "$DOCUMENT_ID" "$EXPECTED_SHA256" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stat_file:
    stat = json.load(stat_file)
metadata = {key.lower(): str(value) for key, value in stat.get("metadata", {}).items()}
expected = {
    "x-amz-meta-document-id": sys.argv[2],
    "x-amz-meta-checksum": sys.argv[3],
}
missing = [key for key, value in expected.items() if metadata.get(key) != value]
if missing:
    raise SystemExit(f"Restored object metadata mismatch: {', '.join(missing)}")
PY
    echo "[TEST] PASS: DB-Zeile, Objekt-SHA-256 ($RESTORED_SHA256) und $S3_BACKEND-Objektmetadaten stimmen."
else
    echo "[TEST] PASS: Verschlüsseltes PostgreSQL-Backup und Datenbankmetadaten wurden wiederhergestellt."
    echo "[TEST] MinIO-Objekte und ClamAV wurden in diesem Modus nicht getestet."
fi
echo "[TEST] ClamAV: nicht gestartet und daher in diesem Restore-Test nicht verifiziert."
