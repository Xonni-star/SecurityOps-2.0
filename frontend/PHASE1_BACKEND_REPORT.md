# SecurityOps 2.0 - Phase 1: Echtes Backend & PostgreSQL-Datenbank

## 1. Bestandsaufnahme des bestehenden Projekts

### 1.1 Vorhandene Funktionen
- **Frontend-Applikation**: Vollständige React 18+/19 SPA mit Tailwind CSS, Zustand Store, dynamischer Navigation und responsivem Design.
- **Fachmodule**: Kunden- und Vertragsverwaltung, Objektverwaltung (mit Kontrollpunkten, Alarmen, Schlüsseln), Personalverwaltung mit § 34a GewO und BWR-Prüfung, Dienstplanung, digitales Wachbuch mit Append-Only Revisionshistorie, Schlüsselverwaltung, QM-Dienstanweisungen und DMS.
- **Offline-Vault**: Native IndexedDB-Struktur (`SecurityOps2_OfflineVault`) mit Outbox-, Inbox- und Attachments-Stores.
- **KI-Assistent**: Google Gemini 2.5 Flash SDK Integration zur behördensicheren Formulierung von Vorfällen nach DIN 77200.

### 1.2 Fehlende Backend-Funktionen (vor Phase 1)
- Vorherige Backend-Dateien waren teilweise konzeptionelle Python/FastAPI-Dateien ohne vollständige Node.js/TypeScript Laufzeitumgebung.
- Keine direkte, native PostgreSQL-Pool-Anbindung mit parametrisierten Queries via `pg`.
- Fehlendes migrationsbasiertes DDL-Skript für alle 24 geforderten Tabellen mit zusammengesetzten Fremdschlüsseln `(id, tenant_id)`.
- Fehlende serverseitige Durchsetzung von PostgreSQL Row-Level Security (RLS) mit Sitzungsvariablen `SET LOCAL app.current_tenant`.
- Keine realen REST-Routen `/api/v1/*` in Node.js mit strukturierter Fehlerbehandlung, Argon2id/KDF-Hashing und JWT-Authentifizierung.

### 1.3 Umgesetzte Maßnahmen in Phase 1
1. **Node.js / Express / TypeScript REST-API** (`/api/v1`) mit Zod-Eingabevalidierung, JWT-Sitzungsverwaltung und zentralem Error-Handling.
2. **PostgreSQL 16+ Datenbankarchitektur** mit 24 Kern-Tabellen, Composite Foreign Keys zur Verhinderung von Cross-Tenant Leaks und PostgreSQL RLS-Policies.
3. **Sichere Authentifizierung**: Passwort-Hashing mit Argon2id/PBKDF2-HMAC-SHA512 (310.000 Iterationen), Brute-Force-Lockout nach 5 Fehlversuchen und Token-Widerruf.
4. **Automatisierte Test-Suite**: Nachweis der absoluten Mandanten-Isolation (Mandant A kann Daten von Mandant B weder lesen noch schreiben oder manipulieren).
5. **Frontend-Live-Konsole** (`components/BackendLiveConsole.tsx`): Interaktives Backend- und Datenbank-Testcenter direkt in der UI für Reviewer.

---

## 2. PostgreSQL Datenbankarchitektur & ER-Modell

```
                    ┌─────────────────────────┐
                    │         tenants         │
                    │ id (PK, UUID), name, ... │
                    └────────────┬────────────┘
                                 │ 1:n
          ┌──────────────────────┼──────────────────────┐
          ▼                      ▼                      ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│      users       │   │     clients      │   │    employees     │
│ id, tenant_id    │   │ id, tenant_id    │   │ id, tenant_id    │
└─────────┬────────┘   └─────────┬────────┘   └─────────┬────────┘
          │ 1:n                  │ 1:n                  │ 1:n
          ▼                      ▼                      ▼
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  user_sessions   │   │      sites       │   │employee_qualific.│
│ id, user_id      │   │ id, client_id,   │   │ id, employee_id, │
│                  │   │ tenant_id (CFK)  │   │ tenant_id (CFK)  │
└──────────────────┘   └─────────┬────────┘   └─────────┬────────┘
                                 │                      │
                                 ├──────────────────────┘
                                 ▼
                       ┌──────────────────┐
                       │      shifts      │
                       │ id, site_id,     │
                       │ employee_id,     │
                       │ tenant_id (CFK)  │
                       └─────────┬────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ guardbook_entries│
                       │ id, site_id,     │
                       │ guard_id,        │
                       │ tenant_id (CFK), │
                       │ append-only      │
                       └──────────────────┘
```

---

## 3. Row-Level Security (RLS) & Composite Foreign Key Konzept

Jede mandantenspezifische Tabelle erzwingt zwei voneinander unabhängige Sicherheitsebenen:
1. **Composite Foreign Keys**:
   ```sql
   CONSTRAINT fk_sites_client_tenant FOREIGN KEY (client_id, tenant_id)
       REFERENCES clients(id, tenant_id) ON DELETE RESTRICT;
   ```
2. **PostgreSQL RLS Policies**:
   ```sql
   ALTER TABLE guardbook_entries ENABLE ROW LEVEL SECURITY;
   ALTER TABLE guardbook_entries FORCE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation_policy ON guardbook_entries
       AS RESTRICTIVE
       FOR ALL
       USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
       WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
   ```

---

## 4. Installations- und Ausführungsanweisungen

### Voraussetzungen
- Node.js >= 18.0.0
- Docker & Docker Compose v2
- PostgreSQL 16+

### Lokale Entwicklung & Start
```bash
# 1. Repository klonen und in Verzeichnis wechseln
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0

# 2. Abhängigkeiten installieren
npm install --prefix backend
npm install

# 3. Docker-Container (PostgreSQL 16) starten
docker compose -f deploy/docker-compose.yml up -d db

# 4. Datenbankmigrationen und Seed ausführen
npm run migrate --prefix backend
npm run seed --prefix backend

# 5. Backend-Tests ausführen
npm test --prefix backend

# 6. Backend-Server starten (Port 8000)
npm run dev --prefix backend
```
