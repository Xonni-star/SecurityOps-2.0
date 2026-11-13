# Phase 2: Dienst- und Einsatzplanung — Abschlussbericht

## Ergebnis

Die bestehende `roster`-Route wurde zu einer responsiven Planungsoberfläche ausgebaut und an die Planning-API angebunden. Die Implementierung baut auf dem Backend-Stack `xonni-star-phase-2-backend-planning` auf, der mit `main` (`35300252fc471e3e347a4842d35cccb70342adf1`) abgeglichen wurde. Dieses Follow-up erweitert den Backend-Vertrag und seine Tests; die Frontend-Komponenten und der Store wurden nicht geändert.

## Implementierter Umfang

- Monats-, Wochen- und Tageskalender mit Gruppierung nach Zeit, Mitarbeiter, Objekt und Kunde, Zeitraumwahl, Filter und Suche.
- Schichtentwürfe anlegen, bearbeiten, verschieben, kopieren, wiederholen und über Templates erzeugen; Perioden anlegen und serverseitig veröffentlichen.
- Mitarbeiter online zuweisen; Tauschanträge stellen und gemäß Berechtigung entscheiden. Serverbefunde und Revisionskonflikte werden angezeigt. Destruktive und Veröffentlichungsaktionen erfordern Bestätigung.
- Coverage- und Arbeitszeitberichte sowie CSV-Export und Druckansicht. Leere Berichtsergebnisse sind ausdrücklich gekennzeichnet; nicht verfügbare Kategorien werden als unkonfiguriert/fehlend ausgewiesen und nicht durch Nullwerte ersetzt.
- Verwaltung versionierter, quellenbelegter Regelprofilrevisionen über die dokumentierten Endpunkte: Profile/Revisionen lesen, Entwürfe erstellen und Freigabe online mit Serverentscheidung anfordern. Die UI setzt keine Regelgrenzwerte voraus und behauptet keine Rechtskonformität.
- Tenant-/User-scoped IndexedDB-Cache sowie dauerhafte Shift-Outbox mit stabiler Mutations-ID und Basisrevision. Nach Sync werden Server-ID/Revision übernommen; Konflikte und Ablehnungen bleiben sichtbar.
- Offline ist das Anlegen einzelner unbesetzter Drafts ohne Periodenbindung und mit Mindestbesetzung 1 möglich. Offline-Updates verwenden die Server-ID und Basisrevision und ändern weder Periodenzuordnung noch Mindestbesetzung. Beides bleibt bis zur Serverantwort ungeprüft und unveröffentlicht. Zuweisung, Tauschentscheidung und Veröffentlichung sind online-only.
- Semantische Controls, Lade-/Leer-/Fehlerzustände, Cache-Hinweise und zugängliche Status-/Befunddarstellung.

## Backend- und Produktgrenzen

