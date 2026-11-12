# Alarm- und Notfallmanagement: Implementierungsbericht

## Ergebnis

Umgesetzt wurde das im verfügbaren Auftrag sichtbare Alarm- und Notfallmanagement. Die zugehörige Master-Brief-Anlage war in der Session-Library nicht verfügbar; deshalb lässt sich die Vollständigkeit gegenüber den dort möglicherweise enthaltenen zusätzlichen Akzeptanzkriterien nicht bestätigen. Dieser Bericht beansprucht keine darüber hinausgehende Abnahme.

## Implementierter Umfang

- Neue PostgreSQL-Migration mit mandantengebundenen Notfallplänen, Alarmvorfällen und unveränderlichen Ereignissen. Zusammengesetzte Mandantenschlüssel begrenzen Objekt- und Planbeziehungen auf denselben Mandanten.
- `FORCE ROW LEVEL SECURITY` für alle drei Tabellen sowie eingeschränkte Rechte der Anwendungsrolle. Ereignisse sind für die Anwendungsrolle nur einfügbar; Trigger weisen Aktualisierung und Löschung zurück.
- Authentifizierte, berechtigungsgeprüfte Endpunkte zum Verwalten und Archivieren von Plänen, Dokumentieren eines Übungsdatums, Melden von Vorfällen, Reagieren auf Vorfälle und Lesen der Ereignisverläufe.
- Revisionsgeschützte Änderungen und serverseitig geprüfte Statusübergänge. Jede Reaktion verlangt eine nichtleere Maßnahme/Begründung; abgeschlossene Vorfälle können nicht wieder geöffnet werden.
- Ersetzung der statischen Alarmansicht durch eine API-gestützte Oberfläche mit Vorfallmeldung, Planverwaltung, Übungsdatum, Reaktionen und Verlauf. Der Alarmbereich ist in die bestehende Mobile-App-Navigation eingebunden.
- Seed-Rollen und Berechtigungen sowie fokussierte Backend-, RLS-/API-Integrations- und Frontendtests.

Details zu Endpunkten, Rollen und Grenzen stehen in [Alarm- und Notfallmanagement: API](./frontend/ALARM_EMERGENCY_API.md).

## Verifizierte lokale Prüfungen

Alle folgenden Prüfungen liefen lokal; die datenbankgebundenen Prüfungen nutzten einen isolierten Docker-Container mit PostgreSQL 16.15. Die vollständige Backend-Testsuite führte auch Migrationen und RLS-/Mandantentrennungsprüfungen aus.

| Prüfung | Ergebnis |
|---|---|
| `npm --prefix frontend/backend test` | 15 Suites, 186 Tests bestanden |
| `npm --prefix frontend test` | 9 Dateien, 48 Tests bestanden |
| `npm --prefix frontend/backend run build` | erfolgreich |
| `npm --prefix frontend run build` | erfolgreich |
| Migration, RLS-/API-Integration gegen isoliertes PostgreSQL | in der vollständigen Backend-Testsuite bestanden |
| Produktions-Compose-Konfiguration | `docker compose ... config --no-interpolate --quiet` erfolgreich |
| Backend- und Frontend-Container-Images | lokale Docker-Builds erfolgreich |
| `git diff --check` | ohne Beanstandungen |

Der Frontend-Build gibt bestehende Vite-Konfigurations- und Bundlegrößen-Warnungen aus, endet aber erfolgreich. Die Docker-Prüfung validierte die Produktions-Compose-Konfiguration und baute beide Images; es wurden keine Images gestartet und keine Bereitstellung vorgenommen.

## Einschränkungen und Freigabestatus

- Die Master-Brief-Anlage und ihre vollständigen Akzeptanzkriterien konnten nicht geprüft werden.
- Keine externen Leitstellen-/Telefonieintegrationen, Push-Benachrichtigungen oder automatischen zeitgesteuerten Eskalationen.
- Keine Offline-Erfassung oder spätere Synchronisierung von Alarmen.
- Übungsdokumentation speichert das jüngste Übungsdatum am Plan und ein Ereignis; separate Datensätze je Übung gibt es nicht.
- Die Alarm-API bietet derzeit feste Höchstgrenzen statt konfigurierbarer Pagination/Filterung.
- Es fand keine Produktionsbereitstellung statt. Die Implementierung ist nicht für Produktion freigegeben.
- Ein Pull Request und dessen CI-Ergebnis sind noch ausstehend.
