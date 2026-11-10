# SECURITYOPS 2.0 – VOLLSTÄNDIGE DATENBANKSPEZIFIKATION (PHASE 2)

## 1. Übersicht & Architekturprinzipien
Die Datenbank für SecurityOps 2.0 basiert auf **PostgreSQL 16** unter strenger Einhaltung von:
- **DIN 77200** (Sicherungsdienstleistungen, Audit-Trails, unveränderbare Wachbücher)
- **§ 34a GewO / BewachV** (Personalqualifikationen, Nachweise, Fristenüberwachung)
- **DSGVO Art. 32** (Sicherheit der Verarbeitung, logische Mandantentrennung via Row Level Security)
- **Offline First** (Optimistic Concurrency Control via `version INT`, Idempotenzschlüssel)

### Mandantenisolations-Garantie (RLS & Composite FKs)
1. **Mandanten-Spalte**: Jede mandantengebundene Tabelle enthält `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT`.
2. **PostgreSQL Row Level Security (RLS)**:
   ```sql
   ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_<table_name> ON <table_name>
       FOR ALL
       USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
       WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
   ```
3. **Schutz vor mandantenübergreifenden Verknüpfungen (Composite Foreign Keys)**:
   Um zu verhindern, dass Mandant A versehentlich oder böswillig einen Datensatz von Mandant B referenziert, werden zusammengesetzte UNIQUE- und FOREIGN-KEY-Constraints definiert:
   `FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)`

---

## 2. Detaillierte Tabellenstruktur nach Modulen (A–M)

### Modul A: System & Mandanten (10 Tabellen)
- `tenants`: Mandantenstammdaten, Handelsregister, DIN 77200 Zertifikat, RLS-Schema.
- `tenant_settings`: Konfigurationsparameter (z.B. Wachbuch-Intervall, Alarm-Eskalationszeiten).
- `system_settings`: Mandantenübergreifende Globaleinstellungen (System-Wartung, API-Limits).
- `system_users`: Authentifizierungskern, E-Mail, Argon2id Password-Hash, 2FA-Secret.
- `user_tenants`: N:M-Zuordnung von Benutzern zu Mandanten mit Aktivitätsstatus.
- `roles`: Rollendefinitionen (Systemadministrator, Einsatzleitung, Objektleitung, Wachmann).
- `permissions`: Granulare Einzelrechte (`wachbuch:create`, `schedule:dispatch`, `audit:read`).
- `role_permissions`: N:M-Zuordnung von Rollen zu Berechtigungen.
- `user_roles`: Mandantenbezogene Rollenzuweisung (`tenant_id`, `user_id`, `role_id`).
- `sessions`: Aktive JWT-Sitzungen, Refresh-Token-Rotation, IP-Adresse, User-Agent.

### Modul B: Kundenverwaltung (5 Tabellen)
- `customers`: Kundenstamm, Kundennummer, SLA-Level (Gold/Silber/Bronze), Umsatz.
- `customer_contacts`: Ansprechpartner, Werksicherheitsleiter, Telefon, Notfall-E-Mail.
- `customer_addresses`: Hauptsitz, Rechnungsanschrift, Werkszufahrten.
- `customer_contracts`: Dienstleistungsverträge, Laufzeiten, Kündigungsfristen, VdS-Klassen.
- `customer_notes`: Chronologische Kundennotizen und Anweisungen.

### Modul C: Objektverwaltung & KRITIS (6 Tabellen)
- `objects`: Sicherheitsobjekte, Anschrift, Gefährdungsstufe (KRITIS, Hoch, Mittel), Alarmsysteme.
- `object_contacts`: Vor-Ort-Ansprechpartner, Hausmeister, Notdienste.
- `object_settings`: Objektspezifische Parameter (Wachgangintervalle, RFID/NFC Scanfrequenz).
- `object_instructions`: Objektdienstanweisungen, Pfortenrichtlinien.
- `object_access_rules`: Zutrittsregelungen, Besucherausweispflicht, Schleusenlogik.
- `object_control_points`: Kontrollpunkte, NFC-UID, QR-Code, Geokoordinaten, Zielzeiten.

### Modul D: Mitarbeiterverwaltung & § 34a GewO (8 Tabellen)
- `employees`: Personalstamm, Personalnummer, Status (Aktiv/Urlaub/Krank), Sollstunden.
- `employee_addresses`: Meldeanschrift, Notfallkontakte.
- `employee_qualifications`: Sachkundenachweis § 34a GewO, Ersthelfer, Brandschutzhelfer, Waffenschein gem. § 7 WaffG.
- `employee_certificates`: Ausstellende Behörden (IHK, TÜV, DRK), Urkunden-PDFs, Ablaufdaten.
- `employee_contracts`: Arbeitsverträge, Tarifgruppeneinstufung, Befristungen.
- `employee_documents`: Personalakten, Führungszeugnisse, Sicherheitsüberprüfungen (SÜG).
- `employee_absences`: Urlaubsanträge, Krankmeldungen mit AU-Bescheinigung.
- `employee_notes`: Disziplinar- und Leistungsnotizen.

### Modul E: Dienst- & Schichtplanung (6 Tabellen)
- `shifts`: Schichten, Datum, Soll-Qualifikation, Besetzungsstatus (Besetzt/Offen/Konflikt).
- `shift_assignments`: Zuweisung Mitarbeiter zu Schicht mit automatischer § 34a Konfliktvalidierung.
- `shift_models`: Schichtvorlagen (Früh 06-14h, Spät 14-22h, Nacht 22-06h, 24h Bereitschaft).
- `shift_swaps`: Schichttausch-Börse und Genehmigungsworkflow.
- `availability`: Verfügbarkeitsmeldungen und Dienstplanwünsche.
- `working_hours`: Erfasste Ist-Stunden für Lohnabrechnung und Zuschlagsberechnung.

