# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Phase 1: Architektur & Technische Grundlage

- **Backend**: Node.js & TypeScript mit Express REST-API (`/api/v1`).
- **Datenbank**: PostgreSQL 16+ mit parametrisierten Abfragen (`pg`) und Verbindungspooling.
- **Mandantentrennung**:
  - `tenant_id` als UUID auf allen mandantenspezifischen Tabellen.
  - Physische Durchsetzung von **PostgreSQL Row-Level Security (RLS)** via `ENABLE ROW LEVEL SECURITY` und `FORCE ROW LEVEL SECURITY`.
  - Transaktionssichere Mandantenbindung via `SET LOCAL app.current_tenant`.
  - Composite Foreign Keys `(parent_id, tenant_id)` verhindern mandantenübergreifende Fremdschlüsselverknüpfungen auf Datenbankebene.
- **Authentifizierung**:
  - Passwort-Hashing mit **Argon2id**.
  - Signierte JWT-Tokens mit Benutzer- und Mandantenkontext.
  - Granulare serverseitige Rollen- und Rechteprüfung (RBAC).

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

# 4. PostgreSQL-Container starten
docker compose -f deploy/docker-compose.yml up -d db

# 5. Datenbankmigrationen und Seed ausführen
npm run migrate --prefix backend
npm run seed --prefix backend

# 6. Automatisierte Tests ausführen
npm test --prefix backend

# 7. Backend-Server starten (Port 8000)
npm run dev --prefix backend
```

---

## 3. Testzugangsdaten (Entwicklungs-Seed)
- **E-Mail**: `a.schmidt@ffm-sec.de`
- **Passwort**: `SecOpsVault2025SecurePassword!`
- **Mandant**: Securitas & Wache Frankfurt GmbH (`11111111-1111-1111-1111-111111111111`)
- **Rolle**: Einsatzleitung
