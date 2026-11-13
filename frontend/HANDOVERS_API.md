# Übergabemanagement – API und Betriebsverhalten

Alle Routen sind unter `/api/v1` verfügbar, verwenden die bestehende Session-/CSRF-Authentifizierung und übernehmen den Mandanten ausschließlich aus der authentifizierten Sitzung. JSON-Antworten verwenden `{ success, data, message? }`. Schreiboperationen werden zusätzlich durch serverseitiges `handovers:*`-RBAC und PostgreSQL `FORCE ROW LEVEL SECURITY` geschützt.

## Statusfluss

| Status | Bedeutung |
|---|---|
| `pending_handover_confirmation` | Übergabe erfasst; Bestätigung der abgebenden Person steht aus |
| `pending_takeover_acknowledgement` | Übergabe bestätigt; Übernahmebestätigung der ablösenden Person steht aus |
| `completed` | Beide getrennten Bestätigungen sind serverseitig gespeichert |

Die Bestätigung ist an das jeweilige Teilnehmerkonto gebunden: Die E-Mail-Adresse der authentifizierten Sitzung muss zur Mitarbeiterzuordnung der übergebenden bzw. übernehmenden Person passen. Nach der ersten Bestätigung sind die Protokollinhalte gesperrt. Rückfragen und Korrekturen werden als zusätzliche Historienereignisse gespeichert.

## Routen

| Methode und Pfad | Recht | Zweck |
|---|---|---|
| `GET /handovers` | `handovers:read` | Gefilterte, sortierte und paginierte Liste |
| `GET /handovers/dashboard` | `handovers:read` | Kennzahlen für heutige/ausstehende Übergaben und Aufgaben |
| `GET /handovers/:id` | `handovers:read` | Protokoll und Teilnehmer |
| `POST /handovers` | `handovers:create` | Idempotente Online-Erfassung |
| `PATCH /handovers/:id` | `handovers:update` | Optimistische Änderung eines noch unbestätigten Protokolls |
| `POST /handovers/:id/confirm` | `handovers:confirm` | Bestätigung der Übergabe durch die abgebende Person |
| `POST /handovers/:id/acknowledge` | `handovers:confirm` | Bestätigung der Übernahme durch die ablösende Person |
| `POST /handovers/:id/questions` | `handovers:confirm` | Rückfrage als Historienereignis dokumentieren |
| `POST /handovers/:id/corrections` | `handovers:manage` | Korrektur als Historienereignis dokumentieren |
| `GET /handovers/:id/events` | `handovers:read` | Chronologische Historie, `limit`/`offset` |
| `GET /handovers/:id/tasks` | `handovers:read` | Aufgaben des Protokolls und am Objekt weitergeführte offene Aufgaben |
| `POST /handovers/:id/tasks` | `handovers:tasks` | Aufgabe anlegen |
| `PATCH /handover-tasks/:id` | `handovers:tasks` | Aufgabe mit `expectedVersion` ändern |
| `GET /handovers/:id/documents` | `handovers:read`, `documents:read` | Verknüpfte DMS-Dokumente lesen |
| `POST /handovers/:id/documents` | `handovers:manage`, `documents:read` | Vorhandenes DMS-Dokument ohne Dateiduplikat verknüpfen |
| `POST /handovers/sync` | `handovers:create` (legacy `handover:create` ebenfalls akzeptiert) | Idempotente Übergabe-Outbox-Mutationen synchronisieren |

Listenparameter:

- `siteId`, `employeeId`, `status`, `from`, `to`, `search`
- `openTasks=true|false`, `pendingConfirmation=true|false`
- `sort=occurred_at_desc|occurred_at_asc`
- `limit=1..100` (Standard 50), `offset` (Standard 0)

Die Suche berücksichtigt Objekt, Bereich, Protokolltexte und Teilnehmer. Datumsgrenzen sind inklusive (`to` umfasst den gesamten Kalendertag). Kennzahlen für überfällige Aufgaben werden serverseitig anhand `due_at < CURRENT_TIMESTAMP` berechnet.

## Erfassung

`POST /handovers` akzeptiert mindestens:

```json
{
  "siteId": "UUID",
  "area": "Pforte",
  "shiftId": "UUID oder null",
  "occurredAt": "2026-11-13T06:00:00.000Z",
  "outgoingEmployeeId": "UUID",
  "incomingEmployeeId": "UUID",
  "generalText": "Übergabetext",
  "incidents": "Besondere Vorkommnisse",
  "importantNotes": "Wichtige Hinweise",
  "safetyInformation": "Sicherheitsinformationen",
  "capturedAt": "2026-11-13T06:01:00.000Z",
  "clientMutationId": "uuid-or-stable-client-id",
  "tasks": []
}
```

