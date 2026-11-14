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

bounded_run() {
    python3 - "$1" "${@:2}" <<'PY'
import subprocess
import sys

try:
    subprocess.run(sys.argv[2:], check=True, timeout=int(sys.argv[1]))
except subprocess.TimeoutExpired:
    print(f"[TEST] FEHLER: Befehl nach {sys.argv[1]} Sekunden abgebrochen.", file=sys.stderr)
    raise SystemExit(124)
PY
}

report_resources() {
    echo "Containers ($PROJECT):"
    docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
        --format '{{.ID}} {{.Names}} {{.Status}}'
    echo "Volumes ($PROJECT):"
    docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}'
    echo "Networks ($PROJECT):"
    docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}'
    echo "Migration image ($PROJECT):"
    docker image ls --filter "reference=$PROJECT-restore-test-migrate:latest" --format '{{.Repository}}:{{.Tag}}'
}

project_resources_exist() {
    if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
        docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
        docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q .; then
        return 0
    fi
    if docker image inspect "$PROJECT-restore-test-migrate:latest" >/dev/null 2>&1; then
        return 0
    fi
    for service in db minio minio-create-bucket restore-test-mc restore-test-migrate backup clamav seaweedfs; do
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
        if ! bounded_run 120 docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" \
            -f "$SCRIPT_DIR/docker-compose.minio.yml" \
            -f "$SCRIPT_DIR/docker-compose.backup-restore-test.yml" down --volumes --remove-orphans; then
            echo "[TEST] FEHLER: Compose-Cleanup für '$PROJECT' fehlgeschlagen." >&2
            result=1
        fi
        if docker image inspect "$PROJECT-restore-test-migrate:latest" >/dev/null 2>&1 &&
            ! bounded_run 120 docker image rm "$PROJECT-restore-test-migrate:latest"; then
            echo "[TEST] FEHLER: Das projektspezifische Migrationsimage konnte nicht entfernt werden." >&2
            result=1
        fi
        if docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
            docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
            docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" | grep -q . ||
            docker image inspect "$PROJECT-restore-test-migrate:latest" >/dev/null 2>&1; then
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
RESTORE_TEST_JWT_SECRET="$(openssl rand -hex 32)"
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
RESTORE_TEST_JWT_SECRET=$RESTORE_TEST_JWT_SECRET
EOF
chmod 600 "$ENV_FILE"

TEST_SUFFIX="${PROJECT#secops-restore-test-}"
SOURCE_BUCKET="restore-source-$TEST_SUFFIX"
SNAPSHOT_BUCKET="restore-snapshot-$TEST_SUFFIX"
TENANT_A_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
TENANT_B_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
USER_A_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
USER_B_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
DOCUMENT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
DOCUMENT_B_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
AUDIT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
AUDIT_B_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
CROSS_AUDIT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
OBJECT_KEY="quarantine/$DOCUMENT_ID"
OBJECT_KEY_B="quarantine/$DOCUMENT_B_ID"
FIXTURE="$TEST_DATA_DIR/document-a.txt"
FIXTURE_B="$TEST_DATA_DIR/document-b.txt"
printf 'SecurityOps isolated DMS restore test: %s\n' "$DOCUMENT_ID" > "$FIXTURE"
printf 'SecurityOps isolated DMS tenant isolation test: %s\n' "$DOCUMENT_B_ID" > "$FIXTURE_B"
EXPECTED_SHA256="$(shasum -a 256 "$FIXTURE" | awk '{print $1}')"
EXPECTED_SHA256_B="$(shasum -a 256 "$FIXTURE_B" | awk '{print $1}')"
EXPECTED_SIZE="$(wc -c < "$FIXTURE" | tr -d ' ')"
EXPECTED_SIZE_B="$(wc -c < "$FIXTURE_B" | tr -d ' ')"

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

EXPECTED_MIGRATIONS="001,002,003,004,005,006,007,009,011,012,013,014,015,016,017,018,019,020,021,022,023,024,025,026,027,028,029,030,031,032,033,034,035,036"
echo "[TEST] Führe die Repository-Migrationen in der isolierten Testdatenbank aus."
bounded_run 600 docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" \
    -f "$SCRIPT_DIR/docker-compose.minio.yml" \
    -f "$SCRIPT_DIR/docker-compose.backup-restore-test.yml" \
    run --build --rm restore-test-migrate
MIGRATION_HISTORY="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations;")"
if [ "$MIGRATION_HISTORY" != "$EXPECTED_MIGRATIONS" ]; then
    echo "Fehler: Migrationshistorie stimmt nicht mit dem erwarteten Repository-Stand überein." >&2
    echo "Erwartet: $EXPECTED_MIGRATIONS" >&2
    echo "Erhalten: $MIGRATION_HISTORY" >&2
    exit 1
