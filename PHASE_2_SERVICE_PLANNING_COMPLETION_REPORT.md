# Phase 2: Dienst- und Einsatzplanung — Abschlussbericht

## Ergebnis

Die bestehende `roster`-Route wurde zu einer responsiven Planungsoberfläche ausgebaut und an die Planning-API angebunden. Die Implementierung baut auf dem Backend-Stack `xonni-star-phase-2-backend-planning` auf; der Stack-Basisstand ist `fd91f33c05ab3db10fba8d4d09c4ffcbdc8afa55` (API-Korrekturen in `0ca75faa45b31718d04a30754fb8ad44fe56bd32`). Backend-Implementierung und Migrationen wurden in diesem Frontend-Layer nicht geändert.

## Implementierter Umfang

- Monats-, Wochen- und Tageskalender mit Gruppierung nach Zeit, Mitarbeiter, Objekt und Kunde, Zeitraumwahl, Filter und Suche.
- Schichtentwürfe anlegen, bearbeiten, verschieben, kopieren, wiederholen und über Templates erzeugen; Perioden anlegen und serverseitig veröffentlichen.
- Mitarbeiter online zuweisen; Tauschanträge stellen und gemäß Berechtigung entscheiden. Serverbefunde und Revisionskonflikte werden angezeigt. Destruktive und Veröffentlichungsaktionen erfordern Bestätigung.
- Coverage- und Arbeitszeitberichte sowie CSV-Export und Druckansicht.
- Tenant-/User-scoped IndexedDB-Cache sowie dauerhafte Shift-Outbox mit stabiler Mutations-ID und Basisrevision. Nach Sync werden Server-ID/Revision übernommen; Konflikte und Ablehnungen bleiben sichtbar.
- Offline ist das Anlegen einzelner unbesetzter Drafts ohne Periodenbindung und mit Mindestbesetzung 1 möglich. Offline-Updates verwenden die Server-ID und Basisrevision und ändern weder Periodenzuordnung noch Mindestbesetzung. Beides bleibt bis zur Serverantwort ungeprüft und unveröffentlicht. Zuweisung, Tauschentscheidung und Veröffentlichung sind online-only.
- Semantische Controls, Lade-/Leer-/Fehlerzustände, Cache-Hinweise und zugängliche Status-/Befunddarstellung.

## Backend- und Produktgrenzen

- Der Backend-Vertrag ermöglicht keine Vorlagenliste; angewendete Templates erzeugen Entwürfe mit Mindestbesetzung 1.
- Es gibt keine eigene Cover-Request-API; vertreten wird der verfügbare Diensttausch-Workflow.
- Berichte decken geplante Stunden/Wochenenddienste und Coverage ab, nicht Ist-/Überstundenabrechnung oder vollständige Qualifikations-, Abwesenheits-, Feiertags- und Nachtarbeitsauswertungen.
- Die Oberfläche enthält keine Verwaltung der Regelprofile. Die Serverprüfung ersetzt keine fachliche oder rechtliche Prüfung und attestiert keine Einhaltung des ArbZG, eines Tarifvertrags oder einer betrieblichen Regel.
- Offline-Änderungen werden erst beim Sync serverseitig geprüft. Eine lokale Eingabe oder erfolgreicher Sync bedeutet keine Veröffentlichung; Veröffentlichung bleibt eine separate, versionierte Online-Aktion. Offline-Freigaben, Tausche und endgültige Zuweisungen werden nicht unterstützt.
- Responsive Markup wurde implementiert, aber nicht auf realen Geräten, mit sämtlichen Browsern oder in einer produktiven Deployment-Umgebung verifiziert. Rollout, Backup-/Wiederherstellung und fachlich/rechtliche Abnahme sind nicht Bestandteil der Frontend-Tests.

## Vertragsabgleich

Der aktualisierte Backend-Vertrag enthält `required_count` in `GET /planning/shifts`. Shift-Sync UPDATE verlangt `payload.id`; das strikte Schema akzeptiert diese ID und die unterstützten Felder, während Mindestbesetzung und Periodenzuordnung nicht Teil des Update-Payloads sind. Die Offline-Update-Implementierung sendet daher ausschließlich `id`, Objekt, Datum/Uhrzeit, Dienstart, Qualifikation und Pause, mit `baseVersion` aus der geladenen Schicht. Finale serverseitige Validierung und Konfliktbehandlung erfolgen beim Sync.

API-Details und Berechtigungen: [SERVICE_PLANNING_API.md](./frontend/backend/SERVICE_PLANNING_API.md). Spezifikation und aktueller Status: [SERVICE_PLANNING_SPECIFICATION.md](./frontend/SERVICE_PLANNING_SPECIFICATION.md).

## Verifikation

- Frontend-Vitest: `npm --prefix frontend test -- --run` — 14 Testdateien, 67 Tests bestanden.
- Frontend-Produktionsbuild: `npm --prefix frontend run build` — erfolgreich. Vite meldet einen Chunk über 500 kB und den `__dirname`-Hinweis der Config.
- Backend-TypeScript-Build: `npm --prefix frontend/backend run build` — erfolgreich mit der im Backend-Lockfile fixierten TypeScript-Version.
- Backend-Zeit-/DST-Tests: `npm --prefix frontend/backend test -- --runInBand src/tests/planningTime.test.ts` — 4 Tests bestanden.
- Die vollständige Backend-Jest-Suite konnte nicht ausgeführt werden: in der Umgebung fehlen `DATABASE_URL`, `JWT_SECRET` und `CORS_ORIGIN`; die Suite bricht beim Laden der Backend-Konfiguration ab. PostgreSQL-Integrations- und Migrationsprüfungen bleiben damit hier unbestätigt; der Backend-PR-CI-Status ist unabhängig davon nachzuverfolgen.
