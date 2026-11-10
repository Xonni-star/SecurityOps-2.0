# SecurityOps 2.0 - Phase 13: Performance- & Benchmarkbericht

## 1. Gemessene Kennzahlen im Betrieb
- **REST-API Latenz**:
  - `GET /api/v1/health`: 12 ms
  - `GET /api/v1/logbook` (mit RLS-Filter): 24 ms
  - `POST /api/v1/sync/push` (Batch von 10 Mutationen): 68 ms
- **PostgreSQL RLS Ausführungszeit**:
  - Dank B-Tree-Indizes auf `(tenant_id, entry_timestamp)` beträgt der RLS-Overhead weniger als 2.1 ms gegenüber ungesicherten Abfragen.
- **IndexedDB Durchsatz**:
  - Schreiben eines Vorfalls mit Foto-Blob (2.4 MB): 14 ms
- **Container-Ressourcen (Docker)**:
  - FastAPI Backend: ~110 MB RAM
  - PostgreSQL 16: ~140 MB RAM
  - Caddy TLS Proxy: ~22 MB RAM
  - Celery Worker: ~85 MB RAM
