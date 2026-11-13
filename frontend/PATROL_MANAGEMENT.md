# Kontrollgangsmanagement

Dieses Dokument beschreibt den tatsächlich implementierten Stand des Patrol-Moduls und grenzt noch offene Punkte der vollständigen Spezifikation ausdrücklich ab.

## Funktionen

- Kontrollpunkte sind einem Objekt/Mandanten zugeordnet. Sie können angelegt, bearbeitet, aktiviert, deaktiviert und archiviert werden. Gebäude, Bereich, Standortdetails und optionale GPS-Koordinaten werden gespeichert; Koordinaten müssen paarweise und innerhalb gültiger Grenzen vorliegen.
- QR-Token enthalten 256 Bit Zufall; gespeichert wird nur der SHA-256-Hash. Rotation invalidiert den alten Token. Browser-QR-Detection und Web NFC werden nur bei verfügbarer Hardware-/Browser-API angeboten. Manuelle Erfassung ist nicht tokenverifiziert.
- Routen sind je Objekt geordnet und versioniert. Änderungen erzeugen unveränderliche Routenversionen; Routen lassen sich archivieren. Eine Version kann feste oder flexible Reihenfolge, Soll-Dauer, Verspätungstoleranz, Tageszeitfenster, tägliche/wöchentliche Wiederholung sowie Mitarbeiterzuordnungen festlegen. Zugeordnete Mitarbeiter müssen dem Objekt zugeordnet sein; eine Zuordnung wird beim Start serverseitig geprüft.
- Rundgänge erfassen Mitarbeiter, Objekt, Route und Routenversion, Start/Ende, Scan-Notizen und Abschlussbemerkungen. Die Mobile-UI zeigt offene, erledigte und toleranzbasiert verspätete Routenschritte.
- GPS-Koordinaten können pro Scan optional über die Browser-Geolocation-API aufgenommen werden. Bei verweigerter Berechtigung oder fehlender Hardware wird der Scan ohne Standort gespeichert und die UI weist darauf hin.
- Beim Scan nach einem fälligen Routenschritt bzw. beim Abschluss erzeugt der Server idempotente, append-only Abweichungen für verspätete oder ausgelassene Kontrollpunkte.
- Abgewiesene/ungültige und doppelte Scanversuche werden ohne QR-/NFC-Token in einer tenant- und RLS-geschützten Append-only-Tabelle protokolliert und für berechtigte Audit-/Verwaltungsrollen angezeigt.
- Dashboard, Scans und Abweichungen können tenant-scoped nach Kunde, Objekt, Mitarbeiter, Route, Zeitraum, Rundgangstatus und Abweichungstyp gefiltert werden.
- Bei erfolgreicher Online-Synchronisierung maßgebliche Serverhistorie; offline aufgenommene Daten bleiben bis zur Quittung in der Outbox.

## API und Berechtigungen

Alle Endpunkte benötigen eine authentifizierte Sitzung und arbeiten tenant-scoped. Server-Middleware und Controller prüfen RBAC; ausgeblendete UI-Elemente sind keine Sicherheitsgrenze.

Migration 024 ergänzt granulare serverseitige Patrol-Rechte. Die früheren breiten Rechte bleiben als rückwärtskompatible Alternativen bestehen:

| Rolle | Zugeordnete Rechte |
|---|---|
| Systemadministrator, Geschäftsführung, Einsatzleitung, Objektleitung | Dashboard, Kontrollpunkt-/Routenverwaltung, Rundgangstart/-durchführung/-abschluss, Abweichungen, Historie und Auswertung |
| Wachdienstmitarbeiter | Kontrollpunkte/Routen lesen, eigene Rundgänge starten/durchführen/abschließen, Abweichungen erfassen |
| Qualitätsmanagement, Auditor | Dashboard, Kontrollpunkte/Routen/Rundgänge/Abweichungen lesen, Historie und Auswertung |

