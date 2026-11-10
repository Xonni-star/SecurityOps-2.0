# SecurityOps 2.0 - Administrator- & Betriebshandbuch

## 1. Installation und Inbetriebnahme
Die Installation erfolgt reproduzierbar über das CLI-Installationsskript:
```bash
chmod +x deploy/install.sh
./deploy/install.sh
```
Das Skript validiert Systemanforderungen, erzeugt kryptografische Geheimnisse in `.env`, startet die isolierte Docker-Topologie und wendet die Alembic-Migrationen an.

## 2. Backup & Disaster Recovery
- **Tägliches Backup**: Erfolgt vollautomatisch verschlüsselt um 02:00 UTC nach `/var/backups`.
- **Manuelles Backup**:
  ```bash
  docker compose -f deploy/docker-compose.production.yml exec db pg_dump -U secops_admin securityops_v2 -F c -f /var/backups/manual.dump
  ```
- **Wiederherstellung (Disaster Recovery)**:
  ```bash
  ./deploy/restore.sh /var/backups/secops_backup_20250515_020000.tar.gz.enc
  ```

## 3. Sicherheits- und Berechtigungsverwaltung (RBAC)
- Administratoren verwalten Benutzerrollen im Modul **Sicherheits-Audit & DSGVO**.
- Kompromittierte Endgeräte können dort mit einem Klick (`Sitzung widerrufen`) gesperrt werden; ihr JWT-Token wird umgehend abgewiesen.
