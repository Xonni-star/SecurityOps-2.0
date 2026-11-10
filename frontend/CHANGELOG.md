# Changelog - SecurityOps 2.0

## [1.0.0] - 2025-05-15 (Gold Master Release)
### Hinzugefügt
- **Gesamtsystemintegration**: Vollständige Vernetzung aller 12 Kernmodule (Kunden, Verträge, Objekte, Personal, Dienstplan, Wachbuch, Vorfälle, QM, Alarme, Schlüssel, Aufgaben, DMS).
- **E2E-Abnahme Center**: Interaktive Abnahmekonsole für Szenarien 1 bis 10 mit Live-Assertionen und Audit-Logging.
- **Multi-Tenancy**: Physische Mandantentrennung auf Datenbankebene mit PostgreSQL 16+ Row-Level-Security (RLS).
- **Offline-First & PWA**: IndexedDB Outbox/Inbox Replikations-Engine mit Append-Only Wachbuch und Konflikt-Diffing.
- **Mobile Mitarbeiter-App**: Touch-optimierte Daumennavigation ("Mein Dienst", QR/NFC Scanner, Schichtübergabe).
- **Automatisierungsengine**: Deklarative Event-Condition-Action Regeln mit Idempotenz-Schutz und Multi-Channel Notifikationen.
- **BSI-Sicherheit**: Argon2id KDF mit 310.000 Runden, Brute-Force Lockout, Session Revocation und IDOR-Blockade.
- **Produktions-Deployment**: Docker Compose mit Caddy Reverse Proxy (TLS 1.3), unprivileged non-root Containern und AES-256 Backups.
