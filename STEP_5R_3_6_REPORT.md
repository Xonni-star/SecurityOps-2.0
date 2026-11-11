# SecurityOps 2.0 – Schritt 5R.3.6 Bericht

## Ausgangszustand

Standorte konnten bereits mandantengebunden angelegt und gelesen werden. Die vorhandene PATCH-Route verwendete jedoch nur `sites:create`, hatte keine Versionsprüfung und kannte weder Archivierung noch Wiederherstellung. Standortänderungen waren nicht an die IndexedDB-Outbox angebunden. Physisches Löschen wäre wegen der operativen Fremdschlüsselbeziehungen ungeeignet; Sites-RLS und Tabellenrechte ließen ohnehin kein DELETE durch die Anwendungsrolle zu.

## Geänderte Dateien

- `frontend/backend/src/app.ts` – getrennte Routenrechte sowie Site-Sync-Route.
- `frontend/backend/src/controllers/resourceController.ts` – Revision/CAS für Änderungen, Archivierung, Wiederherstellung und idempotente Sync-Verarbeitung.
- `frontend/backend/src/migrations/006_site_archive_revision.sql` – Status-/Revisionsspalten, Index und additive Berechtigungszuordnung.
- `frontend/backend/src/seeds/seed.ts` – neue Berechtigungscodes für Editieren, Archivieren und Wiederherstellen.
- `frontend/backend/src/tests/api_integration.test.ts` – API-, Mandanten-, Rechte-, Revisions-, Beziehungs- und Sync-Regressionen.
- `frontend/backend/src/tests/migrations.test.ts` – Migrationserwartungen auf Version 006 aktualisiert; dynamische Testmigrationen auf 007 verschoben.
- `frontend/components/SitesModule.tsx` – Bearbeiten, aktive/archivierte Ansicht, Status/Revisionsanzeige sowie Archivieren/Wiederherstellen.
- `frontend/services/indexedDbService.ts` – Standortentität und Restore-Aktion in der bestehenden Outbox.
- `frontend/store.ts` – Standortmutationen, Offline-Persistenz, versionsgebundene Outbox-Einträge und Site-Sync-Batching.
- `frontend/tests/storeApiIntegration.test.ts` – Frontendregression für Offline-Outbox und erneute Synchronisierung.
- `frontend/types.ts` – Site-Status, Revision und Outbox-Typen.

## Implementierung und Datenbank

Migration 006 ergänzt `sites.archived_at` und `sites.revision_version` (Startwert 1) sowie einen tenant-/statusbezogenen Index. Die Migration erweitert die vorhandenen Berechtigungen additiv und weist sie der bestehenden Rolle `Einsatzleitung` zu. Es wurden weder Standort-IDs noch bestehende Datensätze, Fremdschlüssel oder RLS-Regeln verändert.

Die API stellt `sites:update`, `sites:archive` und `sites:restore` getrennt durch Middleware sicher. Alle tenant-bezogenen Datenbankzugriffe laufen über `withTenantTransaction`; der Mandant stammt aus dem authentifizierten JWT. Update, Archive und Restore verwenden die übermittelte Revision als Compare-and-Swap-Bedingung, erhöhen die Revision bei Erfolg und liefern bei veraltetem Status HTTP 409. Fremde oder nicht sichtbare Standorte bleiben 404. Archivieren setzt ausschließlich `archived_at`; es gibt keinen physischen Standort-DELETE. Damit bleiben Schichten, Schlüssel, Aufgaben und weitere Verknüpfungen erhalten.

Der dedizierte `/api/v1/sites/sync`-Endpunkt prüft je Mutation die passende Berechtigung, validiert die Nutzdaten mit Zod und verwendet tenantgebundene Idempotenzquittungen plus Advisory Locks. Wiederholte identische Mutationen liefern dasselbe Ergebnis; eine abweichende Wiederverwendung derselben Mutations-ID wird abgewiesen. Versionskonflikte werden als `CONFLICT` quittiert, nicht still überschrieben. Die Outbox markiert Einträge erst nach Serverquittung als synchronisiert und überträgt Site-Mutationen nach Erstellungszeit sortiert.

Die Oberfläche unterscheidet aktive und archivierte Standorte, zeigt Archivzeitpunkt und Revision und bietet Bearbeiten, Archivieren sowie Wiederherstellen mit Lade-, Erfolgs-, Fehler- und Konfliktrückmeldung. Alle bestehenden Detailansichten bleiben erhalten.

## Berechtigungs-, RLS- und Regressionsergebnisse

- PostgreSQL 16.15; Migration 006 erfolgreich angewendet.
- Backend TypeScript-Build: erfolgreich.
- Backend Jest: **8 Suites bestanden, 139 Tests bestanden**.
- Frontend Vitest: **3 Dateien bestanden, 22 Tests bestanden**.
- Frontend-Produktionsbuild: erfolgreich.
- Docker-Compose-Produktionskonfiguration: erfolgreich validiert.
- Produktions-Dockerbuild Backend: erfolgreich.
- Produktions-Dockerbuild Frontend: erfolgreich.
- Geprüfte Fälle umfassen direkte Standortanlage/-ladung/-änderung, 409 bei veralteter Revision, Archivieren/Wiederherstellen, Erhalt verknüpfter Schichten/Schlüssel/Aufgaben, Fremdmandantenzugriff, fehlende Berechtigung, unauthentifizierte Anfrage, idempotente Offline-Anlage, Wiederholungs-/Payloadschutz, Offline-Outbox-Synchronisierung sowie fortbestehende Kunden-, Mitarbeiter-, Einsatz- und Wachbuchtests.

## GitHub-CI/CD

- Code-Commit `ed9fb7f7ef8faf21aeeb457ce8ca8f498018087a` – `feat: complete persistent site management`.
- GitHub CI: [Run 43104468861](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43104468861) – **success**.
- GitHub CD Release-Artefakte: [Run 43104762654](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43104762654) – **success**.
- Code-Commit wurde zusätzlich auf das private Forgejo-Repository `xanni/SecurityOps-2.0` gespiegelt.

## Verbleibende Einschränkungen

- Offline neu angelegte Standorte verwenden eine lokal erzeugte UUID; bei serverseitiger Ablehnung bleibt die Mutation als fehlgeschlagen/offen in der Outbox nachvollziehbar und muss fachlich korrigiert bzw. erneut übertragen werden.
- Die vorhandenen Vite-/Docker-Werkzeuge melden nicht-blockierende Hinweise zur Bundlegröße und zum Legacy-Docker-Builder. Beide Produktionsbuilds waren erfolgreich.
- CI/CD prüft automatisiert Backend, Migrationen, Frontend, Compose und Images. Eine produktive Bereitstellung auf einem Live-Host wurde nicht ausgelöst.
