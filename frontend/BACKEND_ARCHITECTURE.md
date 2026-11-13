# SecurityOps 2.0 – Backend- und API-Architektur

## Laufzeit und Schichten

Die operative Fach-API liegt in `frontend/backend/src/` und verwendet Express 4, TypeScript und PostgreSQL 16. `app.ts` registriert Authentifizierungs-, Fach- und DMS-Routen; Controller validieren Eingaben mit Zod und rufen Datenbankoperationen über `withTenantTransaction` auf. Der Produktionsprozess verbindet sich ausschließlich als `secops_app_user`; Migrationen laufen separat als `secops_admin`.

Die Session-Authentifizierung verwendet ein zufälliges HttpOnly-Cookie. `authenticateJwt` ist aus Kompatibilitätsgründen benannt, prüft aber den Session-Hash in `user_sessions` und lädt Tenant, Rolle sowie Berechtigungen aus der Datenbank. `requirePermission` erzwingt Rechte auf jeder geschützten Route. Die Datenbank setzt `app.current_tenant` pro Transaktion und erzwingt RLS.

## DMS-Datenfluss

1. Das Frontend sendet einen binären Upload (`application/octet-stream`) mit Dateiname als Metadatum. Es werden weder Base64-Dateien noch Daten in `localStorage`/IndexedDB geschrieben.
2. Der Server validiert Dateigröße, Dateiendung **und** Signatur/Formatinhalt (bei OOXML zusätzlich ZIP-Verzeichnis, CRC, Content-Type und Haupteintrag). Browser-MIME-Angaben werden nicht vertraut.
3. Ein zufällig generierter UUID-Speicherschlüssel adressiert ein privates Blob im konfigurierten Speicherpfad. Originaldateinamen werden ausschließlich als Metadaten gespeichert.
4. PostgreSQL-Transaktionen legen Dokument, Version, Zuordnung und Audit-Einträge atomar an. Dateien werden vor dem Commit geschrieben und bei Fehlern best-effort entfernt; unerreichbare Dateien sind keine Downloadobjekte, da Downloads zuerst eine tenant-gefilterte DB-Version auflösen.
5. Versionen sind unveränderlich. Wiederherstellung erzeugt eine neue Versionsnummer, die denselben unveränderlichen Blob referenzieren kann. Archivierung ist soft-delete; ältere Versionen bleiben erhalten.

## DMS-Tabellen und Tenant-Isolation

Migration `012_document_management.sql` führt Kategorien, Ordner, Dokumente, Versionen, Beziehungen, Schlagwörter, Zuweisungen und Audit-Ereignisse ein. Sämtliche DMS-Tabellen haben erzwungenes RLS. Beziehungen zu Kunden, Objekten, Mitarbeitern, Schichten und Wachbuchereignissen verwenden zusammengesetzte Fremdschlüssel mit `tenant_id`; ein ID-Wert allein reicht daher nicht, um einen fremden Mandantendatensatz zu verknüpfen.

Audit-Ereignisse sind für die Anwendungsrolle nur les- und anlegbar. Ein Trigger weist Updates und Deletes zurück. Es gibt keinen API-Endpunkt zum physischen Löschen von Dokumenten oder Versionen.

## Dienstanweisungen (SOP)

Migration `013_sop_instructions.sql` ergänzt tenantgebundene Dienstanweisungen, unveränderliche Versionen und Workflowereignisse sowie Ziel- und Mitarbeiterzuweisungen. Migration `014_employee_site_assignments.sql` ergänzt eine explizite, tenantgebundene Mitarbeiter-/Objektzuordnung und übernimmt vorhandene Zuordnungen aus Schichten. Alle SOP- und Zuordnungstabellen erzwingen RLS. Versions- und Auditdatensätze sind für die Anwendungsrolle nicht änder- oder löschbar; bestätigte Zuweisungen sind append-only. Objekt- und Kundenziele werden aus den expliziten Objektzuordnungen zu aktiven Mitarbeitern aufgelöst, unabhängig von zukünftigen Schichten.

Die API erzwingt die Berechtigungen `sop:*` und den Ablauf Entwurf → Prüfung → Freigabe → Veröffentlichung. Ersteller und Einreicher der konkreten Version dürfen diese nicht prüfen oder freigeben; der Prüfer darf dieselbe Version nicht freigeben. Bestätigungen werden dem authentifizierten Konto und einer konkreten SOP-Version zugeordnet. Der SOP-Datensatz kann tenantgebunden auf ein vorhandenes DMS-Dokument verweisen; Dateien werden nicht dupliziert. Offline-Bestätigungen werden im `sopAcknowledgements`-Store der vorhandenen IndexedDB vorgemerkt und erst nach serverseitiger Bestätigung als abgeschlossen behandelt. Erinnerungen werden beim Abruf berechnet; es gibt keinen zeitgesteuerten Scheduler oder automatische Eskalationszustellung.

## Übergabemanagement

Migration `017_handover_management.sql` ergänzt tenantgebundene Übergaben, Teilnehmer, Bestätigungen, Aufgaben und DMS-Verknüpfungen. Die Version 017 lässt 015/016 für den offenen Alarm-PR #12 frei; die Übergabe-Branch basiert weiterhin ausschließlich auf `main`. Alle sieben neuen Tabellen erzwingen RLS, nutzen zusammengesetzte Tenant-FKs und erhalten nur die für den Anwendungsbetrieb erforderlichen Rechte. Bestätigungen, Teilnehmer, Dokumentverknüpfungen sowie Ereignis- und Aufgabenhistorien sind append-only. Ein bestätigter Übergabeinhalt kann nicht aktualisiert werden; eine Korrektur wird als separates Ereignis protokolliert.

