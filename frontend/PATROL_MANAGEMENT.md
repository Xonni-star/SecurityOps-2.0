# Kontrollgangsmanagement

Dieses Dokument beschreibt den tatsächlich implementierten Stand des Patrol-Moduls und grenzt noch offene Punkte der vollständigen Spezifikation ausdrücklich ab.

## Funktionen

- Kontrollpunkte sind einem Objekt/Mandanten zugeordnet. Sie können angelegt, bearbeitet, aktiviert, deaktiviert und archiviert werden. Gebäude, Bereich, Standortdetails und optionale GPS-Koordinaten werden gespeichert; Koordinaten müssen paarweise und innerhalb gültiger Grenzen vorliegen.
- QR-Token enthalten 256 Bit Zufall; gespeichert wird nur der SHA-256-Hash. Rotation invalidiert den alten Token. Browser-QR-Detection und Web NFC werden nur bei verfügbarer Hardware-/Browser-API angeboten. Manuelle Erfassung ist nicht tokenverifiziert.
- Routen sind je Objekt geordnet und versioniert. Änderungen erzeugen unveränderliche Routenversionen; Routen lassen sich archivieren. Eine Version kann feste oder flexible Reihenfolge, Soll-Dauer, Verspätungstoleranz, Tageszeitfenster, tägliche/wöchentliche Wiederholung sowie Mitarbeiterzuordnungen festlegen. Zugeordnete Mitarbeiter müssen dem Objekt zugeordnet sein; eine Zuordnung wird beim Start serverseitig geprüft.
- Mitarbeitergruppen können je Objekt gepflegt und einer Routenversion zugewiesen werden. Bei Veröffentlichung werden Gruppenmitglieder in die unveränderlichen individuellen Versionszuordnungen übernommen; spätere Gruppenänderungen ändern keine bereits veröffentlichte Route.
- Der Backend-Worker erzeugt geplante Rundgangsvorkommen für aktive tägliche/wöchentliche Routenversionen. Eine tenant-/route-/versions-/zeitgebundene Eindeutigkeitsbedingung verhindert doppelte Vorkommen über mehrere Worker-Instanzen. `missed`/`abandoned` werden erst 24 Stunden und fünf Minuten nach dem fachlichen Fälligkeitszeitpunkt terminalisiert, damit fristgerecht offline erfasste Start-, Scan- und Abschlussmutationen noch eintreffen und die Vorkommen reconciliert werden können.
- Rundgänge erfassen Mitarbeiter, Objekt, Route und Routenversion, Start/Ende, Scan-Notizen und Abschlussbemerkungen. Die Mobile-UI zeigt offene, erledigte und toleranzbasiert verspätete Routenschritte.
- GPS-Koordinaten können pro Scan optional über die Browser-Geolocation-API aufgenommen werden. Bei verweigerter Berechtigung oder fehlender Hardware wird der Scan ohne Standort gespeichert und die UI weist darauf hin.
- Beim Scan nach einem fälligen Routenschritt bzw. beim Abschluss erzeugt der Server idempotente, append-only Abweichungen für verspätete oder ausgelassene Kontrollpunkte.
- Abgewiesene/ungültige und doppelte Scanversuche werden ohne QR-/NFC-Token in einer tenant- und RLS-geschützten Append-only-Tabelle protokolliert und für berechtigte Audit-/Verwaltungsrollen angezeigt.
- Dashboard, Scans und Abweichungen können tenant-scoped nach Kunde, Objekt, Mitarbeiter, Route, Zeitraum, Rundgangstatus und Abweichungstyp gefiltert werden. Der Statusfilter für geplante Vorkommen ist getrennt und wird nur an `GET /scheduled-occurrences` gesendet.
- Vorhandene, zum Objekt verknüpfte DMS-Dokumente können online mit einem Rundgang verknüpft werden. Es gibt keine direkte Fotoaufnahme und keine Offline-Datei-/Fotoerfassung oder späteren Upload.
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
| `GET /employee-groups` | `patrol:route:read` | objektgebundene Mitarbeitergruppen lesen |
| `POST /employee-groups`, `PATCH /employee-groups/:id`, `POST /employee-groups/:id/archive` | `patrol:route:manage` | Mitarbeitergruppen pflegen und archivieren |
| `POST /routes/:id/archive` | `patrol:route:manage` | Route soft archivieren |
| `GET /rounds` | `patrol:round:read` | eigene oder berechtigt tenantweit sichtbare Rundgänge mit Objekt-/Status-/Zeitraumfilter |
| `GET /scheduled-occurrences` | `patrol:round:read` / `patrol:analytics:read` / `patrol:manage` | geplante, laufende, erledigte, verpasste und abgebrochene Vorkommen filtern |
| `POST /rounds` | `patrol:round:start` | Rundgang idempotent beginnen; zugewiesene Route prüft Mitarbeiterzuordnung |
| `POST /rounds/:id/complete` | `patrol:round:complete` | eigenen Rundgang idempotent mit optionaler Bemerkung abschließen |
| `GET /rounds/:id/attachments`, `POST /rounds/:id/attachments` | Lesen: `patrol:round:read` / `patrol:round:perform` / `patrol:manage` / `patrol:audit`; Verknüpfen: `patrol:round:perform` / `patrol:manage` | tenantgebundene DMS-Dokumente an Rundgang anzeigen/verknüpfen |
| `GET /scans` | `patrol:history:read` / `patrol:round:read` | paginierte, filterbare Scanhistorie |
| `GET /scan-attempts` | `patrol:scan-attempt:read` / `patrol:history:read` | abgewiesene und doppelte Versuche ohne Speicherung des Klartext-Tokens |
| `GET /exceptions` | `patrol:exception:read` | paginierte, filterbare Abweichungshistorie |
| `POST /exceptions` | `patrol:exception:create` | Abweichung erfassen |
| `GET /events` | `patrol:history:read` / `patrol:audit` | append-only Ereignisse einschließlich geplanter Vorkommen, mit Mandanten- und Objektfilter |
| `POST /sync` | mutationstypabhängige Rechte | Offline-Rundgangsstart, Scans, Abschluss und Abweichungen synchronisieren |
| `POST /api/v1/sync/conflicts/resolve` | mutierungsabhängige Patrol-Rechte; Abweichungserfassung benötigt `patrol:exception:create` oder `patrol:manage` | einen vorhandenen Patrol-Konflikt mit Serverstand abschließen oder den lokalen Sachverhalt als neue Abweichung dokumentieren |

