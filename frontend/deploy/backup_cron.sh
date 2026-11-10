#!/bin/sh
# SecurityOps 2.0 - Automated Encrypted Backup Daemon
# Runs every 24 hours at 02:00 UTC with AES-256 encryption and 30-day retention

BACKUP_DIR="/var/backups"
STORAGE_DIR="/var/lib/securityops/storage"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

while true; do
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    DB_DUMP="$BACKUP_DIR/db_${POSTGRES_DB}_${TIMESTAMP}.dump"
    ENC_ARCHIVE="$BACKUP_DIR/secops_backup_${TIMESTAMP}.tar.gz.enc"

    echo "[BACKUP $(date)] Starte PostgreSQL pg_dump..."
    pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -b -v -f "$DB_DUMP"

    echo "[BACKUP $(date)] Erstelle verschlüsseltes Archiv mit Dokumenten..."
    tar -czf - -C "$BACKUP_DIR" "$(basename "$DB_DUMP")" -C "$STORAGE_DIR" . | \
      openssl enc -aes-256-cbc -salt -pbkdf2 -pass "pass:${BACKUP_ENCRYPTION_KEY}" -out "$ENC_ARCHIVE"

    rm -f "$DB_DUMP"
    echo "[BACKUP $(date)] Backup erfolgreich gespeichert: $ENC_ARCHIVE"

    # Cleanup backups older than retention period
    find "$BACKUP_DIR" -type f -name "secops_backup_*.enc" -mtime +"$RETENTION_DAYS" -exec rm -f {} \;

    # Sleep 24 hours (86400 seconds)
    sleep 86400
done
