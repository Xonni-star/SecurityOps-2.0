# Kontrollgangsmanagement

Dieses Dokument beschreibt den tatsächlich implementierten Stand des Patrol-Moduls und grenzt noch offene Punkte der vollständigen Spezifikation ausdrücklich ab.

## Funktionen

- Kontrollpunkte sind einem Objekt/Mandanten zugeordnet. Sie können angelegt, bearbeitet, aktiviert, deaktiviert und archiviert werden. Gebäude, Bereich, Standortdetails und optionale GPS-Koordinaten werden gespeichert; Koordinaten müssen paarweise und innerhalb gültiger Grenzen vorliegen.
- QR-Token enthalten 256 Bit Zufall; gespeichert wird nur der SHA-256-Hash. Rotation invalidiert den alten Token. Browser-QR-Detection und Web NFC werden nur bei verfügbarer Hardware-/Browser-API angeboten. Manuelle Erfassung ist nicht tokenverifiziert.
- Routen sind je Objekt geordnet und versioniert. Änderungen erzeugen unveränderliche Routenversionen; Routen lassen sich archivieren. Historische Rundgänge referenzieren ihre Routenversion.
- Rundgänge erfassen Mitarbeiter, Objekt, Route und Routenversion, Start/Ende, Scans und manuelle Abweichungen. Die Mobile-UI zeigt Routenschritte und synchronisiert Scans/Abweichungen.
- Bei erfolgreicher Online-Synchronisierung maßgebliche Serverhistorie; offline aufgenommene Daten bleiben bis zur Quittung in der Outbox.

## API und Berechtigungen

Alle Endpunkte benötigen eine authentifizierte Sitzung und arbeiten tenant-scoped. Server-Middleware und Controller prüfen RBAC; ausgeblendete UI-Elemente sind keine Sicherheitsgrenze.

Die vorhandenen Patrol-Rechte aus Migration 020 werden diesen Rollen zugeordnet:

| Rolle | Zugeordnete Rechte |
|---|---|
| Systemadministrator, Geschäftsführung, Einsatzleitung, Objektleitung | `patrol:read`, `patrol:create`, `patrol:manage`, `patrol:exception:create`, `patrol:audit` |
| Wachdienstmitarbeiter | `patrol:read`, `patrol:create`, `patrol:exception:create` |
| Qualitätsmanagement, Auditor | `patrol:read`, `patrol:audit` |

