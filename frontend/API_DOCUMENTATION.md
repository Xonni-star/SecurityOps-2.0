# SECURITYOPS 2.0 – REST-API DOKUMENTATION (PHASE 3)

## 1. Konventionen & Globale Header
- **Basis-URL**: `https://api.securityops.de/api/v1`
- **Authentifizierung**: `Authorization: Bearer <jwt_access_token>`
- **Mandanten-Kontext**: `X-Tenant-ID: <tenant_uuid>` (Wird serverseitig gegen Benutzerzuordnung validiert)
- **Offline-Idempotenz**: `Idempotency-Key: <uuidv4>` (Verhindert Duplikate bei Reconnect)
- **Content-Type**: `application/json; charset=utf-8`

---

## 2. API-Endpunkte nach Modulen

### 2.1 Authentifizierung & Sitzungen (`/api/v1/auth`)
- `POST /api/v1/auth/login`:
  - Request: `{ "email": "...", "password": "...", "device_id": "..." }`
  - Response (200): `{ "access_token": "...", "refresh_token": "...", "token_type": "bearer", "user": { ... } }`
- `POST /api/v1/auth/refresh`:
  - Request: `{ "refresh_token": "..." }`
  - Response (200): Neues Access-Token Paar
- `POST /api/v1/auth/logout`:
  - Setzt Token auf Redis-Blacklist und invalidiert Sitzung.
- `POST /api/v1/auth/change-password`:
  - Request: `{ "old_password": "...", "new_password": "..." }` (Passwortkomplexitätsprüfung aktiv)

### 2.2 Mandantenverwaltung (`/api/v1/tenants`)
- `GET /api/v1/tenants/current`: Liefert Details des aktiven Mandanten.
- `GET /api/v1/tenants/available`: Liefert alle Mandanten, denen der authentifizierte Benutzer zugeordnet ist.
- `POST /api/v1/tenants/switch`: Wechselt den aktiven Arbeitsmandanten (erzeugt aktualisiertes JWT).
- `POST /api/v1/tenants`: Erstellt einen neuen Mandanten (nur Systemadministrator).

### 2.3 Digitales Wachbuch & Vorfälle (`/api/v1/wachbuch`)
- `GET /api/v1/wachbuch/incidents`:
  - Query-Parameter: `priority`, `resolved`, `limit`, `offset`, `search`
- `POST /api/v1/wachbuch/incidents`:
  - Erstellt einen revisionssicheren Vorfall.
  - Automatische Berechnung des SHA-256 Hashes und Verkettung mit Vorläufer-Eintrag.
- `PUT /api/v1/wachbuch/incidents/{id}/resolve`:
  - Schließt Vorfall ab und hinterlegt Abschlussmaßnahmen.
- `POST /api/v1/wachbuch/shift-handover`:
  - Erstellt Schichtübergabeprotokoll mit Zählerständen und Unterschriftennachweis.

### 2.4 Dienst- & Schichtplanung (`/api/v1/schedule`)
- `GET /api/v1/schedule/shifts`:
  - Filterbar nach `from_date`, `to_date`, `site_id`, `status`.
- `POST /api/v1/schedule/shifts`:
  - Schicht im Dienstplan anlegen.
- `POST /api/v1/schedule/shifts/{id}/assign`:
  - Zuweisung eines Mitarbeiters.
  - **Echtzeitprüfung**: Validiert § 34a GewO Sachkundenachweis, Ersthelfer- und Brandschutzausweise auf Gültigkeit zum Schichtdatum.
  - Bei Diskrepanz wird Status `Konflikt` mit `conflict_reason` gesetzt.

### 2.5 Offline-Synchronisation (`/api/v1/sync`)
- `POST /api/v1/sync/batch`:
  - Request: Array von Transaktionsobjekten mit `idempotency_key`, `entity_type`, `action`, `client_version`, `payload`.
  - Response: Commit-Bestätigung oder `409 Conflict` Details bei kollidierender `server_version`.
- `GET /api/v1/sync/conflicts`:
  - Liefert ungelöste Versionskollisionen zur manuellen Klärung im Leitstand.
- `POST /api/v1/sync/conflicts/{id}/resolve`:
  - Führt Konfliktauflösung (Client-Win, Server-Win oder Merge) aus.
