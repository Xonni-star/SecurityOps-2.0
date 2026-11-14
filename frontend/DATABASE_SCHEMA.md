# SecurityOps 2.0 - PostgreSQL-Datenbankarchitektur

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Dieses Schema-Dokument beschreibt den TypeScript/PostgreSQL-Quellcode. Es ist keine DIN-/§ 34a-Konformitäts- oder Zertifizierungsaussage. Nicht jede Tabelle oder jedes Modul hat denselben RLS-/FK- oder Reifegrad.

## 1. Systemübersicht

Das Backend ist TypeScript/Node.js mit Express und PostgreSQL 16+. SQL-Migrationen liegen in `frontend/backend/src/migrations/` und werden über den eigenen Migrationsrunner angewendet; SQLAlchemy, Asyncpg und Alembic gehören nicht zur aktuellen Architektur. Für vorhandene und neue Tabellen gelten die jeweiligen Migrationen als maßgebliche Definition. Einige Workflows unterstützen offline erfasste, idempotent synchronisierte Mutationen; das System ist nicht generell offline-first.

Mandantengrenzen werden je nach Modul durch Anwendungsprüfungen, RLS, `FORCE ROW LEVEL SECURITY`, zusammengesetzte Foreign Keys oder eine Kombination davon abgesichert. Diese Eigenschaften gelten nicht automatisch für jede Tabelle.

---

## 2. Tenant-aware Foreign Keys

Zusammengesetzte Foreign Keys binden Beziehungen dort, wo die Migration sie definiert, an denselben Mandanten:

```sql
-- Beispielmuster, sofern die jeweilige Migration diesen Constraint definiert:
FOREIGN KEY (parent_id, tenant_id) REFERENCES parent_table(id, tenant_id)
```

Eine nicht aufgeführte Beziehung darf nicht als tenant-validiert vorausgesetzt werden.

---

## 3. PostgreSQL Row Level Security (RLS)

Tenant-Tabellen werden in den jeweiligen Migrationen mit Policies auf `app.current_tenant` geschützt; bei unterstützten Tabellen wird RLS erzwungen (`FORCE ROW LEVEL SECURITY`). Nicht jede historische Tabelle wurde automatisch nachgerüstet. Anwendungszugriffe sollen die dafür vorgesehenen Tenant-Transaktionshelfer verwenden. Ein repräsentatives Policy-Muster ist:
```sql
ALTER TABLE logbook_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE logbook_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON logbook_entries
    AS PERMISSIVE
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
```

### Benutzer-, Rollen- und Berechtigungsverwaltung (Migration 033)

Migration `033_tenant_user_role_administration.sql` ergänzt `tenant_memberships`, tenant-eigene `tenant_roles`, `tenant_role_permissions` mit optionalem Objekt-/Site-Bezug und Datenzugriffsscope, `tenant_user_roles` sowie gehashte einmalige Reset-Tokens. Sie ergänzt tenantgebundene zusammengesetzte Fremdschlüssel und RLS/FORCE RLS für diese Tabellen und für die vorhandenen `user_roles` und `user_sessions`. Authentifizierte Requests beziehen den Mandanten aus der Sitzung; Login-/Session-Auflösung verwendet eng begrenzte Lookup-Policies, bevor der Tenant-Kontext gesetzt ist. Einzelheiten und Grenzen der Site-Autorisierung stehen in [USER_ADMINISTRATION_API.md](./USER_ADMINISTRATION_API.md).

## 4. Dokumentenmanagement (Migration 012)

`document_categories`, `document_folders`, `documents`, `document_versions`, `document_relationships`, `document_tags`, `document_tag_assignments` und `document_audit_events` sind mandantengebundene Tabellen mit `ENABLE` und `FORCE ROW LEVEL SECURITY` anhand `app.current_tenant`. Anwendungszugriffe laufen ausschließlich über `withTenantTransaction`.

Kategorien, Ordner und Dokumente haben zusammengesetzte Schlüssel/Fremdschlüssel mit `tenant_id`. Beziehungen zu `clients`, `sites`, `employees`, `shifts` und `guardbook_entries` nutzen ebenfalls zusammengesetzte Tenant-FKs. Die Datenbank verhindert so fremdmandantige Zuordnungen unabhängig von Frontend-IDs. Dokumentversionen sind immutable; für eine Wiederherstellung wird eine neue Versionsnummer erstellt, die auf denselben unveränderlichen Blob-Schlüssel verweisen darf.