fi
DMS_RLS_COUNT="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace
        AND relname = ANY(ARRAY['document_categories', 'document_folders', 'documents',
            'document_versions', 'document_relationships', 'document_tags',
            'document_tag_assignments', 'document_audit_events',
            'document_storage_deletion_outbox'])
        AND relrowsecurity AND relforcerowsecurity;")"
if [ "$DMS_RLS_COUNT" != 9 ]; then
    echo "Fehler: ENABLE/FORCE ROW LEVEL SECURITY wurde nicht auf allen neun DMS-Tabellen gefunden (Anzahl: $DMS_RLS_COUNT)." >&2
    exit 1
fi
echo "[TEST] Migrationen verifiziert: $EXPECTED_MIGRATIONS; ENABLE/FORCE RLS auf 9 DMS-Tabellen."

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
        /test-data/document-a.txt "local/$SOURCE_BUCKET/$OBJECT_KEY"
    compose exec -T restore-test-mc mc cp \
        --attr "Content-Type=text/plain;X-Amz-Meta-Document-Id=$DOCUMENT_B_ID;X-Amz-Meta-Checksum=$EXPECTED_SHA256_B" \
        /test-data/document-b.txt "local/$SOURCE_BUCKET/$OBJECT_KEY_B"
fi

compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
INSERT INTO tenants (id, name, subdomain, tax_number, bwr_register_id)
VALUES
    ('$TENANT_A_ID', 'Restore test tenant A', 'restore-a-$TEST_SUFFIX', 'TEST-A', 'TEST-REG-A'),
    ('$TENANT_B_ID', 'Restore test tenant B', 'restore-b-$TEST_SUFFIX', 'TEST-B', 'TEST-REG-B');
INSERT INTO users (id, email, password_hash, first_name, last_name)
VALUES
    ('$USER_A_ID', 'restore-a-$TEST_SUFFIX@example.invalid', 'test-only-not-a-password-hash', 'Restore', 'Tenant A'),
    ('$USER_B_ID', 'restore-b-$TEST_SUFFIX@example.invalid', 'test-only-not-a-password-hash', 'Restore', 'Tenant B');
INSERT INTO document_categories (id, tenant_id, name, created_by)
VALUES
    ('$TENANT_A_ID', '$TENANT_A_ID', 'Restore test category A', '$USER_A_ID'),
    ('$TENANT_B_ID', '$TENANT_B_ID', 'Restore test category B', '$USER_B_ID');
INSERT INTO documents (id, tenant_id, title, category_id, document_number, current_version, created_by)
VALUES
    ('$DOCUMENT_ID', '$TENANT_A_ID', 'Restore baseline A', '$TENANT_A_ID', 'RESTORE-A-$TEST_SUFFIX', 1, '$USER_A_ID'),
    ('$DOCUMENT_B_ID', '$TENANT_B_ID', 'Restore baseline B', '$TENANT_B_ID', 'RESTORE-B-$TEST_SUFFIX', 1, '$USER_B_ID');
INSERT INTO document_versions
    (tenant_id, document_id, version_number, original_filename, storage_key, content_type,
     size_bytes, sha256_hash, scan_status, created_by)
VALUES
    ('$TENANT_A_ID', '$DOCUMENT_ID', 1, 'document-a.txt', '$OBJECT_KEY', 'text/plain',
     $(wc -c < "$FIXTURE" | tr -d ' '), '$EXPECTED_SHA256', 'not_scanned', '$USER_A_ID'),
    ('$TENANT_B_ID', '$DOCUMENT_B_ID', 1, 'document-b.txt', '$OBJECT_KEY_B', 'text/plain',
     $(wc -c < "$FIXTURE_B" | tr -d ' '), '$EXPECTED_SHA256_B', 'not_scanned', '$USER_B_ID');
INSERT INTO document_audit_events (id, tenant_id, document_id, actor_user_id, action, details)
VALUES
    ('$AUDIT_ID', '$TENANT_A_ID', '$DOCUMENT_ID', '$USER_A_ID', 'created',
     '{"source":"isolated-restore-test","marker":"baseline-a"}'),
    ('$AUDIT_B_ID', '$TENANT_B_ID', '$DOCUMENT_B_ID', '$USER_B_ID', 'created',
     '{"source":"isolated-restore-test","marker":"baseline-b"}');
SQL

echo "[TEST] Erzeuge verschlüsseltes PostgreSQL-Backup mit backup_cron.sh."
compose up -d backup
BACKUP_CONTAINER="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" \
    --filter 'label=com.docker.compose.service=backup' | head -n 1)"
if [ -z "$BACKUP_CONTAINER" ]; then
    echo "Fehler: Der Test-Backup-Container wurde nicht erstellt." >&2
    exit 1