Die Spezifikation verlangt feinere Einzelrechte; diese Rollenmatrix ist deshalb als derzeit implementierter, gröberer Stand und nicht als vollständige Rechteabdeckung zu verstehen.

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /dashboard` | `patrol:read` | aggregierte Scan-, Rundgangs- und Abweichungszahlen |
| `GET /checkpoints` | `patrol:read` | Kontrollpunkte für Mandant/Objekt |
| `POST /checkpoints` | `patrol:manage` | Kontrollpunkt anlegen und QR-Token einmalig ausgeben |
| `PATCH /checkpoints/:id` | `patrol:manage` | Stammdaten, Standort und GPS aktualisieren |
| `PATCH /checkpoints/:id/status` | `patrol:manage` | aktivieren/deaktivieren |
| `POST /checkpoints/:id/rotate-token` | `patrol:manage` | QR-/NFC-Token invalidieren und ersetzen |
| `POST /checkpoints/:id/archive` | `patrol:manage` | Kontrollpunkt soft archivieren |
| `GET /routes` | `patrol:read` | aktuelle Routenversionen |
| `POST /routes` | `patrol:manage` | Route mit erster Version erstellen |
| `POST /routes/:id/versions` | `patrol:manage` | neue unveränderliche Routenversion veröffentlichen |
| `POST /routes/:id/archive` | `patrol:manage` | Route soft archivieren |
| `GET /rounds` | `patrol:read` | eigene Rundgänge, mit Objekt-/Status-/Zeitraumfilter |
| `POST /rounds` | `patrol:create` | Rundgang idempotent beginnen |
| `POST /rounds/:id/complete` | `patrol:create` | eigenen Rundgang idempotent abschließen |
| `GET /scans` | `patrol:read` | paginierte Scanhistorie |
| `GET /exceptions` | `patrol:read` | paginierte Abweichungshistorie |
| `POST /exceptions` | `patrol:exception:create` | Abweichung erfassen |
| `GET /events` | `patrol:audit` | append-only Auditereignisse |
| `POST /sync` | `patrol:create` bzw. `patrol:exception:create` | Offline-Rundgangsstart, Scans, Abschluss und Abweichungen synchronisieren |

Die vorhandene Rollenmatrix und die von Migration 020 hinzugefügten Berechtigungen sind bewusst nicht granular genug für alle angeforderten Einzelrechte. Insbesondere gibt es noch keine getrennten Rechte für Start/Abschluss, Berichtsauswertung und Abweichungsbearbeitung.

## Offline-Erfassung und Synchronisierung

Die IndexedDB-Outbox speichert Mutations-ID, Tenant, Benutzer, Ereignistyp, Payload und Client-Erfassungszeit transaktionssicher. Kontrollpunkte, Routen und Rundgangszustände werden nach Tenant und Benutzer partitioniert zwischengespeichert. Offline-Start, Scan und Abschluss lassen sich nach Browser-Neustart wiederherstellen.

Bei Wiederverbindung wird die Outbox automatisch angestoßen. Rundgangsstart wird vor zugehörigen Scans/Abweichungen, der Abschluss danach synchronisiert. Die Mutation verwendet eine stabile ID; direkte API- und Sync-Verarbeitung teilen denselben Payload-Hash, sodass ein verlorenes Antwortpaket gefahrlos wiederholt werden kann. Client-Erfassungszeit und Servereingangszeit sind getrennt. Konflikte und Ablehnungen bleiben lokal erhalten und sichtbar; ein Patrol-spezifischer Auflösungs-/Wiederherstellungsdialog ist nicht implementiert.

Offline gespeicherte QR-/NFC-Scans sind vor serverseitiger Token- und Zuordnungsprüfung keine verifizierten Servereinträge. Ein Token kann zwischen Erfassung und Sync rotiert oder ein Kontrollpunkt archiviert werden; in diesem Fall wird die Mutation abgelehnt und bleibt zur Prüfung erhalten. Browser-Events garantieren keine Synchronisierung, wenn Browser/App vollständig beendet sind; Background Sync ist nicht zugesichert.

## Datenbank und Audit

- `020_patrol_management.sql`: tenant-/sitegebundene Patrol-Tabellen, zusammengesetzte Fremdschlüssel, RLS/FORCE RLS, append-only Scan-, Routenversion-, Abweichungs- und Auditdaten, Basisrechte.
- `021_patrol_offline_round_completion.sql`: idempotenter Abschluss und getrennte lokale/serverseitige Zeitstempel.
- `022_patrol_checkpoint_location_and_lifecycle.sql`: Gebäude-/Bereichs-/GPS-Felder, Koordinaten-Constraints und Index für nicht archivierte Routen. Routenarchivierung nutzt das in 020 vorhandene `archived_at`.

Der Server leitet Mitarbeiteridentität aus `employees.account_user_id` und aktiver Objektzuordnung ab. Clientseitige Mitarbeiterangaben sind kein Berechtigungsnachweis. QR-Payload-Format: `secops:patrol:v1:<site UUID>:<checkpoint UUID>:<token>`.

## Noch nicht umgesetzt

Die vollständige Spezifikation ist gelesen, aber nicht vollständig implementiert. Noch offen sind:

- Zeitfenster, Soll-Dauer, Toleranzen, Wiederholungsregeln, feste/flexible Reihenfolge und Mitarbeiter-/Gruppenzuweisungen für Routen.
- GPS pro Scan, Fotos/Anlagen und Abschlussbemerkungen.
- Automatische Erkennung und revisionssichere Erzeugung von Abweichungen für fehlende/verspätete/abgebrochene Rundgänge und ungewöhnliche Zeitabweichungen. Ungültige Tokens und Duplikate werden abgewiesen, aber nicht als vollständiger Detektions-/Eskalationsworkflow historisiert.
- Vollständige Dashboardfilter nach Kunde, Mitarbeiter, Route und Abweichungstyp sowie vollständige Statistiken.
- Anbindung eines Alarm-, E-Mail-, Push- oder Leitstellenproviders. Für Patrol ist aktuell keiner konfiguriert; Benachrichtigungszustellung wird nicht behauptet.
- Spezifische Konfliktauflösung und reale Browser-/Mobilgeräte-E2E-Prüfung für Offline, Kamera und NFC.

Diese Grenzen sind weder Produktionsfreigabe noch Bereitschaftsnachweis. Dienst-/Schichtplanung wurde nicht implementiert.