- Der Backend-Vertrag stellt Vorlagenliste, revisionierte Bearbeitung/Aktivierung und Anwendung bereit; Änderungen wirken nur auf künftige Anwendungen. Erzeugte Schichten bleiben Entwürfe und benötigen finale Zuweisungs-/Veröffentlichungsprüfung.
- Cover-Requests sind getrennt vom Diensttausch implementiert. Die Backend-API bietet erklärbare, deterministische und nicht bindende Besetzungsvorschläge; sie garantieren weder Fairness noch Rechtskonformität und weisen niemanden ohne Bestätigung zu.
- Vorlagen können revisioniert bearbeitet und deaktiviert/reaktiviert werden; ein hard delete und ein eigener Copy-Endpunkt fehlen weiterhin. Kopien können per Create mit denselben gewünschten Werten angelegt werden.
- Arbeitszeitberichte enthalten geplante und aufgezeichnete Ist-Zeiten, konfigurierte Überstunden-/Nacht-/Feiertags-/Wochenendwerte sowie Qualifikations-, Abwesenheits- und Coverage-Berichte. Fehlende Ist- oder Regelkonfiguration wird explizit als nicht verfügbar/unkonfiguriert markiert, nicht als Nullwert ausgegeben.
- Ist-Zeit-Erfassung und Korrekturen sind revisions- und auditgeschützt, besitzen aber keine separate Freigabe durch eine zweite Person. Sie sind deshalb kein eigenständig freigegebener Lohnabrechnungsnachweis.
- Regelprofilbereiche sind derzeit mandantenweit oder objektbezogen; Mitarbeitergruppen-/Beschäftigungsart-Scopes und fachliche Prioritäts-/Merge-Regeln sind offen. Bei mehreren passenden Revisionen blockt die Planung statt stillschweigend einen Wert auszuwählen.
- Planungsereignisse erzeugen keine Benutzerbenachrichtigungen. Der Backend-Layer begrenzt Anfragen global je IP; der In-Memory-Zähler wird nicht zwischen Replikas geteilt und erfordert für Multi-Instance-Deployments ein Gateway-Limit. CSV-Exporte neutralisieren formelartige Textspalten; numerische Messwerte bleiben unverändert.
- Regelprofile erfordern eine fachliche Prüfung der hinterlegten Quelle und Werte. Die Serverprüfung und Freigabe ersetzt keine Rechtsberatung und attestiert keine Einhaltung des ArbZG, eines Tarifvertrags oder einer betrieblichen Regel. Ersteller dürfen ihre eigene Revision serverseitig nicht freigeben.
- Offline-Änderungen werden erst beim Sync serverseitig geprüft. Eine lokale Eingabe oder erfolgreicher Sync bedeutet keine Veröffentlichung; Veröffentlichung bleibt eine separate, versionierte Online-Aktion. Offline-Freigaben, Tausche und endgültige Zuweisungen werden nicht unterstützt.
- Responsive Markup wurde implementiert, aber nicht auf realen Geräten, mit sämtlichen Browsern oder in einer produktiven Deployment-Umgebung verifiziert. Rollout, Backup-/Wiederherstellung und fachlich/rechtliche Abnahme sind nicht Bestandteil der Frontend-Tests.

## Vertragsabgleich

Der aktualisierte Backend-Vertrag enthält `required_count` in `GET /planning/shifts`. Shift-Sync UPDATE verlangt `payload.id`; das strikte Schema akzeptiert diese ID und die unterstützten Felder, während Mindestbesetzung und Periodenzuordnung nicht Teil des Update-Payloads sind. Die Offline-Update-Implementierung sendet daher ausschließlich `id`, Objekt, Datum/Uhrzeit, Dienstart, Qualifikation und Pause, mit `baseVersion` aus der geladenen Schicht. Finale serverseitige Validierung und Konfliktbehandlung erfolgen beim Sync.

API-Details und Berechtigungen: [SERVICE_PLANNING_API.md](./frontend/backend/SERVICE_PLANNING_API.md). Spezifikation und aktueller Status: [SERVICE_PLANNING_SPECIFICATION.md](./frontend/SERVICE_PLANNING_SPECIFICATION.md).

## Verifikation

- Frontend-Vitest: `npm --prefix frontend test` — 14 Testdateien, 72 Tests bestanden.
- Frontend-Produktionsbuild: `npm --prefix frontend run build` — erfolgreich. Vite meldet einen Chunk über 500 kB und den `__dirname`-Hinweis der Config.
- Native CI für PR #17, Lauf `43458040291` auf Head `165f87694f3a8cd61a84649810222d591955f5b4` — Root, Frontend, Backend/PostgreSQL/Migration/Jest und Production-Docker bestanden. PR #17 ist inzwischen in den Backend-Stack integriert.
- Backend-TypeScript-Build: `npm --prefix frontend/backend run build` — erfolgreich mit der im Backend-Lockfile fixierten TypeScript-Version.
- Backend-Zeit-/DST-Tests: `npm --prefix frontend/backend test -- --runInBand src/tests/planningTime.test.ts` — 4 Tests bestanden.
- PostgreSQL 16-Migrationen plus Seed auf isolierter Testdatenbank — erfolgreich; anschließend vollständige Backend-Suite `npm --prefix frontend/backend test` — 24 Suites / 237 Tests bestanden, einschließlich Migrationshistorie/Baseline, Planning API, Tenant-RLS und CSV-/Rate-Limit-Regressions. Jest meldet einen offenen TCP-Handle aus `patrol.integration.test.ts`; alle Suites und Tests bestanden.
- `npm --prefix frontend/backend run build` — erfolgreich. PR-CI-Lauf `43487094498` auf dem Implementation-Head — Root, Frontend, Backend/PostgreSQL/Migration/Jest und Production-Docker alle erfolgreich.
