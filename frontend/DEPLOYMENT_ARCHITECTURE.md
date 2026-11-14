# SecurityOps 2.0 - Deploymentarchitektur

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Beschrieben wird die vorhandene Docker-Konfiguration in `frontend/deploy/`, nicht eine unabhängig verifizierte Produktionsumgebung.

## Aktuelle Container-Topologie

Die Produktions-Compose-Datei definiert Caddy als öffentliche TLS-/Reverse-Proxy- und Static-File-Schicht. Caddy bedient das gebaute React/Vite-Frontend und leitet `/api/*` an die TypeScript/Express-API weiter. PostgreSQL 16 und die API veröffentlichen keine Host-Ports und befinden sich im internen Docker-Netzwerk.

```text
Internet
   |
   v
Caddy (Ports 80/443; TLS, statische React/Vite-Dateien)
   | /api/*
   v
Express / TypeScript API (intern, Port 8000)
   |
   v
PostgreSQL 16 (intern)
```

Ein einmaliger `migrate`-Container führt Datenbankmigrationen mit `secops_admin` aus. Danach initialisiert `db-init` das Passwort für die Least-Privilege-Rolle `secops_app_user`; der Backend-Container nutzt diese Rolle. Ein weiterer Initialisierungscontainer bereitet das private DMS-Volume vor. Konfiguration: [`deploy/docker-compose.production.yml`](./deploy/docker-compose.production.yml), [`deploy/Caddyfile`](./deploy/Caddyfile).

Ein Backup-Container ist in Compose konfiguriert. Er erstellt im 24-Stunden-Intervall einen AES-256-CBC/PBKDF2-verschlüsselten PostgreSQL-Dump inklusive DMS-Dateivolume und löscht Archive nach 30 Tagen. Das beschreibt die Konfiguration, nicht den Nachweis erfolgreicher Sicherungs- oder Wiederherstellungsläufe. Das Restore-Runbook liegt unter [`deploy/restore.sh`](./deploy/restore.sh); Wiederherstellungen müssen in einer isolierten Umgebung geübt werden.

## Nicht implementierte bzw. nicht nachgewiesene Skalierung

Redis, FastAPI, Celery und Kubernetes gehören nicht zur aktuellen Compose-Topologie. Es gibt keine belegte horizontale Multi-Server-Skalierung, CDN-Auslagerung oder garantierte RPO-Angabe. Die interne Docker-Netzwerkgrenze und konfigurierten Container-Ressourcen sind keine Ersatzmaßnahme für Betriebshärtung, Monitoring, Disaster-Recovery-Tests oder Sicherheitsabnahme.
