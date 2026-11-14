#!/usr/bin/env bash
# SecurityOps 2.0 - Verified PostgreSQL Restore Runbook
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Nutzung: $0 <pfad_zu_secops_backup_YYYYMMDD_HHMMSS.tar.gz.enc>"
    exit 1
fi

BACKUP_ARCHIVE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_ENV_FILE="${RESTORE_ENV_FILE:-$SCRIPT_DIR/.env}"

if [ ! -f "$RESTORE_ENV_FILE" ]; then
    echo "Fehler: $RESTORE_ENV_FILE fehlt."
    exit 1
fi

# shellcheck disable=SC1090
set -a
source "$RESTORE_ENV_FILE"
set +a

if [ ! -f "$BACKUP_ARCHIVE" ]; then
    echo "Fehler: Backup-Archiv '$BACKUP_ARCHIVE' existiert nicht."
    exit 1
fi

RESTORE_COMPOSE_FILES="${RESTORE_COMPOSE_FILES:-$SCRIPT_DIR/docker-compose.production.yml}"
COMPOSE_ARGS=()
if [ -n "${RESTORE_COMPOSE_PROJECT:-}" ]; then
    COMPOSE_ARGS+=(--project-name "$RESTORE_COMPOSE_PROJECT")
fi
COMPOSE_FILE_COUNT=0
while IFS= read -r compose_file; do
    [ -n "$compose_file" ] || continue
    if [ ! -f "$compose_file" ]; then
        echo "Fehler: Compose-Datei '$compose_file' existiert nicht."
        exit 1
    fi
    COMPOSE_ARGS+=(-f "$compose_file")
    COMPOSE_FILE_COUNT=$((COMPOSE_FILE_COUNT + 1))
done <<< "$RESTORE_COMPOSE_FILES"
if [ "$COMPOSE_FILE_COUNT" -eq 0 ]; then
    echo "Fehler: Keine Docker-Compose-Datei für den Restore angegeben."
    exit 1
fi

RESTORE_DB_SERVICE="${RESTORE_DB_SERVICE:-db}"
RESTORE_DB_USER="${RESTORE_DB_USER:-secops_admin}"
if [ "${RESTORE_QUIESCE_SERVICES+x}" = x ]; then
    read -r -a QUIESCE_SERVICES <<< "$RESTORE_QUIESCE_SERVICES"
else
    QUIESCE_SERVICES=(backend)
fi
if [ "${RESTORE_RESUME_SERVICES+x}" = x ]; then
    read -r -a RESUME_SERVICES <<< "$RESTORE_RESUME_SERVICES"
else
    RESUME_SERVICES=(backend proxy)
fi

TEMP_RESTORE_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_RESTORE_DIR"' EXIT

echo "[RESTORE] Entschlüssele Archiv..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$BACKUP_ARCHIVE" | tar -xzf - -C "$TEMP_RESTORE_DIR"

DB_DUMP_FILE=$(find "$TEMP_RESTORE_DIR" -name "*.dump" | head -n 1)

if [ -z "$DB_DUMP_FILE" ]; then
    echo "Fehler: Kein pg_dump im Archiv gefunden."
    exit 1
fi

if [ "${#QUIESCE_SERVICES[@]}" -gt 0 ]; then
    echo "[RESTORE] Stoppe Schreibzugriffe: ${QUIESCE_SERVICES[*]}..."
    docker compose "${COMPOSE_ARGS[@]}" stop "${QUIESCE_SERVICES[@]}"
fi

echo "[RESTORE] Spiele PostgreSQL-Dump ein (${POSTGRES_DB})..."
docker compose "${COMPOSE_ARGS[@]}" exec -T "$RESTORE_DB_SERVICE" \
  pg_restore -U "$RESTORE_DB_USER" -d "$POSTGRES_DB" --clean --if-exists < "$DB_DUMP_FILE"

if [ "${#RESUME_SERVICES[@]}" -gt 0 ]; then
    echo "[RESTORE] Starte Dienste: ${RESUME_SERVICES[*]}..."
    docker compose "${COMPOSE_ARGS[@]}" up -d "${RESUME_SERVICES[@]}"
fi

echo "[RESTORE] Datenbankwiederherstellung abgeschlossen. DMS-Objekte müssen separat über den S3-Anbieter wiederhergestellt werden."