`document_audit_events` enthält Actor, Dokument, Mandant, Aktion, JSON-Details und Zeitstempel. `secops_app_user` darf Auditdaten nur lesen und einfügen. Zusätzlich weist ein Trigger `UPDATE` und `DELETE` zurück. Dokumentmetadaten und Audit werden aufbewahrt; für bereits archivierte Dokumente können die Binärobjekte endgültig gelöscht werden.

Migration 035 erweitert `document_versions` um `released_at`, `scanned_at`, Scannerfehler und `storage_deleted_at`; der Schlüssel verweist auf ein S3-kompatibles Objekt unter dem privaten `quarantine/`-Präfix. Das Originaldateiname ist nur Metadatum. Eine Datenbankprüfung verhindert `Freigegeben`/`Veröffentlicht`, solange die aktuelle Version nicht freigegeben ist. PostgreSQL-Backups enthalten keine Dateiobjekte; diese müssen beim S3-Anbieter unabhängig gesichert/wiederhergestellt werden. Vorhandene Versionen werden bei Migration als ungeprüft markiert und nicht automatisch aus einem früheren lokalen Dateisystem kopiert.

## Alarm- und Notfallmanagement (Migration 016)

`alarm_types`, `emergency_contacts`, `emergency_plan_versions`, `alarm_event_assignments`, `alarm_event_actions`, `alarm_event_status_history`, `alarm_escalation_rules`, `alarm_escalation_steps`, `alarm_escalation_jobs`, `alarm_notifications` und `alarm_mutation_receipts` sind tenantgebunden und erzwingen `ENABLE` plus `FORCE ROW LEVEL SECURITY`. Vorhandene `emergency_plans` und `alarm_incidents` erhalten Kunden-, Alarmtyp-, Versions- und Site-Fremdschlüssel. Zusammengesetzte FKs verhindern Zuordnungen über Mandanten- oder Kunde/Site-Grenzen hinweg.

Planversionen, Aktionen und Statushistorie besitzen Datenbanktrigger gegen UPDATE/DELETE und nur INSERT-/SELECT-Rechte für die Anwendungsrolle. Die aktuelle Planfassung kann geändert werden; veröffentlichte Versionen bleiben als unveränderlicher Snapshot erhalten. Eskalationsjobs und Zustellversuche sind veränderliche Prozesszustände; sie sind nicht Teil der append-only Vorfallshistorie. Mutation-Quittungen enthalten einen Payload-Hash zur Idempotenzprüfung. Die Site-Autorisierung wird zusätzlich in der API erzwungen; RLS selbst begrenzt auf den Tenant.

## Übergabemanagement (Migrationen 017–019)

Migration `017_handover_management.sql` folgt auf die Alarmmigrationen 015/016. Die Tabellen `handovers`, `handover_participants`, `handover_events`, `handover_confirmations`, `handover_tasks`, `handover_task_events` und `handover_documents` erzwingen alle `ENABLE` und `FORCE ROW LEVEL SECURITY` mit `app.current_tenant`. Fremdschlüssel binden Objekt, Dienst, Mitarbeiter, Ursprungübergabe und DMS-Dokument jeweils zusammen mit `tenant_id`.

Übergaben enthalten Objekt/Bereich, Datum, Dienst, strukturierte Textfelder, Status, Revision, Client-Mutations-ID, Payload-Hash sowie client- und serverseitige Empfangszeitpunkte. Eine eindeutige `(tenant_id, client_mutation_id)`-Constraint und Hashprüfung verhindern Doppelanlage sowie Wiederverwendung einer Client-ID für abweichende Inhalte. Bestätigungen sind an Übergabe, Mitarbeiter, authentifiziertes Benutzerkonto, Aktion, Revision, Mutations-ID und Payload-Hash gebunden. Ereignis-, Bestätigungs-, Teilnehmer-, Dokument- und Aufgabenhistorientabellen sind durch Trigger und Least-Privilege-Rechte unveränderlich.

Aufgaben bleiben mit dem Ursprungsprotokoll verknüpft; ein Index unterstützt die Abfrage offener Aufgaben je Objekt und Fälligkeit. Sie werden bei Folgeübergaben mit `carried_forward=true` dargestellt, ohne den ursprünglichen Bezug umzuschreiben. Die vollständige Tabellen- und Statusbeschreibung steht in [HANDOVERS_API.md](./HANDOVERS_API.md).

