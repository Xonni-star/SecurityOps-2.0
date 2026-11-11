# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Architektur & Sicherheitsgrundlagen (Schritt 4)

- **Backend-Laufzeitumgebung**: Node.js >= 18.0 & TypeScript mit Express REST-API (`/api/v1`).
- **PostgreSQL 16+ Least-Privilege Rollentrennung**:
  - `secops_admin` (nur für Schema-Migrationen & DDL).
  - `secops_app_user` (`NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB`) für die Backend-Laufzeit.
  - Physisches `REVOKE DELETE ON guardbook_entries, guardbook_revisions` für den Anwendungsbenutzer.
- **Mandantentrennung & RLS**:
  - Physische Durchsetzung von **PostgreSQL Row-Level Security (RLS)** via `ENABLE ROW LEVEL SECURITY` und `FORCE ROW LEVEL SECURITY`.
  - Transaktionssichere Mandantenbindung via `SET LOCAL app.current_tenant`. Ohne gesetzten Mandantenkontext werden physisch 0 Datensätze geliefert.
  - Composite Foreign Keys `(parent_id, tenant_id)` verhindern mandantenübergreifende Fremdschlüsselverknüpfungen (z. B. Schichten auf fremde Mitarbeiter oder Schlüssel an fremde Inhaber).
- **Append-Only Revisionssicherheit**:
  - PostgreSQL-Trigger `prevent_guardbook_tampering()` und `prevent_revision_tampering()` blockieren nachträgliche Manipulationen und Löschungen physisch auf Datenbankebene.
- **CORS-Sicherheit**:
  - Strikte Whitelist erlaubter Ursprünge; kein Wildcard `*` im Produktivbetrieb.
- **Offline-First mit echter Fehlerbehandlung**:
  - IndexedDB Outbox/Inbox Vault (`SecurityOps2_OfflineVault`) mit echter Fehlerüberwachung bei vollem Speicher oder blockierter DB.

---

## 2. Installations- und Startanleitung

### 2.1 Voraussetzungen
- Node.js >= 18.0.0 & npm >= 9.0.0
- PostgreSQL 16+ (lokal installiert oder via Container)

### 2.2 Schnellstart
```bash
# 1. Repository klonen und in Verzeichnis wechseln
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0

# 2. Abhängigkeiten installieren
npm install --prefix backend
npm install

# 3. Umgebungsvariablen für das Backend anlegen
cp backend/.env.example backend/.env
# In backend/.env sichere Passwörter, JWT_SECRET und CORS_ORIGIN eintragen!

# 4. Datenbankmigrationen und Entwicklungs-Seed ausführen
npm run migrate --prefix backend
npm run seed --prefix backend

# 5. Automatisierte Integrationstests ausführen
npm test --prefix backend

# 6. Backend-Server starten (Port 8000)
npm run dev --prefix backend
```

---

## 3. Testdurchführung
```bash
# Führt alle Sicherheits-, RLS-, Least-Privilege-, Append-Only- und CORS-Tests aus:
npm test --prefix backend
```
