# SecurityOps 2.0 - Administrator- & Betriebshandbuch

## 1. Berechtigungen & Rollen (RBAC)
- Wechseln Sie im oberen Menü oder im **Sicherheits-Audit** Bereich die aktive Rolle.
- Administratoren haben Zugriff auf das **E2E-Abnahme Center**, die **Docker & DB Blueprints** sowie das **Audit-Log**.

## 2. Automatisierungsregeln & Watchdog
- Im **Automatisierungs-Center** konfigurieren Sie deklarative Regeln für Zertifikatsabläufe, Kündigungsfristen und Schlüsselverzug.
- Der Scheduler führt regelmäßige Prüfungen durch und erzeugt Aufgaben sowie In-App Meldungen.

## 3. Backup und Wiederherstellung
- Backups laufen täglich um 02:00 UTC vollautomatisch verschlüsselt nach `/var/backups`.
- Wiederherstellung via CLI: `./deploy/restore.sh /var/backups/secops_backup_YYYYMMDD_HHMMSS.tar.gz.enc`.
