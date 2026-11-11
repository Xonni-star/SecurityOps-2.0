# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Architektur & Sicherheitsgrundlagen (Schritt 3)

- **Backend**: Node.js & TypeScript mit Express REST-API (`/api/v1`).
- **Datenbank**: PostgreSQL 16+ mit unprivilegiertem Benutzer (`secops_app_user`, `NOSUPERUSER NOBYPASSRLS`).
- **Mandantentrennung & RLS**:
  - `tenant_id` als UUID auf allen mandantenspezifischen Tabellen.
  - Physische Durchsetzung von **PostgreSQL Row-Level Security (RLS)** via `ENABLE ROW LEVEL SECURITY` und `FORCE ROW LEVEL SECURITY`.
  - Transaktionssichere Mandantenbindung via `SET LOCAL app.current_tenant`. Ohne gesetzten Mandantenkontext werden 0 Datensätze geliefert.
  - Composite Foreign Keys `(parent_id, tenant_id)` verhindern mandantenübergreifende Fremdschlüsselverknüpfungen (z. B. Schichten auf fremde Mitarbeiter oder Schlüssel an fremde Inhaber).
- **Authentifizierung & Sessions**:
  - Passwort-Hashing mit **Argon2id**.
  - Persistente Sitzungsverwaltung und Token-Widerruf über `user_sessions`.
  - Granulare serverseitige Rollen- und Rechteprüfung (RBAC) **ohne pauschale Systemadministrator-Bypasses**.
  - Atomare Wachbuch-Idempotenz via `INSERT ... ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`.

---

## 2. Installations- und Startanleitung

### 2.1 Voraussetzungen
- Node.js >= 18.0.0
- Docker & Docker Compose v2
- PostgreSQL 16+

### 2.2 Schnellstart
```bash
# 1. Repository klonen
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0

# 2. Abhängigkeiten installieren
npm install --prefix backend
npm install

# 3. Umgebungsvariablen anlegen
cp backend/.env.example backend/.env
# In backend/.env sichere Passwörter und JWT_SECRET eintragen!

# 4. PostgreSQL-Container starten (gebunden an 127.0.0.1)
POSTGRES_PASSWORD=MeinGeheimesPasswort docker compose -f deploy/docker-compose.yml up -d db

# 5. Datenbankmigrationen und Seed ausführen
npm run migrate --prefix backend
npm run seed --prefix backend

# 6. Automatisierte Integrationstests ausführen
npm test --prefix backend

# 7. Backend-Server starten (Port 8000)
npm run dev --prefix backend
```

---

## 3. Testdurchführung
```bash
# Führt alle 12 Sicherheits-, RLS- und Idempotenz-Tests aus:
npm test --prefix backend
```
