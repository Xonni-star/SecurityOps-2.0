# Changelog - SecurityOps 2.0

Alle wesentlichen Änderungen und Versionierungsstufen dieses Projekts werden in dieser Datei dokumentiert.
Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/) und folgt [Semantic Versioning](https://semver.org/lang/de/).

---

## [1.0.0] - 2025-05-15 (Gold Master Release - BSI & DIN 77200 Enterprise Edition)

### Hinzugefügt (Added)
- **Gesamtsystemintegration & E2E-Abnahme**:
  - Interaktives Abnahme-Cockpit (`components/E2EAcceptanceCenter.tsx`) zur automatisierten Ausführung der End-to-End-Szenarien 1 bis 10 mit Live-Assertionen und Audit-Logging.
  - Vollständige RBAC-Matrix mit 8 Rollen (Systemadministrator, Geschäftsführung, Einsatzleitung, Objektleitung, Personalverwaltung, Qualitätsmanagement, Wachdienst, Auditor).
  - Lückenlose Verknüpfung: Kunde ➔ Vertrag ➔ Objekt ➔ Personal ➔ Dienstplan ➔ Wachbuch ➔ Vorfälle ➔ Aufgaben ➔ Schlüssel ➔ DMS.
- **Mandantenfähigkeit & physische Datenraumtrennung**:
  - PostgreSQL 16+ Row-Level-Security (RLS) mit `tenant_isolation_policy` auf Session-Variable `app.current_tenant`.
  - Zusammengesetzte Fremdschlüssel `(entity_id, tenant_id)` verhindern Cross-Tenant-Verknüpfungen physisch auf Datenbankebene.
- **Offline-First & PWA-Architektur**:
  - Installierbare Progressive Web App (`public/manifest.json`, Service Worker `public/sw.js`).
  - IndexedDB-Storage-Vault (`SecurityOps2_OfflineVault`) mit Outbox-, Inbox- und Attachment-Stores.
  - Append-Only-Verfahren für Wachbucheinträge und Vorfälle (kein stilles Überschreiben, Revisionsvektoren).
  - Side-by-Side-Konfliktlösungszentrum mit ETag- und Versionsprüfung für kollidierende Aufgaben.
- **Mobile Mitarbeiter-App & Objektsteuerung**:
  - Responsive Mobile Shell (`components/MobileAppShell.tsx`) mit touch-optimierter Daumennavigation (WCAG 2.2 AA).
  - "Mein Dienst": Schichtzeiten, Dienstort, Ansprechpartner und digitaler Diensttausch-Workflow.
  - QR-Code- und NFC-Kontrollgangscanner mit Kamera-Integration und Anti-Duplikat-Sperre (< 2 Min.).
  - Digitales Wachwechsel- und Schichtübergabeprotokoll mit Schlüsseldepot-Prüfung.
- **Automatisierungs- & Watchdog-Engine**:
  - Deklarative Event-Condition-Action (ECA)-Engine mit sicherer Operatoren-Auswertung (`LESS_THAN_DAYS`, `EQUALS`, `IN_ARRAY`).
  - Proaktive Warnungen und automatische Aufgabenerzeugung bei ablaufenden § 34a-Nachweisen, Kündigungsfristen und überfälligen Schlüsseln.
  - Multi-Channel-Benachrichtigungssystem (In-App, E-Mail-Dispatch, Web-Push-Vorbereitung).
- **Controlling, Berichte & Management-Cockpit**:
  - Live-KPI-Berechnung aus realen Datenbankentitäten (Soll/Ist-Stundenbilanz, Planerfüllung, DIN 77200-Score).
  - Integrierter Report-Generator für rollenbasierte Auswertungen (GF, Einsatzleitung, Objektleitung, HR).
  - Druckfertiger PDF-Export und formatierter CSV/Excel-Export mit UTF-8-BOM.
- **Sicherheit, Kryptografie & DSGVO-Härtung**:
  - Argon2id Password Hashing (310.000 SHA512-Runden, random Salt, Brute-Force Lockout nach 5 Fehlversuchen).
  - JWT mit kryptografisch gesicherten Tenant- und Rollen-Claims sowie Session-Blacklisting (`revokeSession`).
  - Path-Traversal-Sanitizer für Dateiuploads mit 15-MB-Limit und Whitelist (`.pdf`, `.png`, `.jpg`, `.docx`).
  - Gesetzliche Aufbewahrungs- und Löschrichtlinien nach ArbZG (2 Jahre), BGB/GewO (3 Jahre) und BDSG (1 Jahr).
- **Produktionsfertiges DevOps- & Deployment-System**:
  - Multi-Stage unprivileged Dockerfiles (Non-Root UID 10001).
  - Caddy Reverse Proxy mit automatischem TLS 1.3, HSTS und restriktiver Content-Security-Policy.
  - Internes isoliertes Docker-Netzwerk: PostgreSQL und Redis sind von außen unerreichbar.
  - Automatisierter 24h-Backup-Daemon mit AES-256-Verschlüsselung und verifiziertem Restore-Skript (`deploy/restore.sh`).
  - GitHub Actions CI/CD-Pipeline mit Pytest-Integration, Typecheck und Container-Sicherheitsprüfung.

### Behoben (Fixed)
- Beseitigung potenzieller IDOR-Risiken durch strikte Ableitung des Mandantenkontexts aus verifizierten JWT-Claims.
- Behebung von Datenverlustrisiken im Funkloch durch persistente lokale IndexedDB-Warteschlangen.
- Vermeidung von Dienstplanungskonflikten durch Echtzeit-Validierung von Krankmeldungen und Urlaubsanträgen vor Dispositionsbestätigung.
