# SOP-Implementierungsbericht

## Status

Die Dienstanweisungsfunktion ist in der bestehenden React-/Express-/PostgreSQL-Architektur implementiert. Die Umsetzung wurde lokal getestet; es fand keine Bereitstellung statt. Das Gesamtsystem ist dadurch nicht als produktionsbereit bewertet.

## Umgesetzter Umfang

- Migration `013_sop_instructions.sql` ergänzt tenantgebundene Dienstanweisungen, unveränderliche Versionen und Workflowereignisse sowie Zuweisungsziele und personenbezogene Bestätigungen. RLS ist für alle SOP-Tabellen aktiviert und erzwungen.
- Die API `/api/v1/sops` unterstützt Entwürfe, Versionsentwürfe mit Änderungsgrund, Einreichung, Prüfung, Freigabe, Veröffentlichung, Rücknahme, Archivierung, Zuweisungen, Bestätigungen, Erinnerungen und gefilterte JSON-Berichte.
- Autor, Prüfer und Freigebender sind im Workflow voneinander getrennt: Autor und Prüfer können dieselbe Anweisung nicht freigeben. Die Seed-Routine vergibt SOP-Berechtigungen auch bei einer Neuinstallation, bei der Rollen erst nach Migrationen angelegt werden.
- Objekt- und Kundenziele werden bei Veröffentlichung anhand zukünftiger Schichten auf aktive Mitarbeiter aufgelöst. Die Datenbank beschränkt SOP- und DMS-Referenzen auf denselben Mandanten.
- Beschäftigte können nur ihre eigene zugewiesene aktuelle Version bestätigen. Bestätigungen benötigen eine ausdrückliche Bestätigung und werden serverseitig einer aktiven Mitarbeiterzuordnung mit passender authentifizierter E-Mail zugeordnet.
- Offline-Bestätigungen werden im Browser unter Mandant und Benutzer lokal vorgemerkt. Sie bleiben bis zur Serverbestätigung ausstehend und werden nicht auf eine abweichende Zuweisung oder Version übertragen.
- SOPs können auf vorhandene DMS-Dokumente verweisen; Dateien werden nicht dupliziert.
- Die SOP-Oberfläche bietet Suche/Filter, Bearbeitung, Workflowaktionen, Versionshistorie, Zuweisungen, Kenntnisnahmen, Erinnerungen und Berichte. Serverberechtigungen bleiben maßgeblich; die UI ersetzt keine API-Autorisierung.

## Verifizierte Prüfungen

- Backend: `npm test` — **13 Testsuiten, 169 Tests bestanden**, einschließlich API-Integration, Migrationen, RLS-/Mandantentrennung sowie Reviewer-/Approver-Trennung.
- Backend: `npm run build` — TypeScript-Build bestanden.
- Frontend: `npm test` — **7 Testdateien, 42 Tests bestanden**.
- Frontend: `npm run build` — Vite-Produktionsbuild bestanden. Vite meldet bestehende Warnungen zu `__dirname` in der Konfiguration und zur Größe des JavaScript-Bundles.
- Migration `013` und die Migration-/RLS-Tests liefen auf einem isolierten PostgreSQL-16-Testcontainer; die Migrationstests bestanden **61 von 61**.
- `docker compose ... config --quiet` sowie die Docker-Produktionsbuilds für Backend und Frontend bestanden.
- Ein eigenständiger Frontend-`tsc`-Lauf ist im Repository nicht konfiguriert; der explizite Compilerlauf kann mangels React-Typdeklarationen (`@types/react`) nicht erfolgreich ausgeführt werden. Der Vite-Build und die Frontendtests liefen erfolgreich.

## Einschränkungen

- Objekt- und Kundenzuordnungen verwenden zukünftige Schichteinsätze als Empfängergrundlage; ohne passende Schichten werden darüber keine Mitarbeiterzuweisungen erzeugt.
- Erinnerungen werden beim API-Abruf berechnet. Es gibt keinen Hintergrundscheduler, keine Push-Zustellung und keine automatische Eskalation.
- Berichte werden als JSON angeboten; CSV-/PDF-Export ist nicht umgesetzt.
- Offline-Bestätigungen verwenden `localStorage`, nicht die bestehende IndexedDB-Outbox. Sie sind lokal vorgemerkt, aber vor der Synchronisierung keine serverseitigen Bestätigungen.
- Es wurde kein Browser-E2E-Lauf, keine Bereitstellung, keine Betriebsabnahme und keine Produktionsbereitschaftszertifizierung durchgeführt.
