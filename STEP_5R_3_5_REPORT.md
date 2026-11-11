# SecurityOps 2.0 – Entwicklungsschritt 5R.3.5
## Kundenverwaltung dauerhaft vervollständigt

**Status:** umgesetzt und geprüft  
**Code-Commit:** `f3207efce615acfc3be07555af09d5f021b4eb3d` – `feat: complete persistent customer management`

## Änderungen

- `frontend/backend/src/app.ts` – authentifizierte Kunden-PATCH-, Archivierungs- und Offline-Sync-Routen.
- `frontend/backend/src/controllers/clientController.ts` – Zod-validierte Änderungen, Revision-Checks, Soft-Archive sowie mandantengebundener, idempotenter Kundensync.
- `frontend/backend/src/migrations/005_customer_archive_revision.sql` – additive Spalten `archived_at` und `revision_version` sowie partieller Index auf aktive Kunden. Migration ist wiederholbar (`IF NOT EXISTS`).
- `frontend/backend/src/tests/api_integration.test.ts` – Persistenz, Revisionkonflikt, Fremdmandant, Soft-Archive mit erhaltenem Standortbezug und wiederholbare Offline-Anlage.
- `frontend/backend/src/tests/backend_phase1.test.ts` – nicht authentifizierte und nicht berechtigte Schreibzugriffe.
- `frontend/backend/src/tests/migrations.test.ts` – Versions- und Baseline-Erwartungen für Migration 005 aktualisiert; zusätzliche Migrationstests bleiben auf Version 006.
- `frontend/components/ClientsModule.tsx` – Kunden bearbeiten und archivieren.
- `frontend/services/indexedDbService.ts`, `frontend/store.ts`, `frontend/types.ts` – Kundentyp in der bestehenden Outbox, optimistische Offline-Bearbeitung/Archivierung/Anlage und Versand zum Kundensync.
- `frontend/tests/storeApiIntegration.test.ts` – Online-Bearbeitung/Archivierung und Offline-Outbox-Regressionen.

## Verhalten und Schutzmaßnahmen

- Kunden können über die bestehende API geändert werden. `revision_version` wird atomar geprüft und erhöht; veraltete Updates ergeben HTTP 409.
- Archivierung setzt `archived_at`; physisches Löschen wurde bewusst nicht implementiert, da Standorte per `ON DELETE RESTRICT` auf Kunden verweisen. Archivierte Kunden werden in der normalen Liste ausgeblendet; bestehende IDs und Beziehungsdaten bleiben erhalten.
- Mandant wird ausschließlich aus dem authentifizierten JWT übernommen. API-Abfragen und Schreibvorgänge enthalten zusätzlich `tenant_id` und laufen in `withTenantTransaction`; bestehende RLS-Regeln und Datenbankrechte wurden nicht gelockert.
- Lesen erfordert `customers:read`; Anlage, Bearbeitung und Archivierung erfordern das vorhandene Schreibrecht `customers:create` (gleiches Berechtigungsmodell wie andere bestehende Ressourcen).
- Offline-Kundenmutationen werden mit Mandant/User in der vorhandenen IndexedDB-Outbox gespeichert. Kundensync prüft die Berechtigung pro Mutation, serialisiert wiederholte Mutations-IDs mit Advisory Lock und speichert Quittungen. Abweichende Wiederverwendung einer Mutations-ID wird abgewiesen; veraltete Revisionen werden als Konflikt quittiert.
- Es wurden keine Bestandskunden oder Kunden-IDs gelöscht und keine anderen Fachmodule geändert.

## Tatsächliche Prüfergebnisse

- Backend TypeScript Build (`npm run build`): **bestanden**.
- Backend Jest (`npm test -- --runInBand`): **8/8 Suites, 135/135 Tests bestanden**, einschließlich PostgreSQL-Integrationstests.
- Frontend Vitest: **3/3 Dateien, 21/21 Tests bestanden**.
- Frontend Produktionsbuild: **bestanden**.
- PostgreSQL-Migration 005 auf der isolierten lokalen CI-Datenbank: **erfolgreich angewendet**.
- Docker Compose Produktionskonfiguration (`docker compose ... config --quiet`, mit ausschließlich temporären Prüf-Platzhalterwerten): **bestanden**.
- Produktions-Dockerbuild Backend: **bestanden**.
- Produktions-Dockerbuild Frontend: **bestanden**.
- GitHub CI Run [43100211123](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43100211123): **erfolgreich** (Root-Smoke-Start, Backend/PostgreSQL/Jest, Frontend und Dockerjobs).
- GitHub CD-/Release-Artefakt-Run [43100615171](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43100615171): **erfolgreich** (Frontend-/Backend-Artefakte heruntergeladen, Manifest erzeugt, Paket hochgeladen).

## Bekannte Einschränkungen

- Kundenkonflikte werden erkannt und als Konflikt in der Outbox quittiert. Eine eigene UI zur interaktiven Auflösung dieser Kundensync-Konflikte ist nicht Teil dieses Schritts; nach Prüfung des Serverstands muss eine neue Änderung mit aktueller Revision eingereicht werden.
- Archivierte Kunden sind in der Standard-Kundenliste nicht sichtbar. Eine Wiederherstellungsfunktion wurde nicht ergänzt.
- Der CD-Workflow erstellt ein Release-Artefakt; ein separates Live-Produktionsdeployment wurde durch diesen Schritt nicht ausgelöst.
