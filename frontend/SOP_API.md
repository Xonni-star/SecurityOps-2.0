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
| `POST /:id/review` | `sop:review` | Prüfen oder Änderungen mit Kommentar anfordern |
| `POST /:id/approve` | `sop:approve` | Geprüfte Version freigeben; Ersteller und Prüfer dürfen nicht selbst freigeben |
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

Der Workflow lautet `draft → in_review → reviewed → approved → published`. Eine Prüfung kann mit Kommentar Änderungen anfordern; der Entwurf kann danach erneut eingereicht werden. Eine neue Änderung an einer veröffentlichten Anweisung beginnt als neue Version. Veröffentlichte Versionen, Workflowereignisse und bestätigte Zuweisungen werden nicht überschrieben; eine Veröffentlichung oder Archivierung blendet die alte Version aus der aktuellen Mitarbeitersicht aus.

Bei Veröffentlichung werden Ziele auf aktive Mitarbeiter erweitert. Objekt- und Kundenziele verwenden die zukünftigen Schichteinsätze als Zuordnungsgrundlage. Doppelte Empfänger für dieselbe SOP-Version werden zusammengeführt. Eine Kenntnisnahme erfordert eine bewusste Bestätigung; das Öffnen allein ändert keinen Status. Der Server ordnet das Konto anhand seiner authentifizierten E-Mail-Adresse genau einem aktiven Mitarbeiter zu und akzeptiert keine Bestätigung für andere Mitarbeiter.

Offline erfasste Bestätigungen bleiben als lokal vorgemerkt gekennzeichnet, bis der Server die konkrete Zuweisung bestätigt. Erfassungszeit und Servereingangszeit sind getrennte Angaben. Wird die Version inzwischen ersetzt, darf die vorgemerkte Bestätigung nicht auf die neue Version übertragen werden.

## Fristen und Einschränkungen

`GET /reminders` ermittelt fällige und überfällige Einträge beim Abruf. Ohne einen konfigurierten Hintergrundscheduler werden damit keine zeitgesteuerten Push-Nachrichten oder automatischen Eskalationen ausgelöst. Berichte werden als gefilterte JSON-Daten bereitgestellt; CSV-/PDF-Export ist nicht Teil dieser API.
