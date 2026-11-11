# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Architektur & Sicherheitsgrundlagen (Schritt 5)

- **Backend-Laufzeitumgebung**: Node.js >= 18.0 & TypeScript mit Express REST-API (`/api/v1`).
- **PostgreSQL 16+ Rollentrennung (Least Privilege)**:
  - `DATABASE_MIGRATION_URL` (Rolle `secops_admin`): Ausschließlich für DDL-Schemaänderungen und Migrationen.
  - `DATABASE_URL` (Rolle `secops_app_user`): Unprivilegierter Anwendungsbetrieb (`NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB`). Das Backend prüft beim Start die Rollenrechte und bricht bei privilegierten Konten sofort ab.
- **Mandantentrennung & RLS**:
  - `FORCE ROW LEVEL SECURITY` mit transaktionssicherem `SET LOCAL app.current_tenant`. Ohne gesetzten Mandantenkontext werden physisch 0 Datensätze geliefert.
  - Composite Foreign Keys `(parent_id, tenant_id)` verhindern mandantenübergreifende Fremdschlüsselverknüpfungen (z. B. Schichten auf fremde Mitarbeiter oder Schlüssel an fremde Inhaber).
- **Append-Only Revisionssicherheit**:
  - PostgreSQL-Trigger `prevent_guardbook_tampering()` und `prevent_revision_tampering()` blockieren nachträgliche Manipulationen und Löschungen physisch auf Datenbankebene.
- **Echte Offline-Synchronisation**:
  - Lokale IndexedDB Outbox mit atomarer Transaktionsüberwachung (`transaction.oncomplete`).
  - Echte Übertragung von Mutationen an `/api/v1/sync/push`.
  - **Keine vorzeitige Löschung**: Datensätze verbleiben bei Netzwerkausfall sicher in der Outbox und werden erst nach bestätigter Serverquittung als synchronisiert markiert.
  - Idempotenz via `INSERT ... ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING`.
- **CORS-Sicherheit**:
  - Strikte Whitelist überprüfter HTTP/HTTPS-URLs; Wildcard `*` wird grundsätzlich verweigert.

---

## 2. Installations- und Startanleitung

### 2.1 Voraussetzungen
- Node.js >= 18.0.0 & npm >= 9.0.0
- PostgreSQL 16+

### 2.2 Datenbankrollen in PostgreSQL einrichten
```sql
-- Als postgres Superuser ausführen:
CREATE DATABASE securityops_v2;

-- 1. Migrations-Rolle (DDL)
CREATE ROLE secops_admin WITH LOGIN PASSWORD 'AdminPasswort_2025' SUPERUSER;

-- 2. Unprivilegierte Anwendungs-Rolle (Least Privilege)
CREATE ROLE secops_app_user WITH LOGIN PASSWORD 'AppUserPasswort_2025' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
```

### 2.3 Schnellstart Backend & Frontend
```bash
# 1. Repository klonen und in Verzeichnis wechseln
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0

# 2. Abhängigkeiten installieren
npm install --prefix backend
npm install

# 3. Umgebungsvariablen anlegen
cp backend/.env.example backend/.env
# In backend/.env Passwörter für secops_app_user und secops_admin eintragen!

# 4. Datenbankmigrationen und Entwicklungs-Seed ausführen
npm run migrate --prefix backend
npm run seed --prefix backend

# 5. Automatisierte Integrationstests ausführen
npm test --prefix backend

# 6. Backend starten (Port 8000)
npm run dev --prefix backend
```

---

## 3. Testdurchführung
```bash
# Führt alle 20 Sicherheits-, RLS-, Least-Privilege-, Sync- und CORS-Tests aus:
npm test --prefix backend
```