fi
BACKUP_EXIT_CODE="$(bounded_run 600 docker wait "$BACKUP_CONTAINER")"
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
    compose exec -T restore-test-mc mc rm "local/$SOURCE_BUCKET/$OBJECT_KEY_B"
    for object_key in "$OBJECT_KEY" "$OBJECT_KEY_B"; do
        if compose exec -T restore-test-mc mc stat "local/$SOURCE_BUCKET/$object_key" >/dev/null 2>&1; then
            echo "Fehler: Das Quellobjekt '$object_key' wurde vor dem Restore nicht entfernt." >&2
            exit 1
        fi
    done
    compose exec -T restore-test-mc mc mirror --preserve \
        "local/$SNAPSHOT_BUCKET/" "local/$SOURCE_BUCKET/"
fi

compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "UPDATE documents SET title = 'Mutated after backup' WHERE id = '$DOCUMENT_ID' AND tenant_id = '$TENANT_A_ID';"

echo "[TEST] Stelle PostgreSQL-Backup mit restore.sh im isolierten Compose-Projekt wieder her."
bounded_run 600 "$SCRIPT_DIR/restore.sh" "$BACKUP_ARCHIVE"

echo "[TEST] Prüfe Migrationsrunner nach dem Restore."
bounded_run 600 docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" \
    -f "$SCRIPT_DIR/docker-compose.minio.yml" \
    -f "$SCRIPT_DIR/docker-compose.backup-restore-test.yml" \
    run --build --rm restore-test-migrate
MIGRATION_HISTORY="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations;")"
if [ "$MIGRATION_HISTORY" != "$EXPECTED_MIGRATIONS" ]; then
    echo "Fehler: Migrationshistorie nach dem Restore weicht ab." >&2
    echo "Erwartet: $EXPECTED_MIGRATIONS" >&2
    echo "Erhalten: $MIGRATION_HISTORY" >&2
    exit 1
fi

RESTORED_ROW="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT category.name || '|' || document.title || '|' || document.document_number || '|' ||
            version.version_number || '|' || version.original_filename || '|' || version.storage_key || '|' ||
            version.content_type || '|' || version.size_bytes || '|' || version.sha256_hash || '|' ||
            version.scan_status || '|' || (audit.details->>'marker')
        FROM documents document
        JOIN document_categories category ON category.id = document.category_id AND category.tenant_id = document.tenant_id
        JOIN document_versions version ON version.document_id = document.id AND version.tenant_id = document.tenant_id
        JOIN document_audit_events audit ON audit.document_id = document.id AND audit.tenant_id = document.tenant_id
        WHERE document.id = '$DOCUMENT_ID' AND document.tenant_id = '$TENANT_A_ID';")"
EXPECTED_ROW="Restore test category A|Restore baseline A|RESTORE-A-$TEST_SUFFIX|1|document-a.txt|$OBJECT_KEY|text/plain|$EXPECTED_SIZE|$EXPECTED_SHA256|not_scanned|baseline-a"
if [ "$RESTORED_ROW" != "$EXPECTED_ROW" ]; then
    echo "Fehler: Wiederhergestellte DMS-Metadaten, Version oder Auditzeile stimmen nicht überein." >&2
    echo "Erwartet: $EXPECTED_ROW" >&2
    echo "Erhalten: $RESTORED_ROW" >&2
    exit 1
fi
RESTORED_ROW_B="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT category.name || '|' || document.title || '|' || document.document_number || '|' ||
            version.version_number || '|' || version.original_filename || '|' || version.storage_key || '|' ||
            version.content_type || '|' || version.size_bytes || '|' || version.sha256_hash || '|' ||
            version.scan_status || '|' || (audit.details->>'marker')
        FROM documents document
        JOIN document_categories category ON category.id = document.category_id AND category.tenant_id = document.tenant_id
        JOIN document_versions version ON version.document_id = document.id AND version.tenant_id = document.tenant_id
        JOIN document_audit_events audit ON audit.document_id = document.id AND audit.tenant_id = document.tenant_id
        WHERE document.id = '$DOCUMENT_B_ID' AND document.tenant_id = '$TENANT_B_ID';")"
EXPECTED_ROW_B="Restore test category B|Restore baseline B|RESTORE-B-$TEST_SUFFIX|1|document-b.txt|$OBJECT_KEY_B|text/plain|$EXPECTED_SIZE_B|$EXPECTED_SHA256_B|not_scanned|baseline-b"
if [ "$RESTORED_ROW_B" != "$EXPECTED_ROW_B" ]; then
    echo "Fehler: Wiederhergestellte DMS-Metadaten des zweiten Testmandanten stimmen nicht überein." >&2
    echo "Erwartet: $EXPECTED_ROW_B" >&2
    echo "Erhalten: $RESTORED_ROW_B" >&2
    exit 1
fi