`tasks` kann bei der Erfassung bis zu 30 initiale Aufgaben enthalten. Jede Aufgabe hat `title`, `description`, `assignedEmployeeId`, `priority` (`low`, `normal`, `high`, `urgent`), optional `dueAt` und optional eine eigene Client-ID. Wiederholungen mit gleichem Tenant, gleicher Client-ID und gleichem Payload liefern denselben Datensatz zurück; eine abweichende Wiederverwendung liefert `409`.

Eine spätere Entwurfsänderung benötigt `expectedVersion`. Aufgabenänderungen benötigen ebenfalls `expectedVersion`; Statuswerte sind `open`, `in_progress`, `done` und `cancelled`. Erledigte/abgebrochene Aufgaben erhalten ein serverseitiges `completed_at`. Nicht abgeschlossene Aufgaben bleiben beim Ursprungsprotokoll und werden für Folgeübergaben desselben Objekts als weitergeführt zurückgegeben.

## Offline-Synchronisierung

Die Oberfläche speichert eine neue Übergabe zuerst in `SecurityOps2_OfflineVault.outbox` und sendet sie danach an:

```json
{
  "deviceId": "device-id",
  "mutations": [{
    "clientUuid": "same-id-as-the-outbox-entry",
    "entityType": "handover",
    "action": "CREATE",
    "clientTimestamp": "2026-11-13T06:01:00.000Z",
    "baseVersion": 1,
    "payload": { "siteId": "UUID", "outgoingEmployeeId": "UUID", "incomingEmployeeId": "UUID" }
  }]
}
```

Die tatsächliche Payload muss dem Erfassungsschema entsprechen. Der Server speichert die Antwort in `sync_idempotency_receipts`; Advisory Locks und eindeutige Client-ID-Constraints schützen parallele Wiederholungen. `SYNCED` wird erst nach Commit quittiert. Bei abweichendem Inhalt zu einer bereits genutzten Client-ID antwortet der Server mit `CONFLICT` samt Versions-/Payloadvergleich. `REJECTED` und `CONFLICT` überschreiben keine vorhandene Übergabe. Die UI hält Konflikte und Fehler lokal sichtbar; eine unveränderliche Übergabe wird nicht durch „USE_LOCAL“ überschrieben. Eine Korrektur wird separat als Ereignis erfasst.

Die Synchronisierung entfernt eine Outbox-Mutation erst nach Serverquittung. Statusanzeige: lokal gespeichert / Synchronisierung ausstehend / synchronisiert / Konflikt / fehlgeschlagen. Statusbestätigungen, spätere Aufgabenänderungen und DMS-Verknüpfungen erfordern eine Online-Verbindung. Externe E-Mail- oder Push-Benachrichtigungen sind nicht konfiguriert; die Anwendung behauptet keine Zustellung.

## Daten- und Sicherheitsgrenzen

Migration `017_handover_management.sql` führt sieben tenantgebundene Tabellen mit `ENABLE` und `FORCE ROW LEVEL SECURITY`, zusammengesetzten Tenant-FKs und Least-Privilege-Rechten ein. Protokoll, Teilnehmer, Bestätigungen, Aufgabenänderungen und DMS-Verweise werden historisiert. Bestätigungs-, Teilnehmer-, Ereignis- und Dokumentverknüpfungen sind append-only. Es werden nur vorhandene, nicht archivierte DMS-Dokumente desselben Mandanten referenziert; Datei-Uploads oder -Kopien erfolgen nicht durch das Handover-Modul.

## Einschränkungen

- Keine externe E-Mail-/Push-Zustellung.
- Die Offline-Outbox unterstützt neue Übergaben samt initialen Aufgaben. Nachträgliche Bestätigungen, Aufgabenänderungen und DMS-Verknüpfungen sind online-only.
- Offline-Erfassung setzt eine aktive angemeldete Sitzung und zuvor geladene Objekt-/Mitarbeiter-Stammdaten voraus. Eine App-Neustart-Wiederherstellung von Sitzung und Stammdaten ohne Netzwerk wird von der bestehenden Auth-/Datenladearchitektur nicht unterstützt.
- DMS-Dateien und Metadaten werden nicht offline repliziert.
- Status- und Historienansichten verwenden begrenzte Seitengrößen; Aufgaben werden aktuell als Objektliste ohne eigene Pagination geladen.
- Dies ist eine Repository-Implementierung, keine produktive Bereitstellung oder Betriebsfreigabe.
