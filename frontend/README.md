# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Verzeichnisstruktur & Architekturtrennung

- **Frontend**: `frontend/` (bzw. Root-Verzeichnis bei flachem Checkout). React 18+/19 SPA mit Tailwind CSS, Zustand Store, IndexedDB Vault und Vitest-Testumgebung.
- **SecurityOps TypeScript-Backend**: `frontend/backend/` (bzw. `backend/` bei flacher Monorepo-Struktur). Enthält die vollwertige Node.js/Express/TypeScript REST-API (`/api/v1`), PostgreSQL RLS-Transaktionen und die Idempotenz-Engine.
- Es gibt kein separates Root-Proxy-Backend. Alle SecurityOps-Backend-Befehle werden unter `frontend/backend/` ausgeführt.

---

## 2. Installations-, Build- und Testbefehle

### 2.1 Backend (SecurityOps TypeScript-Backend unter `frontend/backend/`)
Aus dem Repository-Root auszuführen:
```bash
# Abhängigkeiten installieren
npm --prefix frontend/backend ci

# TypeScript-Build
npm --prefix frontend/backend run build

# Datenbankmigrationen ausführen (erfordert PostgreSQL 16+ Verbindung via secops_admin)
npm --prefix frontend/backend run migrate

# Testdaten anlegen
npm --prefix frontend/backend run seed

# Backend- und PostgreSQL RLS-Integrationstests ausführen
npm --prefix frontend/backend test -- --runInBand
```

### 2.2 Frontend (React, Zustand Store & Vitest unter `frontend/`)
Aus dem Frontend-Verzeichnis (`cd frontend`):
```bash
# Abhängigkeiten installieren
cd frontend
npm install

# Frontend Store- und Outbox-Vertragstests ausführen (Vitest)
npm test

# Frontend TypeScript- und Vite-Build
npm run build
```

---

## 3. Architektur & Sicherheitsgarantien
1. **RLS & Mandantenisolation**: PostgreSQL 16+ erzwingt `FORCE ROW LEVEL SECURITY`. Ohne gesetzten Transaktionskontext (`SET LOCAL app.current_tenant`) liefert die Datenbank physisch 0 Datensätze.
2. **Offline-Sync & Idempotenz**:
   - `POST /api/v1/sync/push` verarbeitet Mutationen atomar via PostgreSQL Transaction Advisory Locks und persistiert Quittungen in `sync_idempotency_receipts`.
   - `POST /api/v1/sync/conflicts/resolve` trennt Konfliktentscheidungen in `sync_conflict_resolution_receipts`.
   - Das Frontend entfernt Mutationen erst nach bestätigtem Servererfolg (`applied: true`, `serverState`); bei Fehlern bleibt die Outbox unversehrt.
3. **Least-Privilege**: Die Anwendung verbindet sich im operativen Betrieb ausschließlich als unprivilegierter Benutzer `secops_app_user` (ohne Superuser- oder BYPASSRLS-Rechte).
