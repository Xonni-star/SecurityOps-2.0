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

### Isolierter Restore-Regressionstest

Mit Docker und OpenSSL kannst du den verschlüsselten PostgreSQL-Backup-/Restore-Pfad sowie ein DMS-Objekt mit benutzerdefinierten Metadaten reproduzierbar testen:

```bash
cd frontend/deploy
./test_backup_restore.sh
```

Der Test verwendet ein eindeutiges Compose-Projekt mit eigenen PostgreSQL-/MinIO-Containern und Volumes, Testzugangsdaten, einem separaten Quell-Bucket und einem separaten Snapshot-Bucket. Er erstellt und verschlüsselt einen Datenbankdump mit `backup_cron.sh`, verändert danach Testdaten, stellt den Dump mit `restore.sh` wieder her und verifiziert Datenbankwerte, Objekt-SHA-256 sowie Objektmetadaten nach dem Snapshot-Restore. Die Compose-Datei für Produktion und deren Ressourcen werden nicht verwendet; die Testressourcen werden anschließend projektbezogen entfernt.

Die Restore-Zugangsdaten liegen in einer lokalen temporären Datei, die nicht in den Test-MC-Container eingebunden wird. Der Container erhält nur das Fixture-Verzeichnis schreibgeschützt.

Der S3-Schritt prüft MinIO lokal mit `mc mirror --preserve`; er belegt weder Anbieter-Versionierung/Replikation noch einen Restore bei einem externen S3-Anbieter. ClamAV und der Anwendungs-Upload-/Scan-Workflow werden in diesem Restore-Test nicht gestartet oder geprüft.

Für einen isolierten Datenbanktest ohne MinIO kann `./test_backup_restore.sh --database-only` verwendet werden. Dieser Modus prüft nicht die DMS-Objektsicherung.

Die Test-Images können bei Bedarf über `RESTORE_TEST_MINIO_IMAGE`, `RESTORE_TEST_MC_IMAGE` und `RESTORE_TEST_BACKUP_IMAGE` überschrieben werden; die lokalen Standardwerte bleiben die Compose-pinned Images.

Ausgeführter vollständiger Test in der Entwicklungsumgebung:

```bash
RESTORE_TEST_BACKUP_IMAGE=postgres:16 \
RESTORE_TEST_MINIO_IMAGE=ghcr.io/disaster37/minio@sha256:282ffcd2e0a3906086ab49cd70765617b20ce5c24ccf7d788043eb9b4ae59e6f \
RESTORE_TEST_MC_IMAGE=ghcr.io/disaster37/minio@sha256:282ffcd2e0a3906086ab49cd70765617b20ce5c24ccf7d788043eb9b4ae59e6f \
frontend/deploy/test_backup_restore.sh
```

Ergebnis: PostgreSQL-Metadaten überstanden Mutation und Restore; das DMS-Objekt wurde aus dem separaten MinIO-Snapshot wiederhergestellt. SHA-256 `462c58bbf396df1ac7d3177f1ac6a6e76fcfe7ac9c30a282a75b210423359ed6` und benutzerdefinierte Objektmetadaten stimmten. Testprojekt `secops-restore-test-20261114142105-17708`: Container `backup-1` (`8df841dda651`), `db-1` (`e96cdf6c318b`), `minio-1` (`f4c6bf2dacc4`) und `restore-test-mc-1` (`1dd9366ba334`), Volumes `secops-restore-test-20261114142105-17708_minio_data` und `secops-restore-test-20261114142105-17708_restore_test_pgdata` sowie Netzwerk `secops-restore-test-20261114142105-17708_default`; alle wurden gezielt entfernt und ihre Abwesenheit verifiziert. Der Image-Digest stammt aus einem GHCR-Build von MinIO-Quellcode (MinIO `RELEASE.2025-10-15T17-29-55Z`, `mc` `RELEASE.2025-08-13T08-35-41Z`); die lokal gepinnten Quay-Images waren in dieser Umgebung wegen `401 UNAUTHORIZED` nicht abrufbar. Dieser Test prüft daher weder genau das gepinnte Container-Image noch einen externen S3-Anbieter, dessen Versionierung/Replikation oder einen Produktions-Restore. Der Datenbank-Sentinel ist Testmetadaten und ersetzt keinen Restore-Test der vollständigen Produktionsmigrationen.

Zusätzlicher S3-kompatibler Test mit SeaweedFS (kein MinIO- oder externer Anbieter-Nachweis):

```bash
RESTORE_TEST_S3_BACKEND=seaweedfs \
RESTORE_TEST_S3_IMAGE=chrislusf/seaweedfs:latest \
RESTORE_TEST_MC_IMAGE=ghcr.io/disaster37/minio@sha256:282ffcd2e0a3906086ab49cd70765617b20ce5c24ccf7d788043eb9b4ae59e6f \
RESTORE_TEST_BACKUP_IMAGE=postgres:16 \
frontend/deploy/test_backup_restore.sh
```

Ergebnis: PostgreSQL-Zeile sowie SeaweedFS-Objekt und benutzerdefinierte Metadaten wurden nach Mutation/Löschung aus dem Snapshot wiederhergestellt. Der Objekt-SHA-256 war `df737b24b8fd1403670b0b4ede48171013ef2e07d3214324a3f3d7a9e24ba7d2`. Getestetes Compose-Projekt `secops-restore-test-20261114141631-15329`: Container `backup-1` (`ee2befa3ea4e`), `db-1` (`7bb96333bba8`), `seaweedfs-1` (`c66bdf3a64e3`) und `restore-test-mc-1` (`ede21175c6c9`), Volume `secops-restore-test-20261114141631-15329_restore_test_pgdata` und Netzwerk `secops-restore-test-20261114141631-15329_default`; alle wurden gezielt entfernt und ihre Abwesenheit verifiziert. Frühere SeaweedFS-Startversuche scheiterten vor dem Restore und bereinigten ihre separat benannten Ressourcen ebenfalls vollständig.

Separater ClamAV-Runtime-Smoke-Test (nicht Teil des DMS-Upload-/Scan-Adapters):

```bash
docker pull clamav/clamav:1.4.3
docker run -d --name secops-clamav-smoke-20261114141859-16599 --network none clamav/clamav:1.4.3
printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' |
  docker exec -i secops-clamav-smoke-20261114141859-16599 sh -c 'cat > /tmp/eicar.com'
docker exec secops-clamav-smoke-20261114141859-16599 clamdscan --stream --no-summary /tmp/eicar.com
docker rm -f secops-clamav-smoke-20261114141859-16599
```

Ergebnis: `clamdscan` meldete `/tmp/eicar.com: Eicar-Test-Signature FOUND` (erwarteter Exit-Code 1). Der Test-Container wurde entfernt und verifiziert; es wurde kein Netzwerk oder Volume erstellt. Das belegt nur die Erkennung des benignen EICAR-Teststrings über `clamdscan --stream`, nicht die Integration des App-Adapters oder Produktionsbereitschaft.

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
