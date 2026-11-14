#!/bin/bash
# SecurityOps 2.0 - Encrypted PostgreSQL Backup Daemon
# S3 object retention/backup is managed by the configured object-storage provider.

set -u -o pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups}"
BACKUP_HOST="${BACKUP_HOST:-db}"
BACKUP_ONCE="${BACKUP_ONCE:-false}"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    DB_DUMP="$BACKUP_DIR/db_${POSTGRES_DB}_${TIMESTAMP}.dump"
    ENC_ARCHIVE="$BACKUP_DIR/secops_backup_${TIMESTAMP}.tar.gz.enc"

    echo "[BACKUP $(date)] Starte PostgreSQL pg_dump..."

    BACKUP_STATUS=0
    if pg_dump -h "$BACKUP_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -b -f "$DB_DUMP"; then
        if tar -czf - -C "$BACKUP_DIR" "$(basename "$DB_DUMP")" | \
            openssl enc -aes-256-cbc -salt -pbkdf2 \
              -pass env:BACKUP_ENCRYPTION_KEY -out "$ENC_ARCHIVE"; then
            rm -f "$DB_DUMP"
            echo "[BACKUP $(date)] Backup erfolgreich: $ENC_ARCHIVE"
        else
            rm -f "$ENC_ARCHIVE"
            rm -f "$DB_DUMP"
            echo "[BACKUP $(date)] FEHLER: Verschlüsselung fehlgeschlagen."
            BACKUP_STATUS=1
        fi
    else
        rm -f "$DB_DUMP"
        echo "[BACKUP $(date)] FEHLER: pg_dump fehlgeschlagen."
        BACKUP_STATUS=1
    fi

    find "$BACKUP_DIR" -type f -name "secops_backup_*.enc" -mtime +"$RETENTION_DAYS" -exec rm -f {} \;

    if [ "$BACKUP_ONCE" = "true" ]; then
        exit "$BACKUP_STATUS"
    fi

    sleep 86400
done
