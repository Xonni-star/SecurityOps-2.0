# SecurityOps 2.0 – Systemaudit und Entwicklungsfahrplan

**Prüfstand:** 2026-11-12
**Geprüfter Stand:** main / ba914fb4e90dcbd890786df4c15f633a7458ae4a (vor Audit-Commit)
**Scope:** ausschließlich Analyse und Dokumentation. Keine Änderungen an Anwendungscode, Datenbank oder Migrationen.

## 1. Zusammenfassung

SecurityOps 2.0 besteht aus einer React-19-/Vite-SPA, einer TypeScript-/Express-API und PostgreSQL 16+. Login, tenantgebundene CRUD-Teilbereiche, RBAC, Row-Level Security, append-only Wachbuch-Grundlagen und eine IndexedDB-Outbox existieren. Das Gesamtsystem ist nach dem vorliegenden Code- und Testnachweis **nicht vollständig abgenommen und nicht als vollständig produktionsreif einzustufen**: mehrere Fachmodule sind lokal/mockbasiert oder ohne serverseitige Persistenz; eine vollständige Offline-/Browserabnahme für alle Geschäftsabläufe fehlt.

Schwerpunkte für die weitere Arbeit:
1. Dokumente, Dienstanweisungen, Alarm-/Notfallpläne sowie mobile Übergaben und Kontrollgänge Ende-zu-Ende integrieren.
2. Offline-Synchronisierung und Berechtigungsmatrix für alle Mutationen vollständig verifizieren.
3. Sensible Browser-/Offline-Daten und Session-/Berechtigungswiderruf härten.
4. Den parallelen Python-/FastAPI-Altbestand gegenüber dem TypeScript-Produktionsbackend abgrenzen.
5. Betriebs-, Backup-/Restore- und Browserabnahme nachweisen.

Die Vorgabe, keine KI-Integration ins Produkt einzubauen, wird im aktuellen Stand eingehalten: Tests prüfen entfernte AI-Funktionen; CI scannt den Frontend-Build auf bekannte Modell-API-Endpunkte/Schlüsselindikatoren. Das ersetzt keinen allgemeinen Security- oder Dependency-Audit.

## 2. Architektur und Projektbestand

- Frontend: frontend/App.tsx, frontend/components/, frontend/store.ts, frontend/types.ts; React, Vite, TypeScript und Zustand. API-Zugriff über frontend/services/apiClient.ts.
- Offline: frontend/services/indexedDbService.ts definiert Outbox, Inbox und lokale Anhänge; Store verwaltet Mutation-ID, Tenant, Revision, Retry und Konfliktzustände.
- Produktbackend: frontend/backend/src/app.ts mit Express-Routen unter /api/v1; Controller in src/controllers; PostgreSQL-Hülle in src/config/database.ts.
- Migrationen: frontend/backend/src/migrations/001 bis 007. Sie definieren Nutzer/Rollen, Fachentitäten, RLS, Sync-Quittungen, Versionierung und Mitarbeiter-Lifecycle.
- Produktion: frontend/deploy/docker-compose.production.yml, Dockerfiles und Caddy-Konfiguration; Compose beschreibt Caddy → TypeScript-Backend → PostgreSQL. PostgreSQL wird nicht direkt über einen Host-Port veröffentlicht.
- CI/CD: .github/workflows/ci.yml und ci_cd.yml; Root-Smoke-Start, Frontend-/Backend-Builds, PostgreSQL-16-Tests und Docker-Produktionsbuilds.
- Parallelbestand: frontend/backend/api.py, models.py, database.py, schemas.py, services.py, worker.py, frontend/alembic/ sowie Python-Testdateien bestehen neben dem TS-Stack. Die Root-Anleitung und das Produktions-Compose benennen TypeScript als maßgeblichen Produktpfad. Ob und wofür der Python-Code noch unterstützt wird, bleibt unklar.

### Datenbankschema

