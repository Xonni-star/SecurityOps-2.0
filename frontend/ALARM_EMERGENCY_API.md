# Alarm- und Notfallmanagement: API

Alle Pfade verwenden `/api/v1`, erfordern eine gültige Sitzung und nutzen ausschließlich den Tenant der authentifizierten Datenbanksitzung. PostgreSQL erzwingt `FORCE ROW LEVEL SECURITY`; nicht übergeordnete Rollen werden zusätzlich auf Sites begrenzt, die dem angemeldeten Mitarbeiter über `employee_site_assignments` zugewiesen sind. Die UI-Tenant-Auswahl ist kein Autorisierungsmerkmal.

## Berechtigungen

| Berechtigung | Zweck |
|---|---|
| `alarm:read` | Sites, Alarmarten, Pläne, Vorfälle, Historien und Zuweisungen lesen |
| `alarm:manage` | Pläne erstellen, neue Entwurfsversionen speichern, archivieren und Übungen protokollieren |
| `alarm:report` | Alarmvorfälle melden und Offline-Mutationen synchronisieren |
| `alarm:respond` | Statusübergänge ausführen |
| `alarm:action:create` | Maßnahmen und Notizen protokollieren |
| `alarm:assign` | Einsatzkräfte zuweisen/entfernen |
| `alarm:archive` | abgeschlossene Vorfälle archivieren; zusätzlich zu `alarm:respond` erforderlich |
| `alarm:type:manage` | Alarmarten administrieren |
| `alarm:escalation:manage` | Eskalationsregeln und Zustellwiederholungen verwalten |
| `alarm:notifications:read` | Zustell- und Eskalationsstatus lesen |
| `emergency_plan:publish` | Notfallplanversion veröffentlichen |
| `emergency_contact:read` | Kontaktdaten und Kontakt-Snapshots lesen |
| `emergency_contact:manage` | Notfallkontakte erstellen, ändern und archivieren |

Die API prüft Berechtigungen über die bestehende Datenbank-RBAC-Middleware. Zusätzlich prüft der Controller bei Objektzugriffen die Site-Zuordnung. Kontaktfelder werden nur über geschützte Kontaktendpunkte bzw. mit `emergency_contact:read` zurückgegeben; ohne dieses Recht bleiben Planversions-Kontakt-Snapshots leer. Plan- und Vorfallerstellung erfordert ein aktives Objekt und einen aktiven Kunden.

## Endpunkte

