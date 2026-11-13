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

## Übergabemanagement

Die PostgreSQL-API führt beim normalen Migrationslauf zusätzlich `017_handover_management.sql` aus. Die Versionslücke 015/016 ist absichtlich für die entsprechenden Migrationen des noch offenen Alarm-PR #12 freigehalten; der PR ist nicht Bestandteil dieses Feature-Branches. Die Migration trägt die Handover-Berechtigungen direkt in die vorhandenen Rollen ein:

```bash
npm --prefix frontend/backend run migrate
```

Die Oberfläche benötigt eine angemeldete Sitzung mit `handovers:read`; Aktionen werden zusätzlich serverseitig über `handovers:*` und gegebenenfalls `documents:read` geprüft. Es ist kein externer E-Mail-/Push-Anbieter eingerichtet. Das Modul bestätigt deshalb ausschließlich den tatsächlich in PostgreSQL gespeicherten Zustand. Produktionsbereitstellung oder Betriebsfreigabe sind nicht Teil dieser Migration.