Migration 001 enthält tenants, users, Rollen/Berechtigungen/Sessions, clients, sites, employees, employee_qualifications, shifts, guardbook_entries/revisions, keys, tasks, patrol_scans, shift_handovers, Sync-Receipt- und Audit-Tabellen. Migrationen 002/003 ergänzen Idempotenz, Revisionen und Konfliktquittungen; 004 operative Löschrechte; 005/006 Archivierung für Kunden/Standorte; 007 Mitarbeiterarchivierung, Qualifikationsversionierung und employee_absences.

Keine entsprechenden serverseitigen Tabellen für Dokumentenablage, SOP-Inhalte, Alarm-/Einsatzpläne oder Evakuierungspläne gefunden. Diese Aussagen basieren auf versionierten Migrationsdateien, nicht auf einer produktiven Datenbankverbindung oder realen Kundendaten.

## 3. Bewertung der 16 Fachbereiche

| Nr. | Modul | Status | Nachweis und offene Lücke |
|---:|---|---|---|
| 1 | Kundenverwaltung | **TEILWEISE FERTIG** | Tabelle, tenantgebundene GET/POST/PATCH/Archiv- und Sync-Routen in app.ts/clientController.ts sowie UI/Store vorhanden. Vollständiger Restore-/Berechtigungs-/Offline-E2E-Nachweis fehlt. |
| 2 | Standortverwaltung | **TEILWEISE FERTIG** | Liste, Anlage, Update, Archivierung, Wiederherstellung und Sync für sites; UI/Store angebunden. Unterobjekte und vollständige fachliche Abnahme offen. |
| 3 | Mitarbeiterverwaltung | **TEILWEISE FERTIG** | Persistente Stammdaten, Revisionen, Archiv/Restore und Offline-Sync-Pfad; aktuelle Integrationstests prüfen wesentliche Fehlerfälle. Import, Datenschutz-Lifecycle und vollständiger Geräte-/Reconnect-Nachweis offen. |
| 4 | Qualifikationen und Abwesenheiten | **TEILWEISE FERTIG** | Tabellen, API, getrennte Permissions, Revisions- und Überschneidungsprüfungen und Sync-Aktionen vorhanden. Dokumente sind nur Referenzen; keine gemeinsame Dokumentenablage. Nicht alle UI-/Offline-Szenarien fachlich abgenommen. |
| 5 | Dienst-/Schichtplanung | **TEILWEISE FERTIG** | shifts CRUD, UI/API und Sync-Unterstützung vorhanden. Arbeitszeit-/Ruhezeitregeln und umfassende Planungs-E2E sind nicht nachgewiesen. |
| 6 | Schlüsselverwaltung | **TEILWEISE FERTIG** | keys CRUD und UI/API vorhanden. Vollständige Ausgabe-/Rückgabehistorie und Offline-Konsistenz nicht abgenommen. |
| 7 | Aufgabenverwaltung | **TEILWEISE FERTIG** | tasks CRUD und UI/API vorhanden; Outbox-Pfade bestehen. Nicht alle Status-/Retry-/Berechtigungsfälle getestet. |
| 8 | Digitales Wachbuch | **TEILWEISE FERTIG** | Persistente Einträge, Revisionen, Append-only DB-Schutz und Outbox/Sync vorhanden. Vollständige mobile, Medien-, Export- und Wiederherstellungsabnahme fehlt. |
| 9 | Dokumentenverwaltung | **NICHT FERTIG** | UI und lokale IndexedDB-Anhangsbausteine vorhanden; serverseitige Dokumententabelle, Upload-/Download-API und persistente gemeinsame Ablage nicht nachgewiesen. |
| 10 | Dienst-/Arbeitsanweisungen | **NICHT FERTIG** | UI-/Acknowledge-Bausteine, aber keine SOP-Tabelle oder Fach-API in den TS-Migrationen/Routen nachgewiesen. |
| 11 | Alarm-/Einsatzpläne | **NICHT FERTIG** | AlarmsModule vorhanden, aber keine Alarm-/Einsatzplan-Tabelle oder Fach-API gefunden. |
| 12 | Notfall-/Evakuierungspläne | **NICHT FERTIG** | Keine dedizierte Datenstruktur, API oder serverseitige Persistenz gefunden. Nicht mit der vorhandenen Alarm-UI gleichsetzen. |
| 13 | Dienstübergaben | **TEILWEISE FERTIG** | shift_handovers-Tabelle und Mobile-/Sync-Bausteine vorhanden; vollständiger Backend-Fachworkflow und Offline-E2E-Nachweis offen. |
| 14 | Kontrollgänge/-punkte | **TEILWEISE FERTIG** | patrol_scans-Tabelle und QR/NFC/Scan-UI sowie Sync-Bausteine vorhanden. Gerätekompatibilität und vollständige Offline-/Serverabnahme offen. |
| 15 | Benutzer-/Rechteverwaltung | **TEILWEISE FERTIG** | Argon2id-Login, JWT-Sessions, Permission-Middleware und Rollen-/Berechtigungstabellen; administrative Nutzer-/Rollen-API fehlt. Token wird clientseitig gespeichert. |
| 16 | Dashboard/Auswertungen | **TEILWEISE FERTIG** | Dashboard, CSV-/Druck-/Berichts-UI und Store-Auswertungen vorhanden. Datenherkunft nicht persistierter Module sowie Vollständigkeit der Tenant-/Rollenfilter nicht für alle Kennzahlen nachgewiesen. |

