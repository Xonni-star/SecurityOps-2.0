# SecurityOps 2.0 - Installations- & Betriebshandbuch

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Dieses Dokument beschreibt die vorhandene Docker-Konfiguration und ersetzt keine Produktivabnahme.

## 1. Systemanforderungen
- **Betriebssystem**: Debian 12 / Ubuntu 22.04 LTS / Red Hat Enterprise Linux 9
- **Hardware**: Mind. 2 CPU-Kerne, 4 GB RAM, 20 GB SSD
- **Software**: Docker Engine >= 24.0 & Docker Compose v2

## 2. Docker-Installation
```bash
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0
chmod +x frontend/deploy/install.sh
./frontend/deploy/install.sh
```

Der Installer verwendet `frontend/deploy/docker-compose.production.yml`, kopiert `frontend/deploy/.env.example` nach `frontend/deploy/.env` (falls noch nicht vorhanden), erzeugt Secrets und startet die Container. Ein einmaliger `migrate`-Container führt die versionierten Backend-SQL-Migrationen aus; anschließend richtet `db-init` das Least-Privilege-App-Konto ein. Vor einem realen Einsatz müssen Domain, Secrets, Backup-Ziel, TLS und Wiederherstellung geprüft werden. Der Installer wurde nicht als allgemeine Produktionsfreigabe abgenommen.

## Alarm-Eskalationsworker

Der Alarm-Eskalationsworker ist Bestandteil des Backend-Prozesses und wird beim Serverstart automatisch aktiviert. Er verarbeitet tenantgebundene PostgreSQL-Jobs mit Sperren, Ablauf-Leases und begrenzten Wiederholungen; ein separater Scheduler oder zusätzlicher Container ist nicht erforderlich. In-App-Zustellungen werden in PostgreSQL protokolliert. E-Mail und Push bleiben `not_configured`, bis ein Versandprovider implementiert und konfiguriert wurde; Installation oder Migration allein richtet keinen externen Versand ein. Siehe [Alarm-API und Einschränkungen](./ALARM_EMERGENCY_API.md).

## Übergabemanagement

Die PostgreSQL-API führt die Handover-Migrationen über den Backend-Migrationsrunner aus. Die Oberfläche benötigt eine angemeldete Sitzung mit `handovers:read`; Aktionen werden serverseitig über `handovers:*` und gegebenenfalls `documents:read` geprüft. Es ist kein externer E-Mail-/Push-Anbieter eingerichtet. Das Modul bestätigt ausschließlich den tatsächlich in PostgreSQL gespeicherten Zustand. Diese Beschreibung gilt für den dokumentierten Quellcode, nicht als Aussage, dass ein Feature-PR gemergt oder produktiv deployed wurde.

## Benutzer- und Rechteverwaltung

Die aktuelle Benutzer-/Rollenverwaltung im Entwicklungs-Branch wird durch Backend-Migration `033_tenant_user_role_administration.sql` ergänzt. Sie nutzt tenantgebundene Datensätze, PostgreSQL RLS/FORCE RLS und API-Prüfungen; aktuelle Einsatz-/Abnahmegrenzen stehen in [USER_ADMINISTRATION_API.md](./USER_ADMINISTRATION_API.md). Reset-Tokens werden nicht automatisch per E-Mail zugestellt.
