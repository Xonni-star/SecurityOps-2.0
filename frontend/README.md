# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Verzeichnisstruktur & Architekturtrennung

- **Frontend**: `frontend/` (bzw. Root-Verzeichnis bei flachem Checkout). React 18+/19 SPA mit Tailwind CSS, Zustand Store, IndexedDB Vault und Vitest-Testumgebung.
- **SecurityOps TypeScript-Backend**: `frontend/backend/` (bzw. `backend/` bei flacher Monorepo-Struktur). Enthält die vollwertige Node.js/Express/TypeScript REST-API (`/api/v1`), PostgreSQL RLS-Transaktionen und die Idempotenz-Engine.
- Es gibt kein separates Root-Proxy-Backend. Alle SecurityOps-Backend-Befehle werden unter `frontend/backend/` ausgeführt.

## Alarm- und Notfallmanagement

`AlarmsModule.tsx` verwendet die tenant- und objektbezogene Alarm-API. Notfallpläne haben unveränderliche Versionen, Entwurfs-/Veröffentlichungsstatus und Gültigkeitszeiträume. Alarmvorfälle besitzen append-only Status-/Maßnahmenhistorien, Objektzuweisungen und nachvollziehbare Zustellstatus. Der Backend-Prozess startet einen PostgreSQL-basierten Eskalationsworker. Offline-Meldungen, Maßnahmen und Statusänderungen werden in der vorhandenen IndexedDB `SecurityOps2_OfflineVault` vorgemerkt und mit stabilen Mutations-IDs synchronisiert. E-Mail/Push-Provider und Offline-Datei-Uploads sind nicht konfiguriert bzw. implementiert; Zustellung wird dafür nicht vorgetäuscht.

Siehe [Alarm-API](./ALARM_EMERGENCY_API.md), [Offline-Architektur](./OFFLINE_ARCHITECTURE.md) und den [Implementierungsbericht](../ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md).

## Kontrollgangsmanagement

`PatrolModule.tsx` stellt Dashboard, Objekt-/Zeitraumfilter, Kontrollpunkt- und Routenversionenverwaltung, Rundgänge, Scans, Abweichungen und Auditereignisse über die versionierte Express-API bereit. Kontrollpunkte unterstützen Gebäude, Bereich und optionale GPS-Koordinaten sowie Bearbeiten, Aktivieren/Deaktivieren und Archivieren. QR-Payloads enthalten zufällige Tokens; nur deren SHA-256-Hash wird gespeichert. Mobile Erfassung nutzt die native `BarcodeDetector`-API, wo verfügbar, Web NFC auf unterstützten Browsern sowie einen ausdrücklich als manuell markierten Fallback.

Offline-Start, Scans, Abschluss und Abweichungen werden dauerhaft in der IndexedDB-Outbox vorgemerkt und bei Wiederverbindung über `/api/v1/patrol/sync` synchronisiert. Kontrollpunkte, Routen und lokale Rundgangszustände lassen sich nach Browser-Neustart wiederherstellen. Eine erfolgreiche Tokenprüfung erfolgt erst serverseitig beim Sync; gelöschte oder rotierte Tokens führen zur Ablehnung statt zu einem bestätigten Scan. Details, Endpunkte und offene Kriterien stehen in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md) und [PATROL_IMPLEMENTATION_REPORT.md](../PATROL_IMPLEMENTATION_REPORT.md).

Die Benutzerzuordnung des Wachpersonals wird serverseitig über Mitarbeiterkonto und Objektzuordnung abgeleitet. Daher sind für bestätigte Scans verknüpfte Mitarbeiterkonten und aktive Objektzuweisungen nötig. Es gibt keine integrierte Patrol-Alarmzustellung; Abweichungen werden erfasst, aber automatische Fälligkeitserkennung und Patrol-Benachrichtigungsprovider sind nicht implementiert. Die vollständige Spezifikation ist gelesen; der Implementierungsbericht markiert die noch offenen Routenplanungs-, GPS-/Anlagen-, Filter- und Konfliktauflösungsanforderungen einzeln.

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

## 4. Dokumentenmanagement

Das DMS verwendet `/api/v1/documents` und PostgreSQL-Migration `012_document_management.sql`. Es persistiert Dokumentmetadaten, tenantgebundene Ordner/Kategorien/Tags, Beziehungen, unveränderliche Versionen und Append-Only-Auditereignisse. Datei-Uploads werden serverseitig anhand Signatur und Inhalt geprüft und unter einem generierten Schlüssel im privaten persistenten Speicher außerhalb des Frontends abgelegt. Die Standardgrenze beträgt 10 MiB pro Datei (`DMS_MAX_FILE_SIZE_BYTES`, maximal 100 MiB).

Die `secops_documents`-Dateien werden mit der Datenbank gemeinsam gesichert und wiederhergestellt. Es ist kein Virenscanner in der vorhandenen Deployment-Architektur verfügbar; der UI-Status bleibt daher `nicht durchgeführt`. DMS-Dateizugriff und Änderungen sind online erforderlich; Metadaten werden nicht in IndexedDB/LocalStorage gespeichert.

API-Details und bekannte Einschränkungen stehen in [DOCUMENTS_API.md](./DOCUMENTS_API.md) und [DMS_IMPLEMENTATION_REPORT.md](../DMS_IMPLEMENTATION_REPORT.md).