Die API akzeptiert die alten `patrol:read`, `patrol:manage`, `patrol:create` und `patrol:audit`-Rechte als Kompatibilitätsalternative. Neue Rollen können stattdessen die granularen Rechte nutzen.

Scan- und Abweichungslisten begrenzen nicht-managerielle Rollen zusätzlich serverseitig auf eigene Rundgänge/Erfassungen oder aktuell zugewiesene Objekte; optionale Filter können diese Datenmenge nur verkleinern. `patrol:manage`, `patrol:audit` und `patrol:analytics:read` behalten die berechtigte mandantenweite Sicht. Der Filter für geplante Vorkommensstatus (z. B. `scheduled` oder `missed`) ist ein separates UI-Feld und wird nur an `GET /scheduled-occurrences` gesendet.

## Offline-Erfassung und Synchronisierung

Die IndexedDB-Outbox speichert Mutations-ID, Tenant, Benutzer, Ereignistyp, Payload und Client-Erfassungszeit transaktionssicher. Kontrollpunkte, Routen und Rundgangszustände werden nach Tenant und Benutzer partitioniert zwischengespeichert. Offline-Start, Scan und Abschluss lassen sich nach Browser-Neustart wiederherstellen.

Bei Wiederverbindung wird die Outbox automatisch angestoßen. Rundgangsstart wird vor zugehörigen Scans/Abweichungen, der Abschluss danach synchronisiert. Start, Scan und Abschluss akzeptieren clientseitige Erfassungszeiten höchstens 24 Stunden alt und höchstens fünf Minuten in der Zukunft. Scans eines Rundgangs dürfen nicht vor dessen serverseitig akzeptiertem Start liegen (mit derselben fünfminütigen Uhrabweichung); Abschlüsse nicht vor Rundgangsstart. Client-Erfassungszeit (`client_captured_at`) und Servereingangszeit (`server_received_at`) bleiben getrennt. Das Zwei-Minuten-Duplikatfenster verwendet ausschließlich `server_received_at`, nicht den manipulierbaren Client-Zeitpunkt. Die Mutation verwendet eine stabile ID; direkte API- und Sync-Verarbeitung teilen denselben Payload-Hash, sodass ein verlorenes Antwortpaket gefahrlos wiederholt werden kann. Ein Konflikt bleibt lokal erhalten, bis die berechtigte Person den Serverstand übernimmt (lokales Ereignis wird verworfen) oder das lokale Ereignis als neue, append-only Abweichung dokumentiert. Die Konfliktauflösung verwendet eine getrennte, idempotente Quittung; gespeicherte Abweichungstexte enthalten weder QR-/NFC-Token noch rohe lokale Payloads.

Offline gespeicherte QR-/NFC-Scans sind vor serverseitiger Token- und Zuordnungsprüfung keine verifizierten Servereinträge. Ein Token kann zwischen Erfassung und Sync rotiert oder ein Kontrollpunkt archiviert werden; in diesem Fall wird die Mutation abgelehnt und bleibt zur Prüfung erhalten. Browser-Events garantieren keine Synchronisierung, wenn Browser/App vollständig beendet sind; Background Sync ist nicht zugesichert. Offline hochgeladene Fotos/Dateien werden nicht gepuffert. Eine Offline-Erfassung für Geräte ohne zuvor geladenen Tenant-/Routen-/Kontrollpunktcache ist nicht zugesichert.

## Planung, Abweichungen und Eskalation

