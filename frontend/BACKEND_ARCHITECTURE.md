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

Alle Pfade haben das Präfix `/api/v1` und benötigen eine gültige Sitzung. Die Request-/Response-Verzeichnisse sowie Berechtigungen stehen in [DOCUMENTS_API.md](./DOCUMENTS_API.md), [SOP_API.md](./SOP_API.md) und [HANDOVERS_API.md](./HANDOVERS_API.md).

## Betrieb

Die Standard-Dateigröße beträgt 10 MiB und ist über `DMS_MAX_FILE_SIZE_BYTES` bis maximal 100 MiB konfigurierbar. In Docker wird das persistente Volume `secops_documents` außerhalb des statischen Frontends eingebunden. Der Containerbenutzer `node` erhält ein privates Verzeichnis mit Modus `0700`. Der tägliche verschlüsselte Backup-Dienst sichert DB-Dump und Datei-Volume gemeinsam.

Es ist kein Virenscanner in der vorhandenen Deployment-Architektur enthalten. Die Scanner-Schnittstelle meldet deshalb `not_scanned`; Uploads werden nicht fälschlich als virengeprüft gekennzeichnet.

## DMS-Beziehungen

Die DMS-Beziehungstabelle akzeptiert nur vorhandene, tenantgebundene Backend-Entitäten; SOPs sind kein polymorpher Beziehungstyp. Stattdessen verweist eine Dienstanweisung über eine tenantgebundene Fremdschlüsselspalte auf ein vorhandenes DMS-Dokument. Alarm-/Notfallplan-Datensätze besitzen weiterhin keine serverseitige Fach-API.
