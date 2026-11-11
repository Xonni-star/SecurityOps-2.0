#!/usr/bin/env bash
# ==============================================================================
# SecurityOps 2.0 - Production Installer (TypeScript backend + PostgreSQL 16)
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.production.yml"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=========================================================="
echo "    SECURITYOPS 2.0 - PRODUKTIONSINSTALLATION             "
echo "    TypeScript-Backend / PostgreSQL 16 / Caddy TLS        "
echo "=========================================================="

log_info "1/7: Prüfe Systemvoraussetzungen..."
if ! command -v docker >/dev/null 2>&1; then
    log_err "Docker ist nicht installiert (>= 24.0 erforderlich)."
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    log_err "Docker Compose Plugin v2 ist nicht verfügbar."
    exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
    log_err "openssl wird zum Erzeugen der Secrets benötigt."
    exit 1
fi

FREE_DISK_KB=$(df -k "$SCRIPT_DIR" | awk 'NR==2 {print $4}')
if [ "$FREE_DISK_KB" -lt 5242880 ]; then
    log_warn "Weniger als 5 GB freier Speicherplatz verfügbar."
fi

for port in 80 443; do
    if ss -tuln 2>/dev/null | grep -q ":$port "; then
        log_warn "Port $port ist bereits belegt. Caddy kann nicht starten."
    fi
done
log_success "Systemvoraussetzungen geprüft."

log_info "2/7: Konfiguriere .env und erzeuge Secrets..."
if [ ! -f "$ENV_FILE" ]; then
    cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    GEN_PG_PW=$(openssl rand -hex 24)
    GEN_APP_PW=$(openssl rand -hex 24)
    GEN_JWT=$(openssl rand -hex 32)
    GEN_BACKUP=$(openssl rand -hex 32)

    sed -i "s|CHANGEME_POSTGRES_ADMIN_PASSWORD|$GEN_PG_PW|" "$ENV_FILE"
    sed -i "s|CHANGEME_APP_USER_PASSWORD|$GEN_APP_PW|" "$ENV_FILE"
    sed -i "s|CHANGEME_JWT_SECRET_MIN_32_CHARS|$GEN_JWT|" "$ENV_FILE"
    sed -i "s|CHANGEME_BACKUP_ENCRYPTION_KEY|$GEN_BACKUP|" "$ENV_FILE"

    read -r -p "Öffentliche Domain [securityops.example]: " INPUT_DOMAIN
    INPUT_DOMAIN=${INPUT_DOMAIN:-securityops.example}
    sed -i "s|^DOMAIN=.*|DOMAIN=$INPUT_DOMAIN|" "$ENV_FILE"
    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://$INPUT_DOMAIN|" "$ENV_FILE"

    log_success ".env erzeugt (Modus 600) und Secrets generiert."
else
    log_info "Bestehende .env gefunden; keine Überschreibung."
fi

log_info "3/7: Baue Produktionsimages..."
docker compose -f "$COMPOSE_FILE" build

log_info "4/7: Starte PostgreSQL, Migration und Backend..."
docker compose -f "$COMPOSE_FILE" up -d

log_info "5/7: Warte auf Backend-Healthcheck..."
BACKEND_HEALTHY=0
for _ in $(seq 1 60); do
    if docker compose -f "$COMPOSE_FILE" ps backend 2>/dev/null | grep -q "(healthy)"; then
        BACKEND_HEALTHY=1
        break
    fi
    sleep 2
done

if [ "$BACKEND_HEALTHY" -ne 1 ]; then
    log_err "Backend wurde nicht healthy. Logs prüfen:"
    docker compose -f "$COMPOSE_FILE" logs --tail=100 backend migrate db-init
    exit 1
fi
log_success "Backend läuft und ist healthy."

log_info "6/7: Prüfe API- und Datenbankstatus..."
docker compose -f "$COMPOSE_FILE" exec -T backend node -e \
  "fetch('http://127.0.0.1:8000/api/v1/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"

log_info "7/7: Statusübersicht..."
docker compose -f "$COMPOSE_FILE" ps

DOMAIN_VALUE=$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2-)
echo ""
echo "=========================================================="
echo "    INSTALLATION ABGESCHLOSSEN"
echo "    URL: https://$DOMAIN_VALUE"
echo "    Health: https://$DOMAIN_VALUE/api/v1/health"
echo ""
echo "    Optionaler Demo-Seed (nicht für Produktion):"
echo "    docker compose -f $COMPOSE_FILE run --rm --entrypoint node backend dist/seeds/seed.js"
echo "=========================================================="
