# SecurityOps 2.0 - Zentrale Sicherheitsdienstverwaltung nach DIN 77200 & § 34a GewO

SecurityOps 2.0 ist eine mandantenfähige, offline-fähige Enterprise-Software für Sicherheitsunternehmen mit PostgreSQL 16+ Row-Level-Security (RLS), digitalem Wachbuch, Dienstplanung und mobiler Mitarbeiter-App.

---

## 1. Verzeichnisstruktur & Architekturtrennung

- **Frontend**: `frontend/` (bzw. Root-Verzeichnis bei flachem Checkout). React 18+/19 SPA mit Tailwind CSS, Zustand Store, IndexedDB Vault und Vitest-Testumgebung.
- **SecurityOps TypeScript-Backend**: `frontend/backend/` (bzw. `backend/` bei flacher Monorepo-Struktur). Enthält die vollwertige Node.js/Express/TypeScript REST-API (`/api/v1`), PostgreSQL RLS-Transaktionen und die Idempotenz-Engine.
- Es gibt kein separates Root-Proxy-Backend. Alle SecurityOps-Backend-Befehle werden unter `frontend/backend/` ausgeführt.

## Dienst- und Einsatzplanung (Phase 2)

`components/RosterModule.tsx` ist unter der bestehenden Route `roster` eingebunden. Die Oberfläche bietet Monats-, Wochen- und Tageskalender, Zeit-/Mitarbeiter-/Objekt-/Kundenansichten, Suche und Filter, Entwürfe, periodengebundene Planung, revisionierte Vorlagen, nicht bindende Besetzungsvorschläge, Zuweisungen, Cover-/Tauschanträge, Ist-Zeit samt Korrekturverlauf, serverseitige Befunde, Veröffentlichung, Arbeitszeit-/Coverage-/Qualifikations-/Abwesenheitsberichte sowie CSV- und Druckausgabe. Planung, Revisionen, Befunde und Entscheidungen werden über dokumentierte Planning-API-Endpunkte und konkrete Berechtigungen abgewickelt; lokale Eingaben gelten nicht als Freigabe.

Der Offline-Cache ist nach Mandant und Benutzer getrennt. Die Outbox unterstützt einzelne, unbesetzte Entwurfsanlagen ohne Periode (Besetzungsbedarf 1) sowie Draft-Änderungen mit Server-ID und Basisrevision. Offline-Updates ändern weder Periodenzuordnung noch Mindestbesetzung; Mutation und Folgeänderung bleiben sichtbar ausstehend und ungeprüft, bis der Server synchronisiert. Zuweisung, Tauschentscheidung und Veröffentlichung benötigen Online-Serverprüfung. Konflikte und Ablehnungen bleiben in der Outbox sichtbar.

Vorlagen können revisioniert bearbeitet und aktiviert/deaktiviert, aber nicht hart gelöscht oder über einen eigenen Copy-Endpunkt dupliziert werden. Besetzungsvorschläge sind erklärend und unverbindlich; die Zuweisung erfolgt erst nach separater Bestätigung und Serverprüfung. Ist-Zeit besitzt keine unabhängige Freigabe; Regelprofile unterstützen derzeit nur mandantenweiten oder Objekt-Scope. Es gibt keine Benutzerbenachrichtigungen. Browser-/Gerätekompatibilität, produktiver Rollout und fachliche/rechtliche Abnahme sind nicht durch Frontend-Tests belegt. PR-/CI-Stand und weitere Grenzen: [Phase-2-Abschlussbericht](../PHASE_2_FINAL_COMPLETION_REPORT.md); API-Vertrag: [SERVICE_PLANNING_API.md](./backend/SERVICE_PLANNING_API.md).

Nach erfolgreicher Authentifizierung startet die Outbox-Wiedergabe auch dann, wenn die App bereits online wiederhergestellt wird. Jede Mutation wird nur für die exakte aktuelle Mandanten-/Benutzerkombination wiedergegeben; Einträge ohne bekannten Benutzerbesitzer bleiben aus Sicherheitsgründen ungepushed. Der Planungscache speichert nur den zuletzt geladenen Datumsbereich je Mandant und Benutzer und weist in der Oberfläche auf diese Grenze hin; außerhalb des Bereichs warnt sie, damit leere Offline-Zeiträume nicht als bestätigte Schichtfreiheit missverstanden werden. Schichtkonfliktentscheidungen zeigen den tenant-validierten aktuellen Feld-Snapshot aus der Sync-API. Ist-Zeit kann mit Revisionserwartung von einer anderen berechtigten Person genehmigt werden, und Planungsbenachrichtigungen sind als In-App-Eingang mit Als-gelesen-Aktion verfügbar. Die vollständige Test- und Auditdokumentation steht im [Offline-Testbericht](./OFFLINE_TEST_REPORT.md) und im [Phase-2-Abschlussbericht](../PHASE_2_FINAL_COMPLETION_REPORT.md).