Die Übergabe-API verwendet `handovers:*`-RBAC und den Statusfluss `pending_handover_confirmation` → `pending_takeover_acknowledgement` → `completed`. Bestätigen darf nur das zugeordnete Mitarbeiterkonto. Bearbeitungen vor der Bestätigung sind versionsgeprüft; Aufgabenänderungen ebenso. Offene Aufgaben bleiben dem Ursprungsprotokoll und Objekt zugeordnet und werden bei Folgeübergaben am selben Objekt angezeigt. DMS-Dateien werden nicht kopiert, sondern über einen tenantgebundenen FK verknüpft. Synchronisierte Erfassungen laufen über die bestehende `sync_idempotency_receipts`-Tabelle und die IndexedDB-Outbox. Es gibt keine konfigurierte E-Mail-/Push-Zustellung; der Status wird in der Oberfläche angezeigt.

## REST-API

Alle Pfade haben das Präfix `/api/v1` und benötigen eine gültige Sitzung. Die Request-/Response-Verzeichnisse sowie Berechtigungen stehen in [DOCUMENTS_API.md](./DOCUMENTS_API.md), [SOP_API.md](./SOP_API.md), [HANDOVERS_API.md](./HANDOVERS_API.md) und [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md).

## Kontrollgänge und Patrol-Sync

`patrolController.ts` registriert Objekt-/Tenant-gebundene Kontrollpunkte, versionierte Routen, Rundgänge, Scans, Abweichungen und Auditereignisse. Jede Route prüft serverseitig `patrol:read`, `patrol:create`, `patrol:manage`, `patrol:exception:create` oder `patrol:audit`; `withTenantTransaction` setzt den Tenant-Kontext für RLS. Die Mitarbeiteridentität kommt aus `employees.account_user_id` plus aktiver `employee_site_assignments`-Zuordnung.

Direkte und synchronisierte Rundgangsstarts/-abschlüsse rufen dieselben idempotenten Persistenzfunktionen auf. Der Sync speichert Mutation, Payload-Hash und Serverquittung in derselben Tenant-Transaktion; unerwartete Serverfehler werden nicht als fachliche Ablehnung verschluckt. Aktuelle offene Grenzen der API – z. B. kein Patrol-Konfliktauflöser oder konfigurierter Alarmprovider – sind in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md) aufgeführt.

## Alarm- und Notfallmanagement

Migration `015_alarm_emergency_management.sql` stellt die Grundtabellen bereit; `016_alarm_lifecycle_and_offline.sql` ergänzt tenantgebundene Alarmarten, Notfallkontakt- und Planversionen, Zuweisungen, Status-/Maßnahmenhistorien, Eskalationsregeln/-jobs, Benachrichtigungsstatus und Idempotenzquittungen. Neue Tabellen erzwingen RLS. Planversionen, Aktionen und Statushistorie sind für die Anwendungsrolle append-only; der API-Workflow verwendet zusätzlich zusammengesetzte Tenant-FKs und Revisionen.

`alarmWorkflowController.ts` prüft serverseitig RBAC und den Objektzugriff anhand `employee_site_assignments` (über die angemeldete Benutzer-E-Mail). Nur definierte übergeordnete Rollen erhalten tenantweiten Site-Scope. Kontaktabfragen benötigen ein eigenes Kontakt-Leserecht; Planversionsantworten enthalten ohne dieses Recht keine Kontaktsnapshots. Nicht aktive Kunden/Objekte können keine neuen Pläne oder Vorfälle erhalten.

`alarmEscalationWorker.ts` verarbeitet fällige Jobs regelmäßig mit `FOR UPDATE SKIP LOCKED`, Leasing, begrenzten Wiederholungen und verzögertem Retry. In-App-Mitteilungen werden als Datenbankzustellung gespeichert. E-Mail und Push bleiben sichtbar `not_configured`, bis ein echter Provider eingerichtet ist. Der Worker wird mit dem Backendprozess gestartet und beim Herunterfahren gestoppt; er ersetzt keinen externen hochverfügbaren Job-Queue-Dienst.

Offline-Mutationen werden zuerst in der bestehenden IndexedDB gespeichert und danach direkt oder über `/alarms/sync` mit denselben Mutation-IDs übertragen. Konflikte sind explizit und werden nicht als bestätigt dargestellt. Details der Routen und bekannten Grenzen stehen in [ALARM_EMERGENCY_API.md](./ALARM_EMERGENCY_API.md).

## Betrieb

Die Standard-Dateigröße beträgt 10 MiB und ist über `DMS_MAX_FILE_SIZE_BYTES` bis maximal 100 MiB konfigurierbar. In Docker wird das persistente Volume `secops_documents` außerhalb des statischen Frontends eingebunden. Der Containerbenutzer `node` erhält ein privates Verzeichnis mit Modus `0700`. Der tägliche verschlüsselte Backup-Dienst sichert DB-Dump und Datei-Volume gemeinsam.

Es ist kein Virenscanner in der vorhandenen Deployment-Architektur enthalten. Die Scanner-Schnittstelle meldet deshalb `not_scanned`; Uploads werden nicht fälschlich als virengeprüft gekennzeichnet.

## DMS-Beziehungen

Die DMS-Beziehungstabelle akzeptiert nur vorhandene, tenantgebundene Backend-Entitäten; SOPs sind kein polymorpher Beziehungstyp. Stattdessen verweist eine Dienstanweisung über eine tenantgebundene Fremdschlüsselspalte auf ein vorhandenes DMS-Dokument. Alarmmaßnahmen können ein vorhandenes tenantgebundenes DMS-Dokument referenzieren; ein Offline-Datei-Upload für Alarme ist nicht implementiert.
