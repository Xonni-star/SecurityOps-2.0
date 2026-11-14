# SecurityOps 2.0 - Sicherheitsdienstverwaltung

SecurityOps 2.0 ist ein Softwareprojekt für Sicherheitsdienstprozesse mit React/Vite, einer TypeScript/Express-API und PostgreSQL 16+ Row-Level-Security (RLS). Der fachliche Bezug zu DIN 77200 oder § 34a GewO ist keine Zertifizierungs-, Rechtskonformitäts- oder Produktionsfreigabe.

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Einzelne Module und End-to-End-Abnahmen haben unterschiedliche Reifegrade. Historische Berichte sind keine Aussage zur aktuellen Produktreife.

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

## Benutzer- und Rechteverwaltung

Der aktuelle PR-Arbeitsstand ergänzt die vorhandene Authentifizierung/RBAC um tenant-scoped Benutzerverwaltung, konfigurierbare tenant-eigene Rollen, Berechtigungszuordnung mit Tenant-/Site-Scope, Status-/Sperrverwaltung, Sitzungswiderruf, Auditverlauf, sichere Passwortänderung und zeitlich begrenzte Passwort-Reset-Tokens. Der Mandant wird serverseitig aus der Session abgeleitet; Rollen/Berechtigungen werden nicht global für andere Mandanten geändert. Die Verwaltung ist online; Offlineänderungen an Konten oder Rechten sind nicht vorgesehen und ein Reset-Token wird nicht per E-Mail zugestellt. Diese Erweiterung ist noch nicht in `main`; API-Vertrag und Einschränkungen stehen in [USER_ADMINISTRATION_API.md](./USER_ADMINISTRATION_API.md).

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

Audit snapshot (2026-11-14): frontend `npm audit` — 0 vulnerabilities. Backend `npm --prefix frontend/backend audit` — 7 LOW findings for `deepmerge@4.3.1` (GHSA-gcqx-w2h4) in Jest/`ts-jest` development dependencies; `npm --prefix frontend/backend audit --omit=dev` — 0 production findings. Upstream has no patched 4.x release; do not force npm's breaking downgrade. Exact current test evidence is in [NEXT_DEVELOPMENT_REPORT.md](../docs/development/NEXT_DEVELOPMENT_REPORT.md).

---

## 3. Architektur & Sicherheitsgarantien
1. **RLS & Mandantenisolation**: RLS und `FORCE ROW LEVEL SECURITY` sind für ausgewählte tenantgebundene Tabellen konfiguriert; dies gilt nicht pauschal für jede historische Tabelle. Tenant-scoped API-Zugriffe setzen ihren Datenbankkontext aus der authentifizierten Sitzung.
2. **Offline-Sync & Idempotenz**:
   - `POST /api/v1/sync/push` verarbeitet Mutationen atomar via PostgreSQL Transaction Advisory Locks und persistiert Quittungen in `sync_idempotency_receipts`.
   - `POST /api/v1/sync/conflicts/resolve` trennt Konfliktentscheidungen in `sync_conflict_resolution_receipts`.
   - Das Frontend entfernt Mutationen erst nach bestätigtem Servererfolg (`applied: true`, `serverState`); bei Fehlern bleibt die Outbox unversehrt.
3. **Least-Privilege**: Die Anwendung verbindet sich im operativen Betrieb ausschließlich als unprivilegierter Benutzer `secops_app_user` (ohne Superuser- oder BYPASSRLS-Rechte).

## 4. Dokumentenmanagement

Das DMS verwendet `/api/v1/documents` und PostgreSQL-Migration `012_document_management.sql`. Es persistiert Dokumentmetadaten, tenantgebundene Ordner/Kategorien/Tags, Beziehungen, unveränderliche Versionen und Append-Only-Auditereignisse. Datei-Uploads werden serverseitig anhand Signatur und Inhalt geprüft und unter einem generierten Schlüssel im privaten persistenten Speicher außerhalb des Frontends abgelegt. Die Standardgrenze beträgt 10 MiB pro Datei (`DMS_MAX_FILE_SIZE_BYTES`, maximal 100 MiB).

DMS-Dateien liegen in einem privaten S3-kompatiblen Speicher und werden bei aktivierter Pflichtprüfung erst nach erfolgreichem ClamAV-Scan freigegeben. Nicht verfügbare oder fehlgeschlagene Prüfungen bleiben in Quarantäne. Produktion erfordert HTTPS-S3-Zugangsdaten und einen erreichbaren Scanner; lokal stehen MinIO/ClamAV über `deploy/docker-compose.minio.yml` bereit. S3-Objekte müssen unabhängig von den verschlüsselten Datenbank-Backups gesichert werden. DMS-Dateizugriff und Änderungen sind online erforderlich; Metadaten werden nicht in IndexedDB/LocalStorage gespeichert.

API-Details und bekannte Einschränkungen stehen in [DOCUMENTS_API.md](./DOCUMENTS_API.md) und [DMS_IMPLEMENTATION_REPORT.md](../DMS_IMPLEMENTATION_REPORT.md).
