# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Verzeichnisstruktur

- **Frontend**: Root-Verzeichnis (`./`), React 18+/19 SPA mit Tailwind CSS, Zustand Store und IndexedDB Vault.
- **SecurityOps TypeScript-Backend**: `backend/` (bzw. `frontend/backend/` bei relativer Monorepo-Verschachtelung). Enthält die vollwertige Express/TypeScript REST-API (`/api/v1`), PostgreSQL RLS-Transaktionen und die Idempotenz-Engine.
- **Hinweis**: Das Root-Verzeichnis `backend/` bzw. `frontend/backend/` enthält das eigentliche Anwendungsbackend mit `package.json`, `src/app.ts`, `src/migrations/`, etc.

---

## 2. Installations-, Build- und Testbefehle

### 2.1 Backend (Node.js & TypeScript REST-API)
```bash
# Abhängigkeiten installieren
npm --prefix backend ci

# TypeScript Build
npm --prefix backend run build

# Datenbankmigrationen ausführen (erfordert PostgreSQL 16+ Verbindung)
npm --prefix backend run migrate

# Testdaten anlegen
npm --prefix backend run seed

# Backend- und PostgreSQL RLS-Integrationstests ausführen
npm --prefix backend test -- --runInBand
```

### 2.2 Frontend (React & Zustand Store)
```bash
# Abhängigkeiten installieren
npm install

# Frontend Store- und Outbox-Vertragstests ausführen (Vitest)
npm test

# Frontend TypeScript Build
npm run build
```

---

## 3. Architektur & Sicherheitsgarantien
1. **RLS & Mandantenisolation**: PostgreSQL 16+ erzwingt `FORCE ROW LEVEL SECURITY`. Ohne gesetzten Transaktionskontext (`SET LOCAL app.current_tenant`) sind 0 Datensätze sichtbar.
2. **Offline-Sync & Idempotenz**:
   - `POST /api/v1/sync/push` verarbeitet Mutationen atomar via Advisory Locks und Quittungsspeicherung in `sync_idempotency_receipts`.
   - `POST /api/v1/sync/conflicts/resolve` trennt Konfliktentscheidungen in `sync_conflict_resolution_receipts`.
   - Das Frontend entfernt Mutationen erst nach bestätigtem Servererfolg; bei Fehlern bleibt die Outbox unversehrt.
3. **Least-Privilege**: Die Anwendung verbindet sich ausschließlich als unprivilegierter Benutzer `secops_app_user` (ohne Superuser- oder BYPASSRLS-Rechte).