APP_ROLE_SECURITY="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -At -c "SELECT rolsuper::text || '|' || rolbypassrls::text FROM pg_roles WHERE rolname='secops_app_user';")"
if [ "$APP_ROLE_SECURITY" != "false|false" ]; then
    echo "Fehler: secops_app_user ist unerwartet privilegiert: $APP_ROLE_SECURITY" >&2
    exit 1
fi
TENANT_A_AUDIT_COUNT="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -qAt -c "BEGIN; SET LOCAL ROLE secops_app_user; SET LOCAL app.current_tenant='$TENANT_A_ID';
        SELECT count(*) FROM document_audit_events WHERE id IN ('$AUDIT_ID', '$AUDIT_B_ID'); COMMIT;")"
TENANT_B_AUDIT_COUNT="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -qAt -c "BEGIN; SET LOCAL ROLE secops_app_user; SET LOCAL app.current_tenant='$TENANT_B_ID';
        SELECT count(*) FROM document_audit_events WHERE id IN ('$AUDIT_ID', '$AUDIT_B_ID'); COMMIT;")"
if [ "$TENANT_A_AUDIT_COUNT" != 1 ] || [ "$TENANT_B_AUDIT_COUNT" != 1 ]; then
    echo "Fehler: Tenant-RLS zeigt nicht ausschließlich den jeweiligen Auditdatensatz." >&2
    echo "Tenant A: $TENANT_A_AUDIT_COUNT; Tenant B: $TENANT_B_AUDIT_COUNT" >&2
    exit 1
fi
if CROSS_TENANT_INSERT="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "BEGIN; SET LOCAL ROLE secops_app_user; SET LOCAL app.current_tenant='$TENANT_A_ID';
        INSERT INTO document_audit_events (id, tenant_id, document_id, actor_user_id, action)
        VALUES ('$CROSS_AUDIT_ID', '$TENANT_B_ID', '$DOCUMENT_B_ID', '$USER_B_ID', 'created'); COMMIT;" 2>&1)"; then
    echo "Fehler: Tenant A konnte einen Auditdatensatz für Tenant B einfügen." >&2
    exit 1
elif [[ "$CROSS_TENANT_INSERT" != *"row-level security policy"* ]]; then
    echo "Fehler: Fremdmandanten-Insert wurde nicht aufgrund der RLS-Policy abgewiesen." >&2
    echo "$CROSS_TENANT_INSERT" >&2
    exit 1
fi
echo "[TEST] Tenant-RLS verifiziert: getrennte Audit-Lesezugriffe und verweigerter Fremdtenant-Insert."

if [ "$MODE" = full ]; then
    verify_restored_object() {
        local document_id="$1" object_key="$2" expected_sha256="$3"
        local object_file="$TEMP_DIR/restored-$document_id" stat_file="$TEMP_DIR/restored-$document_id.json"
        compose exec -T restore-test-mc mc cat \
            "local/$SOURCE_BUCKET/$object_key" > "$object_file"
        RESTORED_SHA256="$(shasum -a 256 "$object_file" | awk '{print $1}')"
        if [ "$RESTORED_SHA256" != "$expected_sha256" ]; then
            echo "Fehler: SHA-256 des wiederhergestellten DMS-Objekts '$object_key' stimmt nicht überein." >&2
            exit 1
        fi
        compose exec -T restore-test-mc mc stat --json \
            "local/$SOURCE_BUCKET/$object_key" > "$stat_file"
        python3 - "$stat_file" "$document_id" "$expected_sha256" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as object_stat_file:
    stat = json.load(object_stat_file)
metadata = {key.lower(): str(value) for key, value in stat.get("metadata", {}).items()}
expected = {
    "x-amz-meta-document-id": sys.argv[2],
    "x-amz-meta-checksum": sys.argv[3],
}
missing = [key for key, value in expected.items() if metadata.get(key) != value]
if missing:
    raise SystemExit(f"Restored object metadata mismatch: {', '.join(missing)}")
PY
    }
    verify_restored_object "$DOCUMENT_ID" "$OBJECT_KEY" "$EXPECTED_SHA256"
    verify_restored_object "$DOCUMENT_B_ID" "$OBJECT_KEY_B" "$EXPECTED_SHA256_B"
    echo "[TEST] PASS: Migrationen, zwei Tenant-DMS-Datensätze, Versionen, Audit, RLS und $S3_BACKEND-Objekte samt SHA-256/Metadaten wurden wiederhergestellt."
else
    echo "[TEST] PASS: Migrationen, Tenant-DMS-Datensätze, Versionen, Audit und RLS wurden wiederhergestellt."
    echo "[TEST] S3-Objekte und ClamAV wurden in diesem Modus nicht getestet."
fi
echo "[TEST] ClamAV: nicht gestartet und daher in diesem Restore-Test nicht verifiziert."