## Alarm- und Notfallmanagement

`AlarmsModule.tsx` verwendet die tenant- und objektbezogene Alarm-API. Notfallpläne haben unveränderliche Versionen, Entwurfs-/Veröffentlichungsstatus und Gültigkeitszeiträume. Alarmvorfälle besitzen append-only Status-/Maßnahmenhistorien, Objektzuweisungen und nachvollziehbare Zustellstatus. Der Backend-Prozess startet einen PostgreSQL-basierten Eskalationsworker. Offline-Meldungen, Maßnahmen und Statusänderungen werden in der vorhandenen IndexedDB `SecurityOps2_OfflineVault` vorgemerkt und mit stabilen Mutations-IDs synchronisiert. E-Mail/Push-Provider und Offline-Datei-Uploads sind nicht konfiguriert bzw. implementiert; Zustellung wird dafür nicht vorgetäuscht.

Siehe [Alarm-API](./ALARM_EMERGENCY_API.md), [Offline-Architektur](./OFFLINE_ARCHITECTURE.md) und den [Implementierungsbericht](../ALARM_EMERGENCY_IMPLEMENTATION_REPORT.md).

## Kontrollgangsmanagement

`PatrolModule.tsx` stellt Dashboard mit Kunden-, Objekt-, Mitarbeiter-, Routen-, Zeitraum-, Status- und Abweichungsfiltern, Kontrollpunkt- und Routenversionenverwaltung, Rundgänge, Scans, Abweichungen und Auditereignisse über die versionierte Express-API bereit. Routenversionen unterstützen feste/flexible Reihenfolge, Soll-Dauer, Verspätungstoleranz, Zeitfenster, tägliche/wöchentliche Wiederholung und Objekt-Mitarbeiterzuordnungen. Kontrollpunkte unterstützen Gebäude, Bereich und optionale GPS-Koordinaten sowie Bearbeiten, Aktivieren/Deaktivieren und Archivieren. QR-Payloads enthalten zufällige Tokens; nur deren SHA-256-Hash wird gespeichert. Mobile Erfassung nutzt die native `BarcodeDetector`-API, wo verfügbar, Web NFC auf unterstützten Browsern sowie einen ausdrücklich als manuell markierten Fallback. GPS je Scan ist optional; Rundgangsabschlüsse können Bemerkungen enthalten.

Offline-Start, Scans, Abschluss und Abweichungen werden dauerhaft in der IndexedDB-Outbox vorgemerkt und bei Wiederverbindung über `/api/v1/patrol/sync` synchronisiert. Kontrollpunkte, Routen und lokale Rundgangszustände lassen sich nach Browser-Neustart wiederherstellen. Eine erfolgreiche Tokenprüfung erfolgt erst serverseitig beim Sync; gelöschte oder rotierte Tokens führen zur Ablehnung statt zu einem bestätigten Scan. Details, Endpunkte und offene Kriterien stehen in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md) und [PATROL_IMPLEMENTATION_REPORT.md](../PATROL_IMPLEMENTATION_REPORT.md).

Die Benutzerzuordnung des Wachpersonals wird serverseitig über Mitarbeiterkonto und Objektzuordnung abgeleitet. Daher sind für bestätigte Scans verknüpfte Mitarbeiterkonten und aktive Objektzuweisungen nötig. Verspätete Scans, beim Scan fällige ausgelassene Kontrollpunkte und zu lange abgeschlossene Runden erzeugen idempotente Abweichungen; ungültige und doppelte Scanversuche werden ohne Tokengeheimnis revisionssicher protokolliert. Zeitfenster/Wiederholungen werden gespeichert, aber noch nicht durch einen Zeitplaner ausgeführt. Mitarbeitergruppen, Fotoanlagen, vollständige Fälligkeitserkennung und ein Patrol-Benachrichtigungsprovider sind nicht verfügbar/implementiert. Die vollständige Spezifikation ist gelesen; der Implementierungsbericht führt die verbleibenden Punkte einzeln auf.

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

# Frontend dependency audit
npm audit
```

Audit snapshot (2026-11-13): frontend `npm audit` — 0 vulnerabilities. Backend `npm --prefix frontend/backend audit` — 7 low findings in the Jest/`ts-jest` development-test toolchain, including `deepmerge` GHSA-gcqx-w48m-w2h4; `npm --prefix frontend/backend audit --omit=dev` — 0 vulnerabilities. The suggested forced fix is a breaking Jest downgrade, so no unrelated dependency change was applied. The Phase 2 test/build/audit results and exact CI heads are recorded in the [final status report](../PHASE_2_FINAL_COMPLETION_REPORT.md).

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
