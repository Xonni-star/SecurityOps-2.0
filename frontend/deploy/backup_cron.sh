#!/bin/bash
# SecurityOps 2.0 - Encrypted PostgreSQL Backup Daemon
# S3 object retention/backup is managed by the configured object-storage provider.

set -u -o pipefail

BACKUP_DIR="/var/backups"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    DB_DUMP="$BACKUP_DIR/db_${POSTGRES_DB}_${TIMESTAMP}.dump"
    ENC_ARCHIVE="$BACKUP_DIR/secops_backup_${TIMESTAMP}.tar.gz.enc"

    echo "[BACKUP $(date)] Starte PostgreSQL pg_dump..."

    if pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -b -f "$DB_DUMP"; then
        if tar -czf - -C "$BACKUP_DIR" "$(basename "$DB_DUMP")" | \
            openssl enc -aes-256-cbc -salt -pbkdf2 \
              -pass env:BACKUP_ENCRYPTION_KEY -out "$ENC_ARCHIVE"; then
            rm -f "$DB_DUMP"
            echo "[BACKUP $(date)] Backup erfolgreich: $ENC_ARCHIVE"
        else
            rm -f "$ENC_ARCHIVE"
            rm -f "$DB_DUMP"
            echo "[BACKUP $(date)] FEHLER: Verschlüsselung fehlgeschlagen."
        fi
    else
        rm -f "$DB_DUMP"
        echo "[BACKUP $(date)] FEHLER: pg_dump fehlgeschlagen."
    fi

    find "$BACKUP_DIR" -type f -name "secops_backup_*.enc" -mtime +"$RETENTION_DAYS" -exec rm -f {} \;

    sleep 86400
done