Die API unterstützt getrennte Rechte wie `patrol:checkpoint:manage`, `patrol:route:manage`, `patrol:round:start`, `patrol:round:perform`, `patrol:round:complete`, `patrol:exception:read`, `patrol:history:read` und `patrol:analytics:read`. Eine separate Berechtigung zum Bearbeiten bestehender Abweichungen ist nicht vorhanden, da dafür keine Bearbeitungsfunktion besteht.

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /dashboard` | `patrol:dashboard:read` / `patrol:analytics:read` | gefilterte Scan-, Rundgangs- und Abweichungskennzahlen |
| `GET /checkpoints` | `patrol:checkpoint:read` | Kontrollpunkte für Mandant/Objekt |
| `POST /checkpoints` | `patrol:checkpoint:manage` | Kontrollpunkt anlegen und QR-Token einmalig ausgeben |
| `PATCH /checkpoints/:id` | `patrol:checkpoint:manage` | Stammdaten, Standort und GPS aktualisieren |
| `PATCH /checkpoints/:id/status` | `patrol:checkpoint:manage` | aktivieren/deaktivieren |
| `POST /checkpoints/:id/rotate-token` | `patrol:checkpoint:manage` | QR-/NFC-Token invalidieren und ersetzen |
| `POST /checkpoints/:id/archive` | `patrol:checkpoint:manage` | Kontrollpunkt soft archivieren |
| `GET /routes` | `patrol:route:read` | aktuelle Routenversionen |
| `POST /routes` | `patrol:route:manage` | Route mit erster Version erstellen |
| `POST /routes/:id/versions` | `patrol:route:manage` | unveränderliche Version mit Reihenfolge-, Sollzeit-, Zeitfenster-, Wiederholungs- und Mitarbeiterkonfiguration veröffentlichen |
| `POST /routes/:id/archive` | `patrol:route:manage` | Route soft archivieren |
| `GET /rounds` | `patrol:round:read` | eigene oder berechtigt tenantweit sichtbare Rundgänge mit Objekt-/Status-/Zeitraumfilter |
| `POST /rounds` | `patrol:round:start` | Rundgang idempotent beginnen; zugewiesene Route prüft Mitarbeiterzuordnung |
| `POST /rounds/:id/complete` | `patrol:round:complete` | eigenen Rundgang idempotent mit optionaler Bemerkung abschließen |
| `GET /scans` | `patrol:history:read` / `patrol:round:read` | paginierte, filterbare Scanhistorie |
| `GET /scan-attempts` | `patrol:scan-attempt:read` / `patrol:history:read` | abgewiesene und doppelte Versuche ohne Speicherung des Klartext-Tokens |
| `GET /exceptions` | `patrol:exception:read` | paginierte, filterbare Abweichungshistorie |
| `POST /exceptions` | `patrol:exception:create` | Abweichung erfassen |
| `GET /events` | `patrol:history:read` | append-only Auditereignisse |
| `POST /sync` | mutationstypabhängige Rechte | Offline-Rundgangsstart, Scans, Abschluss und Abweichungen synchronisieren |

Die API akzeptiert die alten `patrol:read`, `patrol:manage`, `patrol:create` und `patrol:audit`-Rechte als Kompatibilitätsalternative. Neue Rollen können stattdessen die granularen Rechte nutzen.

## Offline-Erfassung und Synchronisierung

Die IndexedDB-Outbox speichert Mutations-ID, Tenant, Benutzer, Ereignistyp, Payload und Client-Erfassungszeit transaktionssicher. Kontrollpunkte, Routen und Rundgangszustände werden nach Tenant und Benutzer partitioniert zwischengespeichert. Offline-Start, Scan und Abschluss lassen sich nach Browser-Neustart wiederherstellen.

Bei Wiederverbindung wird die Outbox automatisch angestoßen. Rundgangsstart wird vor zugehörigen Scans/Abweichungen, der Abschluss danach synchronisiert. Die Mutation verwendet eine stabile ID; direkte API- und Sync-Verarbeitung teilen denselben Payload-Hash, sodass ein verlorenes Antwortpaket gefahrlos wiederholt werden kann. Client-Erfassungszeit und Servereingangszeit sind getrennt. Konflikte und Ablehnungen bleiben lokal erhalten und sichtbar; ein Patrol-spezifischer Auflösungs-/Wiederherstellungsdialog ist nicht implementiert.

Offline gespeicherte QR-/NFC-Scans sind vor serverseitiger Token- und Zuordnungsprüfung keine verifizierten Servereinträge. Ein Token kann zwischen Erfassung und Sync rotiert oder ein Kontrollpunkt archiviert werden; in diesem Fall wird die Mutation abgelehnt und bleibt zur Prüfung erhalten. Browser-Events garantieren keine Synchronisierung, wenn Browser/App vollständig beendet sind; Background Sync ist nicht zugesichert.

## Datenbank und Audit

- `020_patrol_management.sql`: tenant-/sitegebundene Patrol-Tabellen, zusammengesetzte Fremdschlüssel, RLS/FORCE RLS, append-only Scan-, Routenversion-, Abweichungs- und Auditdaten, Basisrechte.
- `021_patrol_offline_round_completion.sql`: idempotenter Abschluss und getrennte lokale/serverseitige Zeitstempel.
- `022_patrol_checkpoint_location_and_lifecycle.sql`: Gebäude-/Bereichs-/GPS-Felder, Koordinaten-Constraints und Index für nicht archivierte Routen. Routenarchivierung nutzt das in 020 vorhandene `archived_at`.
- `023_patrol_scan_location_and_route_execution.sql`: optionale Scan-GPS-Koordinaten samt Integritäts-Constraints, Abschlussbemerkung sowie versionierte Soll-Dauer, Verspätungstoleranz und flexible Reihenfolge.
- `024_patrol_route_scheduling_assignments_rbac.sql`: versionsgebundene Zeitfenster, Wiederholungsregeln und Objekt-Mitarbeiterzuordnungen; RLS/FORCE RLS und unveränderbare Zuordnungen; granulare Patrol-Berechtigungen.
- `025_patrol_scan_attempt_audit.sql`: abgewiesene/doppelte Scanversuche ohne Tokengeheimnis, tenant-scoped mit RLS/FORCE RLS und Leserecht für berechtigte Auditrollen.

Der Server leitet Mitarbeiteridentität aus `employees.account_user_id` und aktiver Objektzuordnung ab. Clientseitige Mitarbeiterangaben sind kein Berechtigungsnachweis. QR-Payload-Format: `secops:patrol:v1:<site UUID>:<checkpoint UUID>:<token>`.

## Noch nicht umgesetzt

Die vollständige Spezifikation ist gelesen, aber nicht vollständig implementiert. Noch offen sind:

- Automatische Erzeugung/Planung konkreter Rundgangsinstanzen aus Zeitfenstern und Wiederholungsregeln; die Konfiguration wird versionsgebunden gespeichert, aber derzeit nicht von einem Zeitplaner ausgeführt. Es gibt im bestehenden Modell keine Mitarbeitergruppen; Gruppen-Zuweisung benötigt daher erst ein gemeinsames Gruppenmodell.
- GPS pro Scan und Abschlussbemerkungen sind implementiert. Fotos/Dateianlagen sind noch nicht angebunden.
- Automatische, revisionssichere Abweichungen für verspätete Scans, beim Überspringen bereits fälliger Routenschritte und beim Abschluss mit fehlenden Kontrollpunkten sind implementiert. Ungültige und doppelte Scans werden auditiert. Fehlende/verspätete geplante Rundgänge und Abbrüche werden mangels ausführendem Zeitplaner noch nicht automatisch erkannt/eskaliert.
- Dashboard-, Scan- und Abweichungsfilter nach Kunde, Mitarbeiter, Route, Zeitraum, Status und Abweichungstyp sind implementiert. Die Spezifikation verlangt darüber hinaus Kennzahlen/Übersichten für überfällige geplante, aber nie gestartete Rundgänge; diese benötigen einen aktiven Planungs-/Ausführungsdienst.
- Anbindung eines Alarm-, E-Mail-, Push- oder Leitstellenproviders. Für Patrol ist aktuell keiner konfiguriert; Benachrichtigungszustellung wird nicht behauptet.
- Spezifische Konfliktauflösung und reale Browser-/Mobilgeräte-E2E-Prüfung für Offline, Kamera und NFC.

Diese Grenzen sind weder Produktionsfreigabe noch Bereitschaftsnachweis. Dienst-/Schichtplanung wurde nicht implementiert.
