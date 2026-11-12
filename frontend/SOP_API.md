# Dienstanweisungen (SOP) – API und Datenmodell

Alle Endpunkte verwenden das Präfix `/api/v1/sops`, eine gültige Sitzung und den Mandanten aus dem authentifizierten Sitzungsdatensatz. Ein Mandantenheader oder eine Mandanten-ID im Request wählt den Mandanten nicht aus. Die Datenbank erzwingt Row-Level Security für die SOP-Tabellen.

## Endpunkte

| Methode und Pfad | Berechtigung | Zweck |
|---|---|---|
| `GET /` | `sop:read` | Eigene gültige, veröffentlichte und zugewiesene Anweisungen oder – mit Verwaltungsrecht – die Mandantenübersicht |
| `POST /` | `sop:create` | Dienstanweisung als Entwurf anlegen |
| `PATCH /:id` | `sop:update` | Nicht eingereichten Entwurf bearbeiten |
| `GET /:id/versions` | `sop:read` | Versionshistorie lesen; Beschäftigte sehen nur die ihnen zugewiesene aktuelle Version |
| `POST /:id/versions` | `sop:update` | Unveränderlichen neuen Versionsentwurf mit Änderungsgrund anlegen |
| `POST /:id/submit` | `sop:submit` | Entwurf zur Prüfung einreichen |
| `POST /:id/review` | `sop:review` | Prüfen oder Änderungen mit Kommentar anfordern; Ersteller und Einreicher der aktuellen Version dürfen nicht selbst prüfen |
| `POST /:id/approve` | `sop:approve` | Geprüfte Version freigeben; Ersteller, Einreicher und Prüfer dürfen nicht selbst freigeben |
| `POST /:id/publish` | `sop:publish` | Freigegebene Version veröffentlichen und Mitarbeiterzuweisungen erzeugen |
| `POST /:id/withdraw` | `sop:publish` | Aktuelle Veröffentlichung zurückziehen |
| `POST /:id/archive` | `sop:archive` | Anweisung archivieren, ohne Versionen oder Bestätigungen zu löschen |
| `GET /:id/assignments` | `sop:read` | Zuweisungsstatus und Kenntnisnahmen ansehen |
| `POST /:id/assignments` | `sop:assign` | Mitarbeiter-, Objekt-, Kunden- oder Mandantenziel und optionale Frist festlegen |
| `POST /assignments/:assignmentId/acknowledge` | `sop:acknowledge` | Eigene aktive Zuweisung serverseitig bestätigen |
| `GET /reports` | `sop:manage` | Kenntnisnahmen nach Kunde, Objekt, Mitarbeiter, Zeitraum und Status filtern |
| `GET /reminders` | `sop:read` | Offene und überfällige Fristen anzeigen |

Die Erstellungs- und Versionsrequests enthalten Titel, Dokumentennummer, Beschreibung, Kategorie, strukturierten Inhalt, Kunden-/Objektbezug, Gültigkeitszeitraum und optional die ID eines vorhandenen DMS-Dokuments. Eine SOP-Dateiablage wird nicht dupliziert; Dateianhänge verbleiben im DMS.

## Workflow und Historie

Der Workflow lautet `draft → in_review → reviewed → approved → published`. Eine Prüfung kann mit Kommentar Änderungen anfordern; der Entwurf kann danach erneut eingereicht werden. Für jede konkrete Version sind Ersteller und Einreicher von Prüfer und Freigebendem getrennt; der Prüfer darf dieselbe Version ebenfalls nicht freigeben. Eine neue Änderung an einer veröffentlichten Anweisung beginnt als neue Version. Veröffentlichte Versionen, Workflowereignisse und bestätigte Zuweisungen werden nicht überschrieben; eine Veröffentlichung oder Archivierung blendet die alte Version aus der aktuellen Mitarbeitersicht aus.

Bei Veröffentlichung werden Ziele auf aktive Mitarbeiter erweitert. Objekt- und Kundenziele verwenden die expliziten, mandantengebundenen Standortzuordnungen (`assignedSiteIds` beim Anlegen oder Aktualisieren eines Mitarbeiters), nicht Schichteinsätze. Daher werden zugeordnete Mitarbeiter auch ohne zukünftige Schicht berücksichtigt; spätere Schichtänderungen ändern weder Empfängerkreis noch Zielzählung. Doppelte Empfänger für dieselbe SOP-Version werden zusammengeführt. Eine Kenntnisnahme erfordert eine bewusste Bestätigung; das Öffnen allein ändert keinen Status. Der Server ordnet das Konto anhand seiner authentifizierten E-Mail-Adresse genau einem aktiven Mitarbeiter zu und akzeptiert keine Bestätigung für andere Mitarbeiter.

Offline erfasste Bestätigungen werden vor Anzeige als vorgemerkt transaktionssicher in einem eigenen Store der vorhandenen IndexedDB geschrieben und beim Laden der SOP-Daten für genau den erfassten Mandanten und Benutzer wiederhergestellt. Jede Queue-Zeile bindet unveränderlich Zuweisungs-ID, exakte Versions-ID, Erfassungszeit und `clientMutationId`; fehlgeschlagene Übertragungen bleiben mit denselben Werten für den nächsten Versuch erhalten. Nach Wiederverbindung wird derselbe authentifizierte Bestätigungsendpunkt erneut aufgerufen; der Server bestätigt und entfernt erst danach den lokalen Eintrag. Der vorhandene generische Outbox-Sync kann diesen Endpoint nicht sicher abbilden: Er akzeptiert nur generische Entity-/Action-Mutationen mit anderem Envelope und synchronisiert über getrennte Entity-Endpunkte. Ein eigener Store innerhalb derselben IndexedDB vermeidet daher ein zweites Speichersystem, ohne SOP-Kenntnahmen in den unsicheren generischen Sync-Fluss einzuschleusen. Vor Wiederholung wird die aktuelle SOP-Zuweisung und Version geprüft; ersetzte Versionen werden dauerhaft als veraltet markiert und nicht übertragen. Vorhandene localStorage-Einträge mit exakter Versions-ID werden einmalig in IndexedDB übernommen; nicht sicher zuordenbare Einträge bleiben unangetastet und werden nicht auf eine möglicherweise andere Version übertragen.

## Fristen und Einschränkungen

`GET /reminders` ermittelt fällige und überfällige Einträge beim Abruf. Ohne einen konfigurierten Hintergrundscheduler werden damit keine zeitgesteuerten Push-Nachrichten oder automatischen Eskalationen ausgelöst. Berichte werden als gefilterte JSON-Daten bereitgestellt; CSV-/PDF-Export ist nicht Teil dieser API.
