# SecurityOps 2.0 - Phase 13: Performance- & Lasttestbericht

> **Historischer Snapshot:** Messwerte und Architekturangaben stammen aus einem früheren Stand und wurden für den aktuellen TypeScript/Express/PostgreSQL-Stack nicht erneut verifiziert. Insbesondere sind FastAPI-Messwerte nicht auf den aktuellen Stack übertragbar.

## 1. Messwerte
- **API Response Time (Durchschnitt)**: 28 ms für `/api/v1/logbook`, 18 ms für `/api/v1/health`.
- **PostgreSQL RLS Overhead**: < 2 ms zusätzlich pro Abfrage durch B-Tree-Indizes auf `tenant_id`.
- **IndexedDB Schreibgeschwindigkeit**: < 15 ms pro Vorfall inklusive Foto-Blob (<= 5 MB).
- **Speicherbedarf**: Caddy Reverse Proxy < 30 MB RAM, FastAPI Worker < 120 MB RAM.
