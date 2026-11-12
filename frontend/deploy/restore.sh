#!/usr/bin/env bash
# SecurityOps 2.0 - Verified PostgreSQL Restore Runbook
set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "Nutzung: $0 <pfad_zu_secops_backup_YYYYMMDD_HHMMSS.tar.gz.enc>"
    exit 1
fi

BACKUP_ARCHIVE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "Fehler: $SCRIPT_DIR/.env fehlt."
    exit 1
fi

# shellcheck disable=SC1090
source "$SCRIPT_DIR/.env"

if [ ! -f "$BACKUP_ARCHIVE" ]; then
    echo "Fehler: Backup-Archiv '$BACKUP_ARCHIVE' existiert nicht."
    exit 1
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

echo "[RESTORE] Stoppe den Backend-Schreibzugriff..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" stop backend

echo "[RESTORE] Spiele PostgreSQL-Dump ein (${POSTGRES_DB})..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" exec -T db \
  pg_restore -U secops_admin -d "$POSTGRES_DB" --clean --if-exists < "$DB_DUMP_FILE"

DOCUMENTS_DIR="$TEMP_RESTORE_DIR/documents"
if [ -d "$DOCUMENTS_DIR" ]; then
    echo "[RESTORE] Stelle privaten DMS-Dateispeicher wieder her..."
    tar -czf - -C "$TEMP_RESTORE_DIR" documents | \
      docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" run --rm --no-deps -T backend \
        tar -xzf - -C /var/lib/securityops
else
    echo "[RESTORE] WARNUNG: Dieses Archiv enthält keinen DMS-Dateispeicher."
fi

echo "[RESTORE] Starte Backend und Proxy..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" up -d backend proxy
echo "[RESTORE] Datenbank- und Dateiwiederherstellung abgeschlossen."
