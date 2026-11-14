# SecurityOps 2.0 – Produktionsdeployment

**Architektur:** Caddy (TLS, statisches Frontend) → TypeScript/Express-Backend → PostgreSQL 16 + privater externer S3-kompatibler Objektspeicher + ClamAV
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
| `SECOPS_INTERNAL_SUBNET` | Privates Docker-Subnetz für Backend/Proxy/DB (Default `172.30.0.0/24`) |
| `SECOPS_PROXY_IPV4` | Feste interne IPv4-Adresse von Caddy (Default `172.30.0.2`) |
| `TRUST_PROXY` | Ausschließlich die Caddy-Adresse als CIDR, standardmäßig `172.30.0.2/32` |
| `BACKUP_ENCRYPTION_KEY` | Schlüssel für verschlüsselte Backups |
| `DMS_S3_ENDPOINT` | HTTPS-Endpunkt des S3-kompatiblen Objektspeichers |
| `DMS_S3_REGION` | S3-Region |
| `DMS_S3_BUCKET` | Privater DMS-Bucket |
| `DMS_S3_ACCESS_KEY`, `DMS_S3_SECRET_KEY` | Dedizierte Least-Privilege-Zugangsdaten; niemals committen |
| `DMS_S3_FORCE_PATH_STYLE` | Path-Style-URLs für kompatible Anbieter (Default `false`) |
| `DMS_SCAN_REQUIRED` | Malware-Prüfung verpflichtend (Default `true`) |
| `DMS_SCANNER_PROVIDER` | Produktionswert `clamav` |
| `DMS_CLAMAV_HOST`, `DMS_CLAMAV_PORT` | Vom Backend erreichbarer ClamAV-Dienst |
| `DMS_CLAMAV_TIMEOUT_MS` | Scanner-Timeout (Default 30 Sekunden) |
| `DMS_MAX_FILE_SIZE_BYTES` | Maximale Uploadgröße je Datei (Default 10 MiB, Obergrenze 100 MiB) |

Production Compose runs no ClamAV container; ClamAV must be operated separately and reachable from the backend. Required host/provider settings configure a client but do not verify scanner availability during startup. The first successful scan is the only evidence that a file was scanned; unavailable/error results remain quarantined and blocked. ClamAV's `zINSTREAM` TCP protocol does not authenticate or encrypt connections, so restrict it to a private, isolated network and permit access only from the backend. Local development uses the ClamAV service in `docker-compose.minio.yml`.

Express vertraut nur den in `TRUST_PROXY` ausdrücklich angegebenen Proxy-IP-Adressen/CIDRs; die Voreinstellung vertraut keinem Proxy. Im Production-Compose-Netz ist nur Caddy öffentlich, der Backend-Port wird nicht veröffentlicht, Caddy hat die feste interne Adresse `172.30.0.2`, und die Caddy-Konfiguration überschreibt `X-Forwarded-For` mit der tatsächlichen Verbindungsadresse. Bei geänderten Netzwerkwerten müssen `SECOPS_PROXY_IPV4` und `TRUST_PROXY` übereinstimmen; `TRUST_PROXY` darf nicht pauschal das gesamte Docker-Subnetz oder `*` freigeben. Dadurch basiert die Rate-Limit-IP auf dem Client hinter genau diesem vertrauenswürdigen Proxy, während nicht vertrauenswürdige `X-Forwarded-For`-Header ignoriert werden.

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
   Fehlende S3- oder Pflichtscanner-Konfiguration stoppt den Produktivstart.
5. `proxy` startet, sobald das Backend healthy ist.

Neue DMS-Dateien werden mit generierten Schlüsseln in einem privaten S3-kompatiblen Bucket abgelegt. Ohne erfolgreiche Pflichtprüfung bleiben sie in Quarantäne und können weder heruntergeladen noch als freigegeben/veröffentlicht markiert werden. Bestehende Dateien aus älteren dateisystembasierten Installationen werden nicht automatisch in S3 kopiert und nach Migration 035 nicht mehr als geprüft/freigegeben behandelt; vor dem Upgrade müssen sie separat migriert und erneut geprüft oder erneut hochgeladen werden.

Lokale Entwicklung: `cp .env.minio.example .env.minio`, lokale Werte setzen und `docker compose --env-file .env.minio -f docker-compose.minio.yml up -d` ausführen. Die Dienste binden nur an `127.0.0.1`. Die in `.env.minio` stehenden `DMS_*`-Werte werden zusätzlich dem lokalen Backend-Prozess übergeben. Diese Werte sind ausschließlich für lokale Entwicklung und nicht für Produktion gedacht.

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

Backups laufen automatisch alle 24 Stunden (`backup`-Dienst). Das verschlüsselte Archiv enthält den PostgreSQL-Dump (`secops_backups`, 30 Tage Retention). DMS-Objekte liegen außerhalb von Compose; für sie müssen Versionierung, Replikation/Backup und Retention beim gewählten S3-kompatiblen Anbieter separat aktiviert und getestet werden. Ein Datenbank-Restore stellt keine Objekte wieder her.

Manuell:

```bash
docker compose -f docker-compose.production.yml exec -T backup \
  sh -c 'pg_dump -h db -U secops_admin -d securityops_v2 -F c -f /var/backups/manual.dump'

Der obige Einzelbefehl erzeugt nur einen Datenbankdump. DMS-Objekte müssen unabhängig über den konfigurierten S3-Anbieter wiederhergestellt werden.
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

- SOPs besitzen Tabellen und API-Endpunkte (Migration `013_sop_instructions.sql`), sind aber mit dieser Dokumentation nicht deployed oder für Produktion freigegeben. Alarm-/Notfallpläne besitzen weiterhin keine Datenbanktabellen/Endpunkte.
- Es bestehen keine Verbindungen zu externen Sprachmodell- oder KI-Diensten; Wachbucheinträge werden manuell erfasst.
- Redis und der frühere Python-Worker wurden entfernt, da das TypeScript-Backend sie nicht verwendet und der Python-Stack nicht lauffähig war.
- Ein vollständiger Browser-E2E-Test ist nicht Teil dieses Deployment-Schritts.