Keines der Gesamtmodule wird pauschal als FERTIG bewertet: Teilfunktionen können implementiert sein, aber vollständige fachliche Abnahme ist nicht belegt.

## 4. Sicherheit und Mandantentrennung

### Vorhandene Schutzmaßnahmen

- Express nutzt Helmet, CORS-Whitelist und Request-Body-Limit (frontend/backend/src/app.ts).
- JWT wird geprüft; Session-Hash, Widerruf und Ablauf werden in auth.ts nachgeschlagen. Tenant-ID kommt aus dem signierten JWT, nicht aus einem frei übermittelten Tenant-Header.
- Fachrouten prüfen Authentifizierung und benannte Berechtigungen; die Middleware enthält keinen pauschalen Systemadministrator-Bypass.
- Tenant-Transaktionen werden über withTenantTransaction ausgeführt. Migration 001 aktiviert und erzwingt RLS; spätere Tabellen und Receipt-Tabellen haben eigene RLS-Policies.
- Argon2id ist im Passwortpfad/Seed belegt. Produktions-DB-Rolle und Secret-Prüfung sind in Konfiguration/Compose vorgesehen.
- Wachbuch-/Revisionsschutz nutzt Datenbanktrigger und eingeschränkte Schreibrechte.
- Jest-Suiten enthalten RLS-, Tenant-Isolation-, Berechtigungs-, Migrations-, Idempotenz- und API-Integrationstests.

### Konkrete Risiken und Befunde

