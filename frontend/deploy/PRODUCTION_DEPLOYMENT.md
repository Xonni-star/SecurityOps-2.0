# SecurityOps 2.0 – Produktionsdeployment

**Architektur:** Caddy (TLS, statisches Frontend) → TypeScript/Express-Backend → PostgreSQL 16  
**Migrationspfad:** `migrate` (secops_admin) → `db-init` (Passwort für `secops_app_user`) → `backend` (ausschließlich App-Rolle)

---

## 1. Voraussetzungen

- Docker Engine ≥ 24
- Docker Compose Plugin v2
- `openssl`
- Freie Ports 80 und 443
- Domain mit A/AAAA-Record auf den Host (für automatisches TLS)

PostgreSQL und das Backend veröffentlichen **keine** Host-Ports. Nur Caddy ist öffentlich erreichbar.

---

## 2. Konfiguration

```bash
cd frontend/deploy
cp .env.example .env
chmod 600 .env
```

Werte in `.env` setzen:

| Variable | Zweck |
|---|---|
| `DOMAIN` | Öffentliche Domain (Caddy TLS) |
| `POSTGRES_DB` | Datenbankname (Default `securityops_v2`) |
| `POSTGRES_PASSWORD` | Passwort der administrativen Rolle `secops_admin` |
| `POSTGRES_APP_PASSWORD` | Passwort der Least-Privilege-Rolle `secops_app_user` |
| `JWT_SECRET` | Signaturgeheimnis, mindestens 32 Zeichen |
| `JWT_EXPIRES_IN` | Session-Laufzeit, z. B. `8h` |
| `CORS_ORIGIN` | Exakte öffentliche Origin, z. B. `https://securityops.example` |
| `BACKUP_ENCRYPTION_KEY` | Schlüssel für verschlüsselte Backups |

Secrets erzeugen:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 24   # POSTGRES_APP_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # BACKUP_ENCRYPTION_KEY
```

Verwende hex-kodierte Werte, damit keine URL-Sonderzeichen in den Datenbank-URLs entstehen. Echte Secrets niemals committen.

---

## 3. Start

```bash
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Startreihenfolge (durch Compose-Bedingungen erzwungen):

1. `db` wird healthy (`pg_isready`).
2. `migrate` führt alle Migrationen mit `secops_admin` aus.
3. `db-init` setzt das Passwort für `secops_app_user`.
4. `backend` startet und prüft die App-Rolle (kein Superuser, kein BYPASSRLS).
5. `proxy` startet, sobald das Backend healthy ist.

Status:

```bash
docker compose -f docker-compose.production.yml ps
```

---

## 4. Migrationen

Migrationen laufen automatisch über den einmaligen `migrate`-Dienst. Manuell:

```bash
docker compose -f docker-compose.production.yml run --rm migrate
```

Der Runner prüft Versionen, SHA-256-Prüfsummen, Schemaobjekte und Mandantenisolierung. Er bricht bei Abweichungen ab.

---

## 5. Healthcheck

```bash
curl -k https://$DOMAIN/api/v1/health
```

Erwartet: `status: "OPERATIONAL"` und eine verbundene PostgreSQL-Datenbank.

Intern:

```bash
docker compose -f docker-compose.production.yml exec -T backend \
  node -e "fetch('http://127.0.0.1:8000/api/v1/health').then(r=>r.text()).then(console.log)"
```

---

## 6. Optionaler Demo-Seed

Nur für Test-/Demo-Umgebungen, **nicht** für Produktion:

```bash
docker compose -f docker-compose.production.yml run --rm \
  --entrypoint node backend dist/seeds/seed.js
```

Der Seed legt Testmandanten und einen Testbenutzer an. Produktionsdaten dürfen nicht geseedet werden.

---

## 7. Update

```bash
git pull
cd frontend/deploy
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Neue Migrationen laufen beim Start über `migrate`. Vorher ein Backup erstellen.

---

## 8. Backup und Wiederherstellung

Backups laufen automatisch alle 24 Stunden (`backup`-Dienst) und werden AES-256-verschlüsselt im Volume `secops_backups` gespeichert (30 Tage Retention).

Manuell:

```bash
docker compose -f docker-compose.production.yml exec -T backup \
  sh -c 'pg_dump -h db -U secops_admin -d securityops_v2 -F c -f /var/backups/manual.dump'
```

Wiederherstellung:

```bash
./restore.sh /pfad/zu/secops_backup_YYYYMMDD_HHMMSS.tar.gz.enc
```

Nach der Wiederherstellung Backend und Proxy neu starten.

---

## 9. Neustart und Fehlerdiagnose

```bash
docker compose -f docker-compose.production.yml restart backend proxy
docker compose -f docker-compose.production.yml logs --tail=200 backend
docker compose -f docker-compose.production.yml logs --tail=200 migrate db-init
docker compose -f docker-compose.production.yml logs --tail=200 proxy
```

Häufige Ursachen:

- `POSTGRES_APP_PASSWORD` fehlt → `db-init` schlägt fehl.
- `CORS_ORIGIN` stimmt nicht mit der öffentlichen Origin überein → Browser blockiert API-Aufrufe.
- Port 80/443 belegt → Caddy startet nicht.
- `JWT_SECRET` kürzer als 32 Zeichen → Backend bricht beim Start ab.

---

## 10. Sicherheitsmodell

- `secops_app_user`: `LOGIN`, kein `SUPERUSER`, kein `BYPASSRLS`, kein `CREATEROLE`, kein `CREATEDB`.
- Der API-Server erhält **keine** administrative Datenbank-URL; nur `migrate` und `db-init` nutzen `secops_admin`.
- PostgreSQL und Backend sind ausschließlich im internen Docker-Netz erreichbar.
- CORS-Whitelist über `CORS_ORIGIN`; kein Wildcard.
- Helmet-Sicherheitsheader und Caddy-TLS/HSTS bleiben aktiv.
- RLS und Mandantentrennung bleiben unverändert.
- Secrets ausschließlich über `.env` (Modus 600); keine Secrets in Images oder im Repository.

---

## 11. Bekannte Einschränkungen

- Dokumente, SOPs und Alarme besitzen weiterhin keine Datenbanktabellen/Endpunkte.
- Der Gemini-Copilot läuft weiterhin browser-seitig; die CSP erlaubt dafür `generativelanguage.googleapis.com`.
- Redis und der frühere Python-Worker wurden entfernt, da das TypeScript-Backend sie nicht verwendet und der Python-Stack nicht lauffähig war.
- Ein vollständiger Browser-E2E-Test ist nicht Teil dieses Deployment-Schritts.
