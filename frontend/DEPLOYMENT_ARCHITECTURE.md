# SecurityOps 2.0 - Phase 12: Produktions- & Deploymentarchitektur

## 1. Topologie & Netzwerktrennung
SecurityOps 2.0 erzwingt eine strikte physische Netzwerktrennung:
- **`secops_public` (Internet)**: Ausschließlich Caddy Reverse Proxy lauscht auf Port 80 (HTTP-Redirect) und Port 443 (HTTPS TLS 1.3).
- **`secops_internal` (Isoliert)**: PostgreSQL 16+ und Redis laufen in einem internen Docker-Bridge-Netzwerk ohne Host-Portweiterleitung. Zugriff ist nur authentifizierten Containern gestattet.

```
Internet (Port 443) 
   │
   ▼
┌────────────────────────────────────────────────────────┐
│ Caddy Reverse Proxy (TLS 1.3, CSP, HSTS, Rate Limit)   │
└────────────┬─────────────────────────────┬─────────────┘
             │ /api/*                      │ Static Files
             ▼                             ▼
   ┌───────────────────────┐      ┌───────────────────────┐
   │ FastAPI Backend (8000)│      │ React 18+ PWA Shell   │
   └───────────┬───────────┘      └───────────────────────┘
               │ (Internal Only)
     ┌─────────┴─────────┐
     ▼                   ▼
┌──────────────┐   ┌──────────────┐
│PostgreSQL 16 │   │ Redis Queue  │
│(RLS Policies)│   │ + Celery     │
└──────────────┘   └──────────────┘
```

---

## 2. Horizontale Skalierungsstrategie (Multi-Server)
1. **Frontend / CDN**: Statische PWA-Dateien können ohne Zustandsbindung auf Edge-CDNs ausgelagert werden.
2. **Stateless API Backend**: FastAPI-Container können über Docker Swarm oder Kubernetes horizontal skaliert werden (`workers: 4`).
3. **Zentrales PostgreSQL-Cluster**: Master/Replica mit Streaming-Replication (Hot Standby) für RPO < 5 Min.