### Modul F: Digitales Wachbuch & Vorfälle (7 Tabellen)
- `logbooks`: Wachbuch-Instanz je Objekt und Kalendertag.
- `logbook_entries`: Lückenlose Zeiteinträge mit Zeitstempel und Mitarbeiterkennung.
- `shift_handover`: Revisionssichere Schichtübergabe mit Zählerständen und Mängelliste.
- `incidents`: Besondere Vorkommnisse (Einbruch, BMA-Alarm, Vandalismus), Priorität (KRITISCH/Hoch).
- `incident_attachments`: Fotos, Zeugenaussagen, Polizeiprotokolle.
- `patrols`: Durchgeführte Streifen- und Kontrollgänge.
- `patrol_checkpoints`: Gescannte NFC/QR-Kontrollpunkte mit Ist-Zeit und Abweichung.

### Modul G: Qualitätsmanagement & DIN 77200 (6 Tabellen)
- `instructions`: Allgemeine Dienstanweisungen (Betriebsanweisungen, DGUV V23).
- `instruction_versions`: Versionierung von Vorschriften mit Änderungsprotokoll.
- `instruction_acknowledgements`: Digitale Lesebestätigungen mit Signatur-Prüfsumme.
- `quality_checks`: Regelmäßige Objekt- und Wachdienstkontrollen.
- `quality_findings`: Festgestellte Abweichungen (z.B. unvollständige Dienstkleidung).
- `corrective_actions`: Korrekturmaßnahmen und Nachschulungen mit Fristen.

### Modul H: Alarm- & Notfallmanagement (5 Tabellen)
- `alarm_plans`: Alarmierungs- und Notfallpläne je Objekt (BMA, EMA, Überfall).
- `alarm_contacts`: Alarmempfänger, Polizeiinspektionen, Feuerwehrleitstellen.
- `alarm_events`: Aufgelaufene Alarme, Reaktionszeitmessung gem. VdS 2172.
- `escalation_rules`: Eskalationsstufen bei Nicht-Erreichbarkeit von Verantwortlichen.
- `emergency_procedures`: Handlungskataloge für Brand, Chemieunfall, Stromausfall.

### Modul I: Schlüssel- & Zutrittsverwaltung (5 Tabellen)
- `keys`: Schlüsselverzeichnis, Schließanlagen, Generalschlüssel (GHS).
- `key_assignments`: Berechtigte Mitarbeiter und Depotzuordnungen.
- `key_handover`: Ausgabeprotokoll, Rückgabequittung, Zeitstempel, Prüfer.
- `access_media`: RFID-Transponder, biometrische Schlüsselkarten.
- `access_permissions`: Gültigkeitszeitfenster und Türschließungsrechte.

### Modul J: Aufgabenverwaltung (5 Tabellen)
- `tasks`: Operative Maßnahmen, Audits, Reparaturaufträge.
- `task_assignments`: Zuständige Wachleiter oder Sicherheitsfachkräfte.
- `task_comments`: Verlauf und Rückfragen zur Bearbeitung.
- `task_history`: Statuswechsel (`Offen` -> `In Bearbeitung` -> `Erledigt`).
- `task_reminders`: Automatisierte Erinnerungen vor Fristablauf.

### Modul K: Dokumentenmanagement (5 Tabellen)
- `documents`: Objektdokumente, Gebäudepläne, Feuerwehrlaufkarten.
- `document_versions`: Revisionsverlauf mit Speicherung im Mandanten-Storage.
- `document_categories`: Ordnerstruktur (KRITIS-Pläne, Verträge, Genehmigungen).
- `document_permissions`: Rollen- und objektspezifische Lese-/Schreibberechtigungen.
- `document_links`: Verknüpfungen von Dokumenten zu Kunden, Objekten oder Vorfällen.

### Modul L: Systemübergreifende Funktionen (7 Tabellen)
- `notifications`: Push- und Systemmitteilungen für Einsatzleitung und Wachposten.
- `audit_logs`: Revisionssicherer Audit-Trail (`table_name`, `action`, `old_values`, `new_values`, `ip`).
- `activity_logs`: Operative Benutzeraktivitäten zur Fehlersuche.
- `attachments`: Generische Datei-Anhänge.
- `comments`: Modulübergreifende Kommentarfunktion.
- `tags`: Schlagwörter für schnelle Filterung.
- `entity_tags`: N:M-Verknüpfung von Schlagwörtern zu beliebigen Geschäftsobjekten.

### Modul M: Offline-Synchronisation (7 Tabellen)
- `sync_devices`: Registrierte Wach-Handhelds und PWA-Installationen.
- `sync_sessions`: Synchronisationssitzungen mit Übertragungsstatus.
- `sync_queue`: Serverseitige Warteschlange für Replikationsereignisse.
- `sync_events`: Protokoll empfangener Offline-Pakete.
- `sync_conflicts`: Erkannte OCC-Konflikte (`server_version != client_version`).
- `sync_checkpoints`: Letzter erfolgreicher Replikationszeitstempel je Gerät.
- `client_change_tracking`: Vektoruhr-Tracking zur Idempotenz-Sicherung.