| ID / Priorität | Befund | Fundstelle / Einordnung |
|---|---|---|
| SEC-01 – HOCH | Browser-Token und Outbox-Daten sind keine verschlüsselte Ablage. Ein XSS kann einen im Browser gespeicherten Bearer-Token auslesen; IndexedDB liegt im selben Origin. | frontend/services/apiClient.ts, store.ts, indexedDbService.ts. Risikobefund, kein konkreter XSS-Exploit nachgewiesen. CSP/XSS- und Offline-Datenschutzabnahme fehlt. |
| SEC-02 – MITTEL | Kunden-PATCH und Archivroute verlangen customers:create statt separat abgebildeter update-/archive-Rechte. Das verhindert eine unabhängige Least-Privilege-Rollenvergabe, sofern diese granularen Rechte Geschäftsanforderung sind. | frontend/backend/src/app.ts, /customers/:id und /customers/:id/archive. Mit gewünschter Permission-Matrix abgleichen. |
| SEC-03 – MITTEL | Berechtigungen werden im JWT-Payload geführt; Änderungen können für bestehende Sessions bis Ablauf/Widerruf verzögert wirksam werden. | authController.ts stellt Token aus; middleware/auth.ts übernimmt permissions aus dem Payload und prüft Sessionwiderruf. Widerrufs-/Aktualitätsfenster explizit abnehmen. |
| SEC-04 – MITTEL | Schutz, Aufbewahrung und Löschung personenbezogener Offline-Daten/Anhänge sind nicht durch einen dokumentierten Abnahmetest belegt. | Mitarbeiter-/Kundendaten in Store und IndexedDB; Datenschutz- und Gerätesicherheitsprüfung offen. |
| SEC-05 – MITTEL | Parallel vorhandene Python-/Alembic-Dateien haben unklare Unterstützung gegenüber dem TS-Produktionspfad. Das erzeugt Drift-Risiko bei Fixes, Migrationen und Tests. | frontend/backend/api.py, worker.py, frontend/alembic und Python-Tests; keine Entfernung ohne Scope-Klärung. |
| SEC-06 – NIEDRIG/BETRIEB | Lokale Jest-/Dockerprüfungen waren wegen fehlender Test-DB/Env bzw. nicht erreichbarem Docker-Daemon nicht ausführbar. | Keine Produktlücke bewiesen; Remote-CI auf demselben Code-Commit war erfolgreich (siehe §7). |

Es wurde kein konkreter SQL-Injection-Fehler nachgewiesen; Controller verwenden überwiegend gebundene SQL-Parameter. Kein vollständiger Penetrationstest, SAST/DAST-Lauf, CVE-Audit, Browser-XSS-Test oder externer Mandantenangriffstest wurde durchgeführt. Es wird daher keine Sicherheitsgarantie behauptet.

## 5. Offlinefähigkeit und Integrität

indexedDbService.ts definiert Mutation-ID, Tenant/User/Device, Entität/Aktion, Payload, Zeitstempel, baseVersion, Retry-, Status- und Konfliktfelder. Der Store sendet Mutationen an Fach-Sync-Routen bzw. /sync/push. Bestätigte Mutationen werden entfernt; Konflikte/Fehler bleiben im lokalen Zustand. Konfliktauflösung entfernt Outbox-Einträge erst nach bestätigter Serverantwort.

Belegt sind Outbox-Verträge und gezielte Frontend-/Backendtests, darunter employee-sync, Konflikte, Idempotenz, stale revision und Tenant-Isolation. Nicht bewiesen ist ein vollständiger Offline-Test für alle Module und Geräte: Sessionablauf, Gerätewechsel, konkurrierende Offlineänderungen, Browser-Quota/Upgrade, Anhänge, Absturz/Restore und alle Permission-Ablehnungen benötigen noch systematische E2E-Abdeckung. Outbox-Payloads liegen unverschlüsselt im Browser.

## 6. Funktionierende Komponenten, die erhalten bleiben müssen

- PostgreSQL-Tenant-Isolation/RLS, tenantbezogene Transaktionshülle und Least-Privilege-App-Rolle.
- JWT-Sessionwiderruf, Argon2id-Passworthashes und explizite Permission-Middleware.
- Append-only Schutz des Wachbuchs, Sync-Idempotenz und Konfliktquittungen.
- Bestehende API-/Store-Slices für Kunden, Standorte, Mitarbeiter, Schichten, Schlüssel und Aufgaben.
- IndexedDB-Transaktionsabschlussbehandlung, Mutation-IDs, Versionskonflikt- und Retry-Verhalten.
- CI mit PostgreSQL-16-Service, Migrationen, Root-Smoke-Start, Frontend-/Backend-Tests, Compose-Prüfung und Docker-Builds.
- Keine KI-Abhängigkeiten oder KI-Produktintegration wieder hinzufügen; Removed-AI-Tests und CI-Build-Scan erhalten.

