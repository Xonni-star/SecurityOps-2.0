# SecurityOps 2.0 - Phase 6: Gerätesicherheit & Datenschutz

## 1. Grenzen lokaler Datenspeicherung
- IndexedDB unterliegt der Same-Origin Policy des Browsers.
- Bei Gerätewiderruf im Leitstellen-Dashboard wird das Gerät serverseitig auf `REVOKED` gesetzt. Alle nachfolgenden Sync-Aufrufe schlagen fehl.
- Beim Logout wird die lokale Session bereinigt.
