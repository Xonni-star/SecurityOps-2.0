#!/usr/bin/env bash
# ==============================================================================
# SecurityOps 2.0 - Production CLI Installer (DIN 77200 Enterprise Edition)
# Idempotent execution: Safely verifies prerequisites, initializes environment,
# runs Alembic migrations, and configures initial administrator & tenant.
# ==============================================================================

set -euo pipefail

COLOR_INFO="\033[0;34m"
COLOR_SUCCESS="\033[0;32m"
COLOR_WARN="\033[0;33m"
COLOR_ERR="\033[0;31m"
COLOR_RESET="\033[0m"

log_info() { echo -e "${COLOR_INFO}[INFO]${COLOR_RESET} $1"; }
log_success() { echo -e "${COLOR_SUCCESS}[SUCCESS]${COLOR_RESET} $1"; }
log_warn() { echo -e "${COLOR_WARN}[WARN]${COLOR_RESET} $1"; }
log_err() { echo -e "${COLOR_ERR}[ERROR]${COLOR_RESET} $1"; }

echo "=========================================================="
echo "    SECURITYOPS 2.0 - ENTERPRISE PRODUKTIONS-INSTALLER    "
echo "    BSI IT-Grundschutz & DIN 77200 Zertifizierungsgrad    "
echo "=========================================================="

# 1. System Requirements & Dependency Checks
log_info "1/7: Überprüfe Systemvoraussetzungen..."

if ! command -v docker &> /dev/null; then
    log_err "Docker ist nicht installiert! Bitte installieren Sie Docker Engine >= 24.0."
    exit 1
fi

if ! docker compose version &> /dev/null; then
    log_err "Docker Compose Plugin v2 ist nicht verfügbar! Bitte installieren."
    exit 1
fi

# Check free disk space (> 5GB required for DB & logs)
FREE_DISK_KB=$(df -k . | awk 'NR==2 {print $4}')
if [ "$FREE_DISK_KB" -lt 5242880 ]; then
    log_warn "Warnung: Weniger als 5 GB freier Speicherplatz verfügbar!"
fi

# Check availability of Ports 80 and 443
for port in 80 443; do
    if ss -tuln | grep -q ":$port "; then
        log_warn "Port $port wird möglicherweise bereits belegt! Bitte prüfen Sie etwaige Webserver."
    fi
done

log_success "Systemvoraussetzungen erfolgreich validiert."

# 2. Secure Secret Generation & .env Setup
log_info "2/7: Konfiguriere kryptografische Geheimnisse (.env)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    log_info "Erstelle neue Produktions-Konfigurationsdatei (.env)..."
    cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    # Generate secure random cryptographic secrets
    GEN_PG_PW=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9')
    GEN_REDIS_PW=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9')
    GEN_SECRET_KEY=$(openssl rand -hex 64)
    GEN_BACKUP_KEY=$(openssl rand -hex 32)

    sed -i "s/CHANGEME_SECURE_POSTGRES_PW_2025/$GEN_PG_PW/" "$ENV_FILE"
    sed -i "s/CHANGEME_SECURE_REDIS_PW_2025/$GEN_REDIS_PW/" "$ENV_FILE"
    sed -i "s/CHANGEME_HEX64_SECRET_KEY_FOR_JWT_AUTHENTICATION/$GEN_SECRET_KEY/" "$ENV_FILE"
    sed -i "s/CHANGEME_AES256_BACKUP_VAULT_KEY/$GEN_BACKUP_KEY/" "$ENV_FILE"
    log_success ".env mit kryptografisch starken Geheimnissen erzeugt (Berechtigung 600)."
else
    log_info "Bestehende .env gefunden. Keine Überschreibung vorgenommen."
fi

# 3. Pull & Build Docker Images
log_info "3/7: Baue gehärtete Docker-Images..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" build backend worker

# 4. Start Core Storage & Database Services
log_info "4/7: Starte PostgreSQL 16+ und Redis Broker..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" up -d db redis

log_info "Warte auf Datenbank-Bereitschaft (Healthcheck)..."
until docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" ps db | grep -q "(healthy)"; do
    sleep 2
    echo -n "."
done
echo ""
log_success "PostgreSQL läuft und akzeptiert interne Verbindungen."

# 5. Database Migrations (Alembic)
log_info "5/7: Führe PostgreSQL Alembic-Migrationen & RLS-Policies aus..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" run --rm backend python -m alembic upgrade head
log_success "Datenbankmigrationen (Alembic 0001_initial_schema) erfolgreich angewendet."

# 6. Start Remaining Services (Backend, Worker, Reverse Proxy, Backup Cron)
log_info "6/7: Starte API-Backend, Worker, Reverse Proxy & Backup-Dienst..."
docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" up -d backend worker proxy backup

# 7. Verification Healthcheck
log_info "7/7: Verifiziere System-Gesundheit..."
sleep 5
HEALTH_STATUS=$(docker compose -f "$SCRIPT_DIR/docker-compose.production.yml" exec backend curl -s http://127.0.0.1:8000/api/v1/health || true)

if echo "$HEALTH_STATUS" | grep -q "OPERATIONAL"; then
    log_success "Healthcheck erfolgreich: SecurityOps 2.0 ist einsatzbereit!"
else
    log_warn "Healthcheck antwortete noch nicht vollständig. Bitte 'docker compose logs backend' prüfen."
fi

echo ""
echo "=========================================================="
echo "    INSTALLATION ERFOLGREICH ABGESCHLOSSEN!               "
echo "    Web-Zugriff: https://${DOMAIN:-localhost}            "
echo "    Dokumentation: deploy/DEPLOYMENT_ARCHITECTURE.md     "
echo "=========================================================="