## 7. Tests und tatsächlicher Status

### Lokal ausgeführt

| Prüfung | Ergebnis | Details |
|---|---|---|
| Backend TypeScript Build | **BESTANDEN** | npm run build im Backend, tsc Exit 0. |
| Backend Jest mit PostgreSQL 16 | **NICHT LOKAL AUSFÜHRBAR** | Jest brach in src/config/env.ts wegen fehlender gültiger lokaler Testkonfiguration ab; keine lokale .env/Testdatenbank vorhanden. Kein Testresultat daraus behauptet. |
| Frontend Vitest | **BESTANDEN** | 3 Testdateien, 24 Tests; removed AI, Store-Konfliktvertrag und API-Integration. |
| Frontend Produktionsbuild | **BESTANDEN** | Vite Build erfolgreich. Nicht-blockierende Hinweise: __dirname bei künftigem nativem Config-Loader und JS-Bundle über 500 kB. |
| Compose-Konfigurationsprüfung | **BESTANDEN** | docker compose config --no-interpolate --quiet, Exit 0. |
| Produktions-Docker-Build lokal | **NICHT AUSFÜHRBAR** | Docker-Daemon-Socket nicht erreichbar. Keine lokalen Image-Builds behauptet. |

### GitHub Actions – remote und abgeschlossen

Für Commit ba914fb4e90dcbd890786df4c15f633a7458ae4a wurden die tatsächlichen Actions-Läufe und Jobs abgefragt:

- CI #43185361355: **success**, alle vier Jobs grün: Root-Install/Migration/Smoke-Start; Frontend Vitest/Build; Backend TypeScript/PostgreSQL-16-Migrationen/Jest; Produktions-Compose und beide Docker-Image-Builds. https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43185361355
- CD #43185587533: **success**; Release-Job lud Frontend-/Backend-Artefakte, erzeugte Manifest und sicherte das Release-Paket. https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43185587533

Remote-CI ist kein lokaler Lauf, belegt aber die erfolgreiche PostgreSQL-16- und Docker-Ausführung auf genau diesem Code-Stand. Für den Audit-Dokumentationscommit folgen eigene CI/CD-Läufe und werden im Abschluss separat geprüft.

## 8. Priorisierte offene Aufgaben

### P0 – vor produktivem Einsatz
1. Datenfluss/Datenschutz für Personal- und Kundendaten, IndexedDB/Anhänge, Token, Aufbewahrung/Löschung und Gerätesperre prüfen.
2. Automatisierte Security-Gates ausbauen: Tenant-Read/Write für jede Route, vollständige Berechtigungsmatrix, XSS/CSP, Sessionwiderruf/Permission-Revocation, Login-Bruteforce und Dependency-Scan.
3. Browser-/Mobil-E2E für Login, Kernmutationen, Offline, Wiederverbindung und Konflikte auf unterstützten Geräten festlegen.

### P1 – Datenintegrität und Produktumfang
4. Dokumente, SOPs, Alarm-/Einsatz- und Notfall-/Evakuierungspläne serverseitig integrieren: Migration, API, Berechtigung, RLS, Audit, Backup und UI.
5. Übergaben/Kontrollgänge vollständig vom Mobile-UI bis DB/API, Idempotenz, Tenant-RLS und Offlinekonflikt abnehmen.
6. Für jeden Mutationstyp Outbox-ID, Tenant, Revision, Duplicate, ID-Inhaltskollision, Retry, Konflikt, Permission-Reject und Outbox-Erhalt testen.
7. Fachregeln der Kernmodule schließen: ArbZG-/Ruhezeiten, Schlüsselhistorie, Kunden-Archiv/Rechte, Berichts-Datenherkunft und sämtliche Restore-/Offlinepfade.
8. Benutzer-/Rollenadministration implementieren, falls Produktanforderung; Berechtigungsentzug muss nach festgelegtem SLA wirksam werden. Alternativ Scope begrenzen.

