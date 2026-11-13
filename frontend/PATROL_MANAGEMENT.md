# Kontrollgangsmanagement

Dieses Dokument beschreibt den Patrol-Umfang, der im aktuellen Repository implementiert ist. Die im ursprünglichen Auftrag erwähnte 641-zeilige Spezifikation war in diesem Worktree und der Session-Bibliothek nicht verfügbar. Dieses Dokument behauptet daher nicht, unbekannte Anforderungen daraus abzudecken.

## Funktionaler Umfang

- Objektbezogene Kontrollpunkte mit einmalig ausgegebenem, kryptografisch zufälligem QR-Token; gespeichert wird nur ein SHA-256-Hash.
- Tokenrotation, softes Archivieren und unveränderliche Routenversionen mit geordneter Kontrollpunktliste.
- Rundgänge mit serverseitig gebundener Objekt-/Mitarbeiterzuordnung; Scans und Abweichungen sind unveränderlich.
- Dashboard sowie paginierte Scan-, Abweichungs-, Routen-, Kontrollpunkt- und Auditlisten mit Site-/Datumsfiltern.
- Mobile QR-, NFC- und manuelle Erfassung. Offline-Datensätze bleiben in der IndexedDB-Outbox bis eine Serverquittung vorliegt.

## API und Berechtigungen

Alle Endpunkte sind unter `/api/v1/patrol` registriert, benötigen eine authentifizierte Sitzung und verwenden tenant-scoped Datenbanktransaktionen. Änderungen werden zusätzlich über serverseitige RBAC-Berechtigungen geschützt.

### Rollenmatrix

| Rolle | Patrol-Rechte |
|---|---|
| Systemadministrator, Geschäftsführung, Einsatzleitung, Objektleitung | `patrol:read`, `patrol:create`, `patrol:manage`, `patrol:exception:create`, `patrol:audit` |
| Wachdienstmitarbeiter | `patrol:read`, `patrol:create`, `patrol:exception:create` |
| Qualitätsmanagement, Auditor | `patrol:read`, `patrol:audit` |

Die Rechte werden durch Migration 020 für bereits vorhandene Rollen und durch den Seed für frische Umgebungen zugewiesen. Jeder Endpunkt prüft die erforderliche Berechtigung im Backend; UI-Sichtbarkeit ist keine Autorisierungsgrenze.

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /dashboard` | `patrol:read` | Zähler für Scans, Rundgänge und Abweichungen |
| `GET /checkpoints` | `patrol:read` | Kontrollpunkte, optional `siteId` |
| `POST /checkpoints` | `patrol:manage` | Kontrollpunkt anlegen; liefert den QR-Payload-Token einmalig |
| `POST /checkpoints/:id/rotate-token` | `patrol:manage` | Token invalidieren und ersetzen; liefert neuen QR-Payload-Token einmalig |
| `POST /checkpoints/:id/archive` | `patrol:manage` | Kontrollpunkt archivieren |
| `GET /routes` | `patrol:read` | Routen und aktuelle Versionen |
| `POST /routes` | `patrol:manage` | Route samt erster Version anlegen |
| `POST /routes/:id/versions` | `patrol:manage` | Neue unveränderliche Routenversion veröffentlichen |
| `GET /rounds` | `patrol:read` | Eigene Rundgänge, mit Site-/Status-/Datumsfilter |
| `POST /rounds` | `patrol:create` | Rundgang idempotent beginnen |
| `POST /rounds/:id/complete` | `patrol:create` | Aktiven eigenen Rundgang abschließen |
| `GET /scans` | `patrol:read` | Paginierte Scanhistorie |
| `GET /exceptions` | `patrol:read` | Paginierte Abweichungshistorie |
| `POST /exceptions` | `patrol:exception:create` | Abweichung idempotent erfassen |
| `GET /events` | `patrol:audit` | Append-only Auditereignisse |
| `POST /sync` | mutation-spezifisch | Offline-Scans/Abweichungen mit Mutations-ID synchronisieren |

Listen unterstützen je nach Endpunkt `siteId`, `from`, `to`, `status`, `category`, `search`, `limit` und `offset`; nicht jeder Filter wird von jeder Liste ausgewertet. `GET /rounds` listet nur Rundgänge des angemeldeten Benutzers, damit die mobile UI einen nach App-Neustart noch aktiven Gang wieder aufnehmen kann. Die Sync-Antwort enthält pro Mutation `SYNCED` oder `REJECTED`; gleiche Mutations-ID mit geändertem Inhalt wird als Konflikt behandelt.

## Daten- und Sicherheitsmodell

Migration `020_patrol_management.sql` führt neue tenant-scoped Tabellen mit `ENABLE` und `FORCE ROW LEVEL SECURITY` ein und ergänzt zusammengesetzte Tenant-/Site-Fremdschlüssel. Die Anwendungsrolle darf unveränderliche Scans, Routenversionen, Routenkontrollpunkte, Abweichungen und Patrol-Ereignisse nur lesen/einfügen. Trigger weisen spätere Änderung oder Löschung dieser Historien zurück.

Der Server ermittelt Mitarbeiteridentität aus `employees.account_user_id` und einer aktiven `employee_site_assignments`-Zuordnung. Eine Client-Mitarbeiter-ID ist kein Autorisierungsnachweis. QR-Payloads folgen dem Format `secops:patrol:v1:<site UUID>:<checkpoint UUID>:<token>`. QR-/NFC-Token-Prüfung, aktuelle Tokenversion, Zuordnung und Zwei-Minuten-Duplikatfenster werden serverseitig bei der Synchronisierung geprüft.

## Offline, Provider und Grenzen

Die IndexedDB-Outbox ist restart-persistent. Fehlerhafte oder nicht bestätigte Mutationen bleiben lokal; bestätigte Mutationen werden entfernt. Sichtbare Queue-Vorschauen redigieren den Klartexttoken. Ein offline angezeigter Scan ist vor erfolgreicher Serversynchronisierung weder verifiziert noch ein revisionssicherer Servereintrag. Rotierte oder archivierte Kontrollpunkte können bei späterem Sync zur Ablehnung führen.

Die Oberfläche speichert/zeigt Abweichungen, sendet aber keine Patrol-Alarme oder Benachrichtigungen. Für Patrol ist kein Alarm-/E-Mail-/Push-Provider angebunden. QR-Codes können fotografiert oder kopiert werden; Web NFC ist browser- und geräteabhängig. Rundgänge starten/enden online; offline erfassbare Scans können einem bereits gestarteten Rundgang zugeordnet werden, es gibt aber keine Offline-Rundgangsstart-/Abschlussmutation. Standortnachweis, dynamische Einmalcodes, Offline-Authentifizierung nach Sitzungsablauf und automatische Routenerfüllungs-/Verspätungsbewertung sind nicht implementiert. Diese Grenzen sind keine Produktionsfreigabe.

Dienst-/Schichtplanung wird in diesem Arbeitsschritt nicht implementiert; fehlende Integrationsfunktionen sind hier lediglich dokumentiert.
