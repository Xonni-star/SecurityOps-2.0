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

## REST-API

Alle Pfade haben das Präfix `/api/v1` und benötigen eine gültige Sitzung. Das vollständige Request-/Response-Verzeichnis sowie Rechte stehen in [DOCUMENTS_API.md](./DOCUMENTS_API.md).

## Betrieb

Die Standard-Dateigröße beträgt 10 MiB und ist über `DMS_MAX_FILE_SIZE_BYTES` bis maximal 100 MiB konfigurierbar. In Docker wird das persistente Volume `secops_documents` außerhalb des statischen Frontends eingebunden. Der Containerbenutzer `node` erhält ein privates Verzeichnis mit Modus `0700`. Der tägliche verschlüsselte Backup-Dienst sichert DB-Dump und Datei-Volume gemeinsam.

Es ist kein Virenscanner in der vorhandenen Deployment-Architektur enthalten. Die Scanner-Schnittstelle meldet deshalb `not_scanned`; Uploads werden nicht fälschlich als virengeprüft gekennzeichnet.

## Nicht verfügbare Beziehungen

Das aktuelle Backend besitzt keine persistierten SOP-, Alarm-/Notfallplan- oder separaten Ereignis-/Dienstanweisungstabellen. Das DMS verknüpft nur vorhandene, tenantgebundene Backend-Entitäten; nicht vorhandene Beziehungen werden nicht durch frei eingegebene IDs vorgetäuscht. Für SOP- und Alarmverknüpfungen müssen zuerst deren serverseitige Fachmodelle/API ergänzt werden.