### P2 – Betrieb und Wartbarkeit
9. TS-Backend gegenüber Python-/Alembic-Bestand abgrenzen; unterstützte Pfade dokumentieren, erst danach Altbestand behandeln.
10. Staging-Upgrade, Backup/Restore-Drill, Secret-Rotation, Monitoring, Log-Redaktion und Runbooks nachweisen.
11. Bundle-Splitting, Lint-/SAST-/Dependency-Checks und Action-Runtime-Warnungen in Wartungsplan aufnehmen.
12. README, Installations-, Modul- und Abschlussdokumente aus aktuellem Stand synchronisieren; historische Snapshots klar markieren.

## 9. Nummerierter Entwicklungsfahrplan

| Phase | Ziel | Abnahmekriterien |
|---|---|---|
| 1 – Scope & Audit-Baseline | Dieses Audit reviewen; TS/Python, Modulumfang, Rollen, Offline-Datenschutz und unterstützte Geräte entscheiden. | Owner-Freigabe der priorisierten Anforderungen; Datenfluss-/Architekturkarte; keine ungeklärten produktiven Backendpfade. |
| 2 – Sicherheit & Mandantengates | Permission-Matrix, RLS, Sessionwiderruf, Browserdaten und Sicherheitstests schließen. | Positive/negative Tests pro Route/Rolle; Cross-Tenant Read/Write für jede Entität; dokumentierter Token-/Offline-/XSS-Test; CI grün. |
| 3 – Kern-Outbox-Abnahme | Wachbuch und Kernmutationen offline-/konflikt-/retryfest abnehmen. | PostgreSQL-16-Integration plus Browser-E2E für create/update/archive/restore/review; keine Mutation verschwindet vor bestätigter Receipt; Idempotenz/Stale-Version grün. |
| 4 – Fehlende operative Module | Dokumente, SOP, Alarm/Notfall, Übergabe und Kontrollgänge persistent integrieren. | Je Modul Migration/API/UI/Permission/RLS/Audit/Backup dokumentiert; E2E und erforderliche Offlinefälle bestanden; keine Mock-only-Produktaktion. |
| 5 – Fachregeln & Reporting | Arbeitszeit, Schlüsselhistorie, Berichte und fachliche Exporte schließen. | Regelkatalog mit Grenzfällen; DB/API-Tests; tenant-/permission-gefilterte, reproduzierbare Berichte. |
| 6 – Produktionshärtung & Abnahme | Deployment, Upgrade, Restore, Monitoring und Nutzerakzeptanz erproben. | Staging-Migration, Restore-Drill, Geräte-/Browsermatrix, Sicherheitstest, Runbooks, komplette grüne CI/CD und formale Produktfreigabe. |

Phase 2 ist Voraussetzung für die sichere Ausweitung von Offline-/Personalbereichen; Phase 3 setzt festgelegte Tenant-/Rollen-/Datenhaltungsregeln voraus. Phase 6 erst nach Scope- und Fachabnahme.

## 10. Grenzen des Audits

- Keine Code-, Schema- oder Datenbankänderung; ausschließlich diese Audit-Datei wird neu erstellt.
- Kein produktives System, reale Mandantendaten, Deployment-Host, Penetrationstest oder Browser-/Mobilgerät verfügbar.
- Backend-Jest lokal nicht startbar wegen fehlender Testkonfiguration/DB; GitHub CI mit PostgreSQL 16 erfolgreich.
- Docker-Daemon lokal nicht verfügbar; Docker-Produktionsbuilds in GitHub Actions erfolgreich.
- Bewertung gilt für den oben genannten Commit; spätere Änderungen können Befunde verändern.

**Geplante Dokumentationsänderung:** ausschließlich SYSTEM_AUDIT_REPORT.md. Commit: docs: add comprehensive system audit.
