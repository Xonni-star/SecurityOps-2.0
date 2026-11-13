# SecurityOps 2.0 - Installations- & Betriebshandbuch

## 1. Systemanforderungen
- **Betriebssystem**: Debian 12 / Ubuntu 22.04 LTS / Red Hat Enterprise Linux 9
- **Hardware**: Mind. 2 CPU-Kerne, 4 GB RAM, 20 GB SSD
- **Software**: Docker Engine >= 24.0 & Docker Compose v2

## 2. Automatische 1-Befehl Installation
```bash
git clone https://github.com/Xonni-star/SecurityOps-2.0.git
cd SecurityOps-2.0
chmod +x deploy/install.sh
./deploy/install.sh
```

Der Installer prüft automatisch Systemressourcen, erzeugt kryptografische Geheimnisse in `.env`, startet die Container-Topologie und wendet die versionierten SQL-Migrationen des Backends an.

## Alarm-Eskalationsworker

Der Alarm-Eskalationsworker ist Bestandteil des Backend-Prozesses und wird beim Serverstart automatisch aktiviert. Er verarbeitet tenantgebundene PostgreSQL-Jobs mit Sperren, Ablauf-Leases und begrenzten Wiederholungen; ein separater Scheduler oder zusätzlicher Container ist nicht erforderlich. In-App-Zustellungen werden in PostgreSQL protokolliert. E-Mail und Push bleiben `not_configured`, bis ein Versandprovider implementiert und konfiguriert wurde; Installation oder Migration allein richtet keinen externen Versand ein. Siehe [Alarm-API und Einschränkungen](./ALARM_EMERGENCY_API.md).

## Übergabemanagement

Die PostgreSQL-API führt beim normalen Migrationslauf `017_handover_management.sql` nach den Alarmmigrationen 015/016 aus. Die Migration trägt die Handover-Berechtigungen direkt in die vorhandenen Rollen ein. Die Oberfläche benötigt eine angemeldete Sitzung mit `handovers:read`; Aktionen werden serverseitig über `handovers:*` und gegebenenfalls `documents:read` geprüft. Es ist kein externer E-Mail-/Push-Anbieter eingerichtet. Das Modul bestätigt ausschließlich den tatsächlich in PostgreSQL gespeicherten Zustand. Der offene Feature-PR ist nicht produktiv deployed.
