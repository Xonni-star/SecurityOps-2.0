# Alarm- und Notfallmanagement: API

Alle Endpunkte verwenden `/api/v1`, erfordern eine gültige JWT-Sitzung und verwenden ausschließlich den Mandanten des authentifizierten Benutzers. Ein Mandantenheader oder eine Mandanten-ID im Request wählt den Mandanten nicht aus. PostgreSQL erzwingt die Mandantentrennung zusätzlich per `FORCE ROW LEVEL SECURITY`.

## Berechtigungen

| Berechtigung | Zugriff |
|---|---|
| `alarm:read` | Notfallpläne, Vorfälle und deren Ereignisverläufe lesen |
| `alarm:manage` | Notfallpläne erstellen, ändern, archivieren und Übungen dokumentieren |
| `alarm:report` | Alarmvorfälle melden |
| `alarm:respond` | Vorfälle bestätigen, eskalieren oder abschließen |

Systemadministration, Geschäftsführung, Einsatzleitung und Qualitätsmanagement erhalten alle vier Rechte. Objektleitung und Wachdienstmitarbeiter erhalten Lesen, Melden und Reagieren; Auditoren erhalten Leserechte. Die API prüft jede Berechtigung serverseitig.

## Endpunkte

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /emergency-plans` | `alarm:read` | Nicht archivierte Notfallpläne des Mandanten |
| `POST /emergency-plans` | `alarm:manage` | Notfallplan für ein aktives Objekt anlegen |
| `PATCH /emergency-plans/:id` | `alarm:manage` | Plan mit `revisionVersion` aktualisieren |
| `POST /emergency-plans/:id/archive` | `alarm:manage` | Plan mit `revisionVersion` archivieren |
| `POST /emergency-plans/:id/drills` | `alarm:manage` | Übungsdatum erfassen; der Plan hält das jüngste Datum fest |
| `GET /emergency-plans/:id/events` | `alarm:read` | Unveränderliche Planereignisse, maximal 200 |
| `GET /alarms` | `alarm:read` | Vorfälle des Mandanten, maximal 500 |
| `POST /alarms` | `alarm:report` | Vorfall für ein aktives Objekt melden |
| `GET /alarms/:id/events` | `alarm:read` | Unveränderliche Vorfallereignisse, maximal 200 |
| `POST /alarms/:id/transitions` | `alarm:respond` | Vorfallstatus mit Maßnahme und `revisionVersion` ändern |

## Daten und Workflow

Die unterstützten Szenarien sind Brandmeldeanlage, Einbruchsalarm, Bombendrohung, medizinischer Notfall und Hausfriedensbruch/Aggression. Ein Notfallplan enthält Objekt, Szenario, Maßnahmenkette, optionale Kontakte, Aktivstatus und letztes Übungsdatum. Ein Vorfall enthält Objekt, Szenario, Schweregrad, Titel, Beschreibung, Meldezeitpunkt und Status.

Vorfallstatus: `gemeldet → bestätigt → eskaliert → abgeschlossen`. Eskalation ist aus `gemeldet` oder `bestätigt` möglich; ein Vorfall kann auch direkt abgeschlossen werden. Jede Änderung verlangt eine nichtleere Maßnahme/Begründung und die aktuelle positive Revisionsnummer. Veraltete Revisionen sowie unzulässige Übergänge werden mit HTTP 409 abgewiesen. Abgeschlossene Vorfälle können nicht wieder geöffnet werden.

Pläne und Vorfälle werden zusammen mit ihren Ereignissen in derselben Mandantentransaktion geändert. Ereignisse protokollieren den authentifizierten Akteur und sind für die Anwendungsrolle ausschließlich einfügbar; Datenbanktrigger verhindern nachträgliche Aktualisierung oder Löschung. Pläne werden archiviert statt gelöscht. Zusammengesetzte Mandanten-Fremdschlüssel verhindern Verknüpfungen mit Objekten, Plänen oder Vorfällen anderer Mandanten.

## Grenzen

Die API bietet keine externen Leitstellen-/Telefonieintegrationen, Push-Benachrichtigungen, automatischen Eskalationsscheduler, Datei-/Bildanhänge oder separaten Drill-Datensatz je Übung. Die Übungs-API aktualisiert nur das jüngste Übungsdatum und fügt ein unveränderliches Ereignis hinzu. Der Vorfall-Endpunkt liefert höchstens 500 Einträge und bietet derzeit keine Filter- oder Pagination-Parameter. Der Alarmbildschirm benötigt Onlinezugriff; Offline-Erfassung und nachgelagerte Synchronisierung sind nicht implementiert.