Migration 018 ergänzt `employees.account_user_id` als nullable, tenant-validierten Fremdschlüssel auf `users`. Migration 019 ergänzt das dedizierte Recht `employees:account:link`; nur `Personalverwaltung` erhält es. Bestehende Datensätze werden absichtlich nicht anhand ihrer möglicherweise veralteten oder doppelten E-Mail-Adresse automatisch verknüpft. Konten müssen über die Mitarbeiter-API explizit und innerhalb desselben Mandanten zugeordnet werden. Bestätiger können das eigene Konto nicht neu einem Mitarbeiter zuordnen, und Bestätigungswiederholungen benötigen die aktuelle erwartete Revision.

## Kontrollgangsmanagement (Migration 020)

Migration `020_patrol_management.sql` ergänzt `patrol_checkpoints`, `patrol_routes`, unveränderliche `patrol_route_versions` und ihre Kontrollpunktreihenfolge, `patrol_rounds`, `patrol_exceptions` sowie append-only `patrol_events`. Jede neu angelegte mandantenbezogene Tabelle erzwingt `ENABLE` und `FORCE ROW LEVEL SECURITY` anhand `app.current_tenant`; zusammengesetzte Fremdschlüssel binden Kontrollpunkte, Routen, Rundgänge, Scans und Abweichungen an dasselbe Mandant-/Objektpaar. Die bestehende Tabelle `patrol_scans` erhält Kontrollpunkt-, Rundgangs-, Tokenversions- und Erfassungsmetadaten.

Kontrollpunkt-Tokens werden kryptografisch zufällig erzeugt und nur als SHA-256-Hash gespeichert; die API gibt den Klartext ausschließlich beim Anlegen oder Rotieren einmalig zurück. Der Datenbanktrigger sowie SELECT-/INSERT-Rechte schützen Scans, Routenversionen, Routenkontrollpunkte, Abweichungen und Ereignisse vor UPDATE/DELETE durch die Anwendungsrolle. Der Server leitet den Mitarbeiter aus dem authentifizierten Konto und einer aktiven Objektzuordnung ab; der Client kann diese Identität nicht vorgeben. Die detaillierte Tabellen-/API-Beschreibung steht in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md).

Migration `021_patrol_offline_round_completion.sql` ergänzt eindeutige Abschlussmutations-ID und Payload-Hash sowie getrennte Client-Erfassungs- und Servereingangszeit. `022_patrol_checkpoint_location_and_lifecycle.sql` ergänzt Gebäude-/Bereichsbezeichnungen, GPS am Kontrollpunkt mit Paar- und Bereichs-Constraints sowie einen Index für nicht archivierte Routen (das Feld `archived_at` besteht bereits seit Migration 020). `023_patrol_scan_location_and_route_execution.sql` ergänzt optionale Scan-Koordinaten samt Constraints, Abschlussbemerkungen sowie versionierte Soll-Dauer, Verspätungstoleranz und feste/flexible Reihenfolge. `024_patrol_route_scheduling_assignments_rbac.sql` ergänzt versionierte Zeitfenster, tägliche/wöchentliche Wiederholungsregeln, tenant-/objektgebundene Mitarbeiterzuordnungen und granulare RBAC-Rechte. `025_patrol_scan_attempt_audit.sql` ergänzt unveränderbare, tokenfreie Aufzeichnungen abgewiesener und doppelter Scans. Beide neuen Tabellen erzwingen RLS/FORCE RLS und erhalten für die Anwendungsrolle nur SELECT-/INSERT-Rechte. Konkrete Rundgangsinstanzen werden aus den Regeln noch nicht automatisch erzeugt; Mitarbeitergruppen und Dateianlagen sind nicht modelliert.

Die Patrol-Erweiterungen 026–029 bilden geplante Rundgangsvorkommen mit tenant-/route-/versions-/zeitgebundener Duplikatsperre und append-only Ereignissen ab; versäumte und abgebrochene Vorkommen werden unter konkurrierenden Workern zustandsbedingt/idempotent verarbeitet. Mitarbeitergruppen und ihre unveränderlichen Routenversion-Snapshots sind objekt- und mandantengebunden. `patrol_attachments` verknüpft bestehende DMS-Dokumente unveränderlich mit Rundgängen. Migration 029 ergänzt `DELETE` auf `document_relationships`, das der vorhandene DMS-Beziehungssetter benötigt; RBAC bleibt die Verantwortung der DMS-API. Details, insbesondere RLS/FORCE RLS, Rollenrechte und Grenzen für binäre Offline-Fotos, stehen in [PATROL_MANAGEMENT.md](./PATROL_MANAGEMENT.md).

