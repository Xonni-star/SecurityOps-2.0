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

Der Installer prüft automatisch Systemressourcen, erzeugt kryptografische Geheimnisse in `.env`, startet die Container-Topologie und wendet alle Alembic-Migrationen an.
