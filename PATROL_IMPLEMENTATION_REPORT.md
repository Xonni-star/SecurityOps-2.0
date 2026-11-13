# Kontrollgangsmanagement – Spezifikationsaudit und Implementierungsbericht

## Repository- und PR-Stand

- Die vollständige 641-zeilige Spezifikation wurde gelesen und als Abnahmekriterien geprüft; sie war nicht „nicht verfügbar“.
- Ausgangsbasis: `main` nach Integration von PR #13, Commit `5608b9010096ebac06a000ed2a2870dadd66ab60`.
- Feature-Branch: `xonni-star-feature-patrol-management`; PR [#14](https://github.com/Xonni-star/SecurityOps-2.0/pull/14) ist gegen `main` offen. Nicht gemergt.
- PR #13 ist laut ursprünglichem Auftrag vor Beginn dieses Features in `main` integriert. Diese Arbeit ändert `main` nicht.
- Es gibt keinen Produktionsrollout und keine Produktionsbereitschafts- oder Compliance-Aussage.

## Implementiert

- Mandantengebundene Kontrollpunkte mit kryptografisch zufälligem 256-Bit-QR-Token (nur SHA-256 gespeichert), Rotation, Bearbeitung, Aktivierung/Deaktivierung und Archivierung.
- Kontrollpunkt-Metadaten für Gebäude, Bereich und optionale GPS-Koordinaten; Constraints erzwingen gültige, gepaarte Koordinaten.
- Versionierte Routen mit geordneten Kontrollpunkten sowie Archivierung; historische Versionen und Rundgänge werden nicht umgeschrieben.
- Kontrollgangsstart, Scans, Abschluss und Abweichungen über versionierte Backend-Routen, serverseitiges RBAC, Tenant-Transaktionen und RLS/FORCE RLS.
- Offline-Start, Scan und Abschluss in einer persistenten IndexedDB-Outbox. Routendaten, Kontrollpunkte und aktive/lokal abzuschließende Rundgänge werden partitioniert nach Tenant und Nutzer gespeichert und nach Browser-Neustart wiederhergestellt.
- Outbox-Reihenfolge Start → Scan/Abweichung → Abschluss; Wiederverbindungsereignisse starten Sync. Ein Netzausfall trotz positivem Browser-Online-Status reiht Start/Abschluss mit derselben Mutations-ID ein, damit ein verlorenes Server-ACK idempotent wiederholt werden kann.
- Gemeinsame Payload-Hash-Konvention für direkte und synchronisierte Rundgangs-Mutationen; Wiederholungen mit geänderter Payload werden abgewiesen. Client-Erfassungszeit und Servereingangszeit des Abschlusses sind getrennt gespeichert.
- QR-Detection und Web NFC werden nur genutzt, wenn Browser/Gerät sie bereitstellen; manuelle Eingabe bleibt als nicht verifizierte Erfassungsart gekennzeichnet.
- Kein Patrol-Benachrichtigungsprovider wird behauptet oder simuliert. Dienst-/Schichtplanung wurde nicht begonnen.

## Migrationen und Sicherheit

- `020_patrol_management.sql`: Patrol-Tabellen, zusammengesetzte Tenant-/Site-Beziehungen, RLS und FORCE RLS, append-only Scan-/Routenversions-/Abweichungs-/Audit-Historien sowie bestehende grobe Patrol-Rechte.
- `021_patrol_offline_round_completion.sql`: Abschluss-Mutations-ID und Payload-Hash, getrennte lokale Abschluss- und Servereingangszeit sowie Integritäts-Constraints.
- `022_patrol_checkpoint_location_and_lifecycle.sql`: Gebäude-/Bereichs-/GPS-Metadaten, Koordinaten-Constraints und Index für nicht archivierte Routen (Route `archived_at` stammt bereits aus Migration 020).
- Jede API-Mutation prüft serverseitig Authentifizierung, Berechtigung und Tenant-Zugehörigkeit. Mitarbeiterzugriff wird über `employees.account_user_id` plus aktive Objektzuweisung bestimmt.
- Die Berechtigungen bleiben gröber als die Spezifikation es fordert; es gibt keine getrennten Rechte für einzelne Lese-, Abschluss-, Auswertungs- und Abweichungsbearbeitungsaktionen.

## Audit der Spezifikationskriterien

| Bereich | Status |
|---|---|
| Kontrollpunkte: Anlegen, Bearbeiten, Aktivieren/Deaktivieren, Archivieren, QR-Token, Objekt, Gebäude/Bereich, Standort und GPS | Implementiert; echte Kamera-/NFC-Hardware nicht E2E-verifiziert |
| Routen: Erstellen, versionieren, Reihenfolge, Archivieren | Implementiert |
| Routenzeitfenster, Soll-Dauer, Toleranzen, Mitarbeiter-/Gruppenzuweisung, Wiederholung, feste/flexible Reihenfolge | Noch offen; aktuelles Datenmodell bietet diese Planungskonfigurationen nicht |
| Rundgang: Mitarbeiter/Objekt/Route-Version, Start, Scans, Ende und manuelle Abweichungen | Implementiert |
| GPS je Scan, Fotos/Anlagen, Bemerkungen bei Rundgangsabschluss | Noch offen |
| Dashboard und Objekt-/Datumsfilter, Scan-/Abweichungshistorie | Teilweise implementiert; Mitarbeiter-/Routen-/Abweichungstyp-/Kundenfilter und vollständige Auswertungen fehlen |
| Automatische Erkennung fehlender/verspäteter/abgebrochener Rundgänge und ungewöhnlicher Zeitabweichungen | Noch offen; ungültige und doppelte Scans werden abgewiesen, aber nicht als vollständige revisionssichere Abweichungshistorie ausgewertet |
| Alarm-/Benachrichtigungsintegration | Nicht angebunden; kein konfigurierter Patrol-Provider vorhanden |
| Tenant-Isolation, RLS/FORCE RLS, serverseitiges RBAC, append-only Historien | Implementiert mit groben statt vollständig granularen Patrol-Rechten |
| Offline-Start, Scan, Abschluss, persistente Outbox, Neustart-Recovery, Idempotenz, Wiederverbindungs-Sync | Implementiert; Konflikte bleiben lokal sichtbar/erhalten, besitzen aber keinen Patrol-spezifischen Auflösungsablauf |
| Browser-E2E auf realen Mobilgeräten, Netzverlust-/Kamera-/NFC-Hardwareprüfung | Noch nicht ausgeführt |
| Dienst-/Schichtplanung | Nicht begonnen, wie beauftragt |

Die offenen Punkte oben sind Implementierungsumfang, keine externen Produktionsblocker. PR #14 erfüllt deshalb noch nicht die vollständige Spezifikation und bleibt zur unabhängigen Prüfung offen.

## Tatsächlich ausgeführte Prüfungen

| Prüfung | Ergebnis |
|---|---|
| Backend-TypeScript-Build | bestanden |
| PostgreSQL 16 Migration + Seed | bestanden; frische Datenbank, Migrationen 001–022 und Seed |
| Migrationsintegration | 65 Tests bestanden, inkl. Migration 021/022, RLS/FORCE RLS, Baseline und Koordinaten-Constraints |
| Patrol API-Integration | 1 Test bestanden, inkl. Offline-Start/Scan/Abschluss, Retry/Hash-Idempotenz, direkte API-/Outbox-Wiederholung, Tokenrotation, Koordinaten, Bearbeiten/Aktivieren/Archivieren |
| Gesamte Backend-Jest-Suite | 20 Suites / 219 Tests bestanden |
| Frontend-Vitest | 11 Dateien / 56 Tests bestanden, inkl. Outbox-Neustart, Routen-/Rundgangscache, Event-Reihenfolge und Sync bei Wiederverbindung |
| Frontend-Produktionsbuild | bestanden; bestehende Vite-Konfigurations- und Chunkgrößenwarnungen |
| Python Mobile API-Regressionstest | 2 Tests bestanden (`PYTHONPATH=frontend python3 -m pytest -q frontend/tests/test_mobile_api.py`) |
| Vollständige historische Python-Suite | nicht bestanden/nicht lauffähig in der aktuellen lokalen Umgebung: fehlendes `greenlet` und veraltete Imports (`Tenant`, `DeviceStatus`); die Patrol-Änderungen betreffen diese Python-Modelle nicht |
| Docker Compose / Images | Produktions-Compose validiert; Backend- und Frontend-Docker-Images gebaut |
| GitHub Actions | für den zuvor veröffentlichten Head `8424abd5ca7db53d877892dc4137720f5b4c1b06` waren vier Checks erfolgreich. Die neuen lokalen Änderungen sind noch nicht gepusht; CI für den aktualisierten Head ist daher ausstehend und wird nicht als erfolgreich behauptet. |

## Grenzen

Web NFC und Kamera hängen von Browser, Secure Context, Berechtigungen und Gerät ab. Offline-Scans sind vor serverseitiger Prüfung kein verifizierter Servernachweis. Ein kopierter QR-Code ist kein kryptografischer Anwesenheitsbeweis. Browser-Offline-Events garantieren keine Hintergrundausführung nach App-Schließung. Patrol-Konflikte bleiben in der Outbox erhalten; automatische oder fachliche Konfliktauflösung fehlt. Keine dieser Einschränkungen wird als Produktionsfreigabe bewertet.