## Dienst- und Einsatzplanung (Migrationen 030–032)

Migration `030_service_planning.sql` erweitert die vorhandenen `sites` um eine IANA-Zeitzone und `shifts` um kanonische Start-/Endzeitpunkte, Zeitzone, Planungsstatus, Pause und Periodenbezug. Migration `031_planning_cover_actuals.sql` ergänzt das explizite lokale `end_date`; Trigger halten lokale Daten/Uhrzeiten und Zeitstempel konsistent. Die vorhandenen Mitarbeiter-, Qualifikations-, Abwesenheits-, Objekt-, Kunden- und Schichtstammdaten werden wiederverwendet.

Die tenantgebundenen Tabellen umfassen `schedule_periods`, `schedule_templates`, `shift_staffing_requirements`, `shift_staffing_assignments`, `schedule_rule_profiles`, `schedule_rule_profile_versions`, `schedule_rule_findings`, `schedule_rule_exceptions`, `shift_swap_requests`, `planning_audit_events`, `shift_cover_requests`, `shift_actual_times`, `shift_actual_time_revisions` und `planning_notifications`. Jede dieser Tabellen setzt `ENABLE ROW LEVEL SECURITY` und `FORCE ROW LEVEL SECURITY`; die Policies erlauben nur die Tenant-ID aus `app.current_tenant`. Die Anwendung verwendet Tenant-Transaktionen und `secops_app_user` mit tabellenspezifischen Least-Privilege-Rechten; Befunde, Auditereignisse und frühere Ist-Zeit-Snapshots sind für die Anwendungsrolle nur lesbar/einfügbar. `planning_audit_events` ist durch einen Trigger gegen UPDATE und DELETE geschützt; für `shift_actual_time_revisions` erhält die App-Rolle ausschließlich SELECT-Rechte.

Beziehungen zwischen Planungseinträgen und tenantgebundenen Stammdaten sind durch zusammengesetzte Tenant-FKs abgesichert: Perioden und Vorlagen binden an Objekte/Zeiträume, Schichtanforderungen und Zuweisungen an dieselbe Tenant-Schicht, Zuweisungen an Mitarbeiter, Regelversionen an Profile, Befunde/Ausnahmen an Schichten/Mitarbeiter/Versionen, Tausch- und Vertretungsanträge an Schichten und Mitarbeiter. Ist-Zeiten verweisen über `(tenant_id, shift_id, employee_id)` auf eine Zuweisung dieser Mitarbeiterin bzw. dieses Mitarbeiters zu genau dieser Schicht; `shift_actual_time_revisions` referenziert den Ist-Zeit-Datensatz tenantgebunden. Eine zusätzliche Triggerprüfung verhindert, dass eine Planungsbenachrichtigung einem Konto ohne Rolle in demselben Tenant zugewiesen wird. Ein Fremdmandantenbezug wird dadurch zusätzlich zur RLS- und API-Prüfung auf Datenbankebene abgewiesen.

Migration `032_planning_approvals_templates_notifications.sql` ergänzt Vorlagen um `break_minutes`, `required_staff_count` sowie inklusive `effective_from`/`effective_until`-Daten. Ist-Zeit-Datensätze erhalten `approval_status`, `approved_by`, `approved_at` und `approved_revision_version`; Datenbank-Constraints untersagen Selbstfreigaben und inkonsistente Freigabemetadaten. Ein `BEFORE UPDATE`-Trigger speichert den vorherigen Datensatz in `shift_actual_time_revisions` in derselben Transaktion und verlangt bei Änderungen an Ist-Werten/Erfasser eine Revisionserhöhung um genau eins sowie das Zurücksetzen der Freigabe auf `pending`. Freigabe ändert die Statusmetadaten, nicht die fachliche Ist-Zeit-Revision. `planning_notifications` ist ein mandanten- und empfängergebundener In-App-Inbox-Speicher; die App darf `read_at`, aber keine Benachrichtigungsdetails verändern.

Regelrevisionen speichern Quelle, Referenz, Gültigkeitsdaten, Status und JSON-Regelwerte; die Datenbank erzwingt eindeutige Versionsnummern und Freigabe-Metadaten. Die Migrationen behaupten keine rechtliche oder tarifliche Konformität; Grenzwerte und Kalenderdaten müssen quellenbelegt durch den Tenant konfiguriert werden. API-Verhalten und Berechtigungen sind in [SERVICE_PLANNING_API.md](./backend/SERVICE_PLANNING_API.md) beschrieben.