Der Prozess pollt standardmäßig alle 30 Sekunden. Vorkommen werden mit `INSERT ... ON CONFLICT DO NOTHING` angelegt; verpasste Vorkommen werden nur bei Status `scheduled` und erst nach einer Sync-Gnadenfrist von 24 Stunden plus fünf Minuten umgestellt. Abgelaufene laufende Vorkommen werden mit `FOR UPDATE ... SKIP LOCKED` beansprucht und erst nach derselben Frist terminalisiert. Dadurch können offline erfasste, zeitlich gültige Start-/Scan-/Abschlussmutationen noch eintreffen; verspätete Mutationen außerhalb der 24-Stunden-Grenze werden abgewiesen. Ereignisse und systemseitige Abweichungen werden pro Vorkommen/Kategorie idempotent protokolliert. Die berechtigte Historie vereinigt `patrol_events` und unveränderliche `patrol_schedule_occurrence_events` und erlaubt einen Objektfilter. Die Routenübersicht zeigt geplante Vorkommen und deren Status; Abweichungen sind über die berechtigte Patrol-Ansicht abrufbar. Dies ist die vorhandene In-App-Übersicht, keine garantierte Push-/E-Mail-/Leitstellenzustellung. Für Patrol ist kein externer Benachrichtigungsprovider konfiguriert.

## Datenbank und Audit

- `020_patrol_management.sql`: tenant-/sitegebundene Patrol-Tabellen, zusammengesetzte Fremdschlüssel, RLS/FORCE RLS, append-only Scan-, Routenversion-, Abweichungs- und Auditdaten, Basisrechte.
- `021_patrol_offline_round_completion.sql`: idempotenter Abschluss und getrennte lokale/serverseitige Zeitstempel.
- `022_patrol_checkpoint_location_and_lifecycle.sql`: Gebäude-/Bereichs-/GPS-Felder, Koordinaten-Constraints und Index für nicht archivierte Routen. Routenarchivierung nutzt das in 020 vorhandene `archived_at`.
- `023_patrol_scan_location_and_route_execution.sql`: optionale Scan-GPS-Koordinaten samt Integritäts-Constraints, Abschlussbemerkung sowie versionierte Soll-Dauer, Verspätungstoleranz und flexible Reihenfolge.
- `024_patrol_route_scheduling_assignments_rbac.sql`: versionsgebundene Zeitfenster, Wiederholungsregeln und Objekt-Mitarbeiterzuordnungen; RLS/FORCE RLS und unveränderbare Zuordnungen; granulare Patrol-Berechtigungen.
- `025_patrol_scan_attempt_audit.sql`: abgewiesene/doppelte Scanversuche ohne Tokengeheimnis, tenant-scoped mit RLS/FORCE RLS und Leserecht für berechtigte Auditrollen.
- `026_patrol_scheduled_occurrences.sql`: Zeitzone/Planungsanker, geplante Vorkommen, append-only Vorkommensereignisse, automatische Verpasst-/Abbruchabweichungen, RLS/FORCE RLS und Systemakteur.
- `027_patrol_employee_groups.sql`: objektgebundene Mitarbeitergruppen, Mitglieder und immutable Gruppen-Zuordnungen pro Routenversion mit Tenant-/Site-FKs und RLS/FORCE RLS.
- `028_patrol_document_attachments.sql`: unveränderliche, tenantgebundene Rundgang-/DMS-Dokumentverknüpfungen mit RLS/FORCE RLS.
- `029_document_relationship_delete_permission.sql`: gewährt der Anwendungsrolle das für die bestehende DMS-Beziehungsverwaltung erforderliche `DELETE`; die Autorisierung bleibt in der geschützten DMS-API.

Der Server leitet Mitarbeiteridentität aus `employees.account_user_id` und aktiver Objektzuordnung ab. Clientseitige Mitarbeiterangaben sind kein Berechtigungsnachweis. QR-Payload-Format: `secops:patrol:v1:<site UUID>:<checkpoint UUID>:<token>`.

## Grenzen und nicht verifizierte Anforderungen

Die vollständige Spezifikation wurde geprüft. Die nachfolgenden Grenzen sind nicht als implementiert oder verifiziert dargestellt:

- Keine echte Hardware-/Browser-E2E-Prüfung von Kamera, NFC, Geolocation-Berechtigungsverweigerung, Netzunterbrechung und Prozessabbruch auf iOS/Android-Geräten.
- Keine Fotoaufnahme oder Offline-Pufferung/Upload von Binärdateien. Online kann ein bereits vorhandenes, für das Objekt freigegebenes DMS-Dokument verknüpft werden; der bestehende DMS-Virenscanner meldet `not_scanned`, nicht sicherheitsgeprüft.
- Kein Patrol-spezifischer Alarmprovider, keine externe Push-/E-Mail-/Leitstellenzustellung und keine behauptete Benachrichtigungszustellung. Verpasste/abgebrochene Vorkommen werden als persistente hoch priorisierte Abweichung und Vorkommensstatus in der App sichtbar.
- Echtbetrieb, Produktionseinsatz und Bereitschaft wurden nicht geprüft oder freigegeben.

Dienst-/Schichtplanung wurde nicht begonnen.