Alle Antworten verwenden den üblichen `{ success, data }`-Envelope. `POST /alarms/sync` liefert je Mutation `confirmed`, `conflict` oder `retry`.

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /alarm-types` | `alarm:read` | Aktive Alarmarten des Tenants |
| `POST /alarm-types` | `alarm:type:manage` | Erweiterbare Alarmart anlegen |
| `PATCH /alarm-types/:id` | `alarm:type:manage` | Label oder Aktivstatus ändern |
| `GET /alarm-sites` | `alarm:read` | Aktive, site-scoped Kundenobjekte |
| `GET /emergency-plans` | `alarm:read` | Nicht archivierte Pläne aktiver Kunden/Sites |
| `POST /emergency-plans` | `alarm:manage` | Entwurf mit Objekt, Alarmart, Verantwortlichem und Gültigkeit anlegen |
| `PATCH /emergency-plans/:id` | `alarm:manage` | Eine neue unveröffentlichte Planversion mit `revisionVersion` speichern |
| `POST /emergency-plans/:id/publish` | `emergency_plan:publish` | Aktuelle gültige Version veröffentlichen |
| `GET /emergency-plans/:id/versions` | `alarm:read` | Unveränderliche Versionen; Kontaktsnapshot nur mit Kontakt-Leserecht |
| `POST /emergency-plans/:id/archive` | `alarm:manage` | Plan archivieren |
| `POST /emergency-plans/:id/drills` | `alarm:manage` | Übung protokollieren |
| `GET /emergency-plans/:id/events` | `alarm:read` | Cursor-paginierte Planereignisse |
| `GET /emergency-contacts` | `emergency_contact:read` | Site-/Kunden-/Plan-Kontakte innerhalb des Site-Scopes |
| `POST /emergency-contacts` | `emergency_contact:manage` | Kontakt mit Kunden-, Site- oder Planbezug anlegen |
| `PATCH /emergency-contacts/:id` | `emergency_contact:manage` | Kontakt mit `revisionVersion` ändern |
| `POST /emergency-contacts/:id/archive` | `emergency_contact:manage` | Kontakt archivieren |
| `GET /alarms` | `alarm:read` | Cursor-paginierte Alarmübersicht; Filter siehe unten |
| `GET /alarms/recent-events` | `alarm:read` | Mandanten-/site-scoped letzte Ereignisse (1–100, Standard 25) |
| `POST /alarms` | `alarm:report` | Alarm mit Site, Alarmart, Priorität und optional gültigem Plan melden |
| `POST /alarms/sync` | `alarm:report` | Persistierte Offline-Mutationen idempotent synchronisieren |
| `GET /alarms/:id/events` | `alarm:read` | Cursor-paginierte unveränderliche Ereignisse |
| `GET /alarms/:id/actions` | `alarm:read` | Cursor-paginierte Maßnahmen/Notizen |
| `POST /alarms/:id/actions` | `alarm:action:create` | Maßnahme oder Notiz mit Beschreibung, Ergebnis und optional vorhandenem DMS-Dokument erfassen |
| `GET /alarms/:id/status-history` | `alarm:read` | Cursor-paginierte append-only Statushistorie |
| `GET /alarms/:id/assignments` | `alarm:read` | Einsatzkraft-Zuweisungen |
| `POST /alarms/:id/assignments` | `alarm:assign` | Einsatzkraft zuweisen/entfernen |
| `POST /alarms/:id/transitions` | `alarm:respond` | Status mit Begründung und `revisionVersion` ändern |
| `GET /alarm-escalation-rules` | `alarm:escalation:manage` | Konfigurierte Eskalationsregeln |
| `POST /alarm-escalation-rules` | `alarm:escalation:manage` | Regel mit Eskalationsstufen anlegen |
| `POST /alarm-escalation-rules/:id/revisions` | `alarm:escalation:manage` | Regelstufen revidieren |
| `GET /alarm-notifications` | `alarm:notifications:read` | Tatsächliche Zustellstatus |
| `GET /alarm-escalation-status` | `alarm:notifications:read` | Job-, Stufen- und Zustellstatus |
| `POST /alarm-notifications/:id/retry` | `alarm:escalation:manage` | Eine fehlgeschlagene, wiederholbare Zustellung erneut einreihen |

`GET /alarms` akzeptiert `customerId`, `siteId`, `alarmTypeId`, `status`, `severity`, `assignedEmployeeId`, `dateFrom`, `dateUntil`, `overdue=true`, `limit` (1–100, Standard 50) und einen opaken `cursor`. Das Dashboard überträgt diese Filter an den Server, sodass sie für alle Seiten gelten. Paginationsantworten enthalten `data.items` und `data.page` (`hasMore`, `nextCursor`, `limit`). Cursor bilden stabile Schlüsselpositionen aus Serverzeitstempel und ID und gelten nur zusammen mit den ursprünglichen Filtern; „Weitere Alarmvorfälle laden“ ruft die Folgeseiten ab. Plan-/Vorfallereignisse, Maßnahmen und Statusverläufe verwenden dasselbe `limit`-/`cursor`-Verfahren. `GET /alarms/recent-events` ist bewusst eine begrenzte Momentaufnahme der jüngsten Ereignisse, kein Archiv. Statuswerte sind `neu`, `bestätigt`, `in_bearbeitung`, `eskaliert`, `einsatzkraefte_verstaendigt`, `massnahmen_eingeleitet`, `entwarnung`, `abgeschlossen` und `archiviert`.

## Plan- und Vorfallintegrität

Notfallpläne besitzen Entwurfs-/Veröffentlichungs-/Archivstatus, fortlaufende unveränderliche Versions-Snapshots, Kunden-/Site-/Alarmart-Zuordnung, verantwortliche Person und Gültigkeitszeitraum. Veröffentlichen erfordert eine Version, ein Gültigkeitsbeginn sowie aktive Alarmart, Kunde und Site. Bei einer Vorfallmeldung wird der veröffentlichte Plan nur verknüpft, wenn Kunde, Site, Alarmart und Gültigkeitszeitraum übereinstimmen; die konkrete veröffentlichte Version wird eingefroren.

Statusübergänge werden mit authentifiziertem Akteur, serverseitigem Zeitstempel und Begründung protokolliert. Die fachlich zulässigen Übergänge führen vom neuen Ereignis über Bearbeitung/Eskalation und Entwarnung zum Abschluss; nur abgeschlossene Ereignisse dürfen archiviert werden. Aktionen und Statushistorie sind append-only. Revisionen verhindern, dass konkurrierende Änderungen still überschreiben.

## Eskalation und Benachrichtigung

Der Backendprozess startet einen Worker, der fällige PostgreSQL-Jobs mit `FOR UPDATE SKIP LOCKED` und Leases verarbeitet. Dadurch können mehrere Backend-Instanzen dieselbe Datenbank-Queue verwenden, ohne denselben aktiven Job zu claimen; abgelaufene Processing-Leases sind erneut auswählbar. Jobclaim und In-App-Zustellung laufen in derselben Tenant-Transaktion. Ein Prozessabbruch vor Commit rollt Änderungen zurück, sodass der Job nach dem Lease-Ablauf erneut versucht werden kann. Regeln definieren minimale Priorität, optional Site/Alarmart sowie zeitversetzte Schritte an eine Rolle oder Einsatzkraft. Wiederholungen verwenden exponentielle Verzögerung und enden nach fünf Versuchen mit sichtbarem `blocked`-Status. Wird ein Vorfall nicht mehr als `neu` geführt, werden nicht ausgeführte Eskalationsjobs abgebrochen.

In-App-Benachrichtigungen werden mandantengebunden gespeichert und nur bei Zuordnung eines aktiven Benutzerkontos als `delivered` markiert. E-Mail und Push haben derzeit keinen Provider und bleiben `not_configured`; sie werden nicht als zugestellt behandelt. Das Dashboard aktualisiert über das vorhandene Polling (30 Sekunden). SSE/WebSockets wurden nicht ergänzt, da keine Stream-Infrastruktur existiert und Polling bereits implementiert und getestet ist. Die API enthält Fehler-/Retry-Status; ein externer Versandprovider ist weiterhin eine offene Integration.

## Offline-Synchronisation

Die vorhandene IndexedDB `SecurityOps2_OfflineVault` speichert Alarmmeldungen, Maßnahmen und Statusänderungen in `alarmMutations`, getrennt von anderen Outbox-Mutationen. Jede Mutation wird vor Übertragung lokal gespeichert und mit derselben `clientMutationId` wiederholt. Der Server vergleicht Tenant, Benutzer, Mutationstyp und Payload-Hash, um Wiederholungen idempotent zu beantworten. Meldungen werden vor abhängigen lokalen Maßnahmen/Statusänderungen verarbeitet. Temporäre Netzwerkfehler bleiben `pending`; fachliche Konflikte bleiben sichtbar `conflict`; erst eine erfolgreiche Serverquittung setzt `confirmed`.

Plan-/Alarmtypen/Sites werden pro Tenant und Benutzer gecacht; der Cache entfernt Kontaktdaten. Offline-Datei-/Fotoupload und Offline-Änderungen an Plänen, Kontakten oder Eskalationsregeln sind nicht implementiert. Lokale Erfassung ist keine serverseitige Alarmierung und keine externe Zustellbestätigung.

## Bekannte Einschränkungen

- E-Mail-/Push-Zustellung, externe Leitstellen- und Telefonieintegration sind nicht konfiguriert.
- Die Oberfläche kann vorhandene DMS-Dokumente referenzieren, aber keine Alarmfotos/Dateien offline vormerken oder hochladen.
- Eskalationsregeln unterstützen Rolle oder Einsatzkraft als Empfänger, aber keine direkte Benachrichtigung an externe Kundenkontakte.
- Kontakte-, Benachrichtigungs- und Eskalationsstatus-Endpunkte verwenden weiterhin feste Höchstgrenzen; Alarmvorfälle und Ereignis-/Maßnahmen-/Statusverläufe unterstützen cursorbasierte Pagination.
- Die Migration und Tests belegen Datenbank-/API-Sicherheit lokal; Produktionsbetrieb und Hochverfügbarkeit des Workers sind nicht freigegeben.
