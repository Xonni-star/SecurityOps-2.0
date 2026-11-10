# SECURITYOPS 2.0 – REST-API & SCHNITTSTELLENSPEZIFIKATION (PHASE 1)

## 1. Konventionen
- **Basis-URL**: `/api/v1`
- **Sicherheit**: `Authorization: Bearer <jwt>` und `X-Tenant-ID: <uuid>` zwingend für alle geschützten Ressourcen.
- **Idempotenz**: `Idempotency-Key: <uuid>` für Offline-Sync und Schreiboperationen.
- **Antwortformat**: JSON mit standardisiertem Envelope und RFC 7807 Error-Handling.

---

## 2. Zentrale Modul-Endpunkte

### 2.1 Authentifizierung & Mandant
- `POST /api/v1/auth/login` -> Erzeugt Access- & Refresh-Token mit Tenant-Claim
- `GET  /api/v1/tenants/current` -> Stammdaten und Lizenzstatus des aktiven Mandanten
- `POST /api/v1/tenants` -> Erstellung eines neuen Mandanten (Systemadministrator)

### 2.2 Digitales Wachbuch & Vorfälle
- `GET  /api/v1/wachbuch/incidents?priority=KRITISCH&resolved=false`
- `POST /api/v1/wachbuch/incidents` -> Neuer revisionssicherer Eintrag mit SHA-256 Hash
- `PUT  /api/v1/wachbuch/incidents/{id}/escalate` -> Statuswechsel und Alarm-Eskalation

### 2.3 Dienstplanung & Dispo
- `GET  /api/v1/schedule/shifts?site_id={id}&from={date}&to={date}`
- `POST /api/v1/schedule/shifts/{id}/assign` -> Prüft § 34a & Nachweise vor Zuweisung

### 2.4 Offline-First Synchronisation
- `POST /api/v1/sync/batch` -> Idempotenter Abgleich lokaler Transaktionen
- `GET  /api/v1/sync/conflicts` -> Liefert offene Versionskonflikte zur manuellen Klärung
