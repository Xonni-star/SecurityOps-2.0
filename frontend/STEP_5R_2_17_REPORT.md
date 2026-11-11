# SecurityOps 2.0 – Schritt 5R.2.17
> **Historischer Snapshot:** Dieser frühere Bericht referenziert ein separates Root-Proxy-Backend. Dieses wurde in Schritt 5R.3.4 vollständig aus dem Repository entfernt.

## Vitest-Testumgebung endgültig im richtigen Frontend einrichten

**Ausgangsstand:** `main` @ `eeb95bd` („chore: update project files from latest export (2.1, build 19)")
**Durchgeführt am:** 2026-11-11
**Umgebung:** Node v26.7.0, npm 11.19.0, Linux x64

---

## 1. Geänderte Dateien

| Datei | Änderung |
|---|---|
| `frontend/package.json` | npm-Skripte `test` (`vitest run`) und `test:watch` (`vitest`) ergänzt; `vitest` + `jsdom` als devDependencies |
| `frontend/package-lock.json` | Neu erzeugt durch echte npm-Installation (kein handgeschriebener Inhalt) |
| `frontend/vite.config.ts` | Vitest-Konfiguration integriert (`environment: jsdom`, Include `tests/**/*.test.ts(x)`, Exclude `node_modules`/`dist`); React-Plugin, Alias `@` und Server-Proxies unverändert erhalten |
| `package.json` (Repo-Root) | Feld `workspaces: ["frontend", "backend"]` entfernt (Begründung siehe Abschnitt 2) |
| `frontend/frontend/` | Vollständig entfernt (7 Dateien, siehe Abschnitt 5) |
| `frontend/STEP_5R_2_17_REPORT.md` | Dieser Bericht |

Nicht angefasst: Synchronisationslogik, Datenbank/Migrationen, Offline-Sync, Rollen/Berechtigungen, Mandantenarchitektur, Google-Cloud-Proxy, CI/CD-Workflows.

---

## 2. Notwendige Root-Korrektur (Workspaces)

Die reine Frontend-Installation war zunächst nicht möglich: Das Root-`package.json` deklarierte `workspaces: ["frontend", "backend"]`. Dadurch behandelte npm bei **jedem** Aufruf innerhalb von `frontend/` das Repo-Root als Projektwurzel und suchte dort ein Lockfile. Folge:

```
npm error code EUSAGE
npm error The `npm ci` command can only install with an existing package-lock.json ...
```

Ein lokales `frontend/.npmrc` mit `workspaces=false` wurde von npm ignoriert („npm warn config ignoring workspace config at .../frontend/.npmrc"). Ohne Entfernen der Workspace-Deklaration ist die Abschlussbedingung „`npm ci` im Verzeichnis `frontend/` erfolgreich" technisch nicht erfüllbar.

Die Workspace-Deklaration war ohnehin inkonsistent: Sie verwies mit `backend` auf den fremden Google-Cloud-Proxy, nicht auf das SecurityOps-Backend (`frontend/backend`). Die Root-Skripte (`dev-frontend`, `dev-backend`, `dev`) funktionieren unverändert über `--prefix`. `private: true` wurde ergänzt, damit das Root-Paket nicht versehentlich publiziert wird.

---

## 3. Installierte Paketversionen

```
frontend/package.json (Auszug):
  devDependencies:
    vitest   ^5.1.0   (installiert: 5.1.0)
    jsdom    ^31.0.0  (installiert: 31.0.0)
    vite     latest   (installiert: 8.3.8)
```

`npm ls vitest jsdom vite --depth=0` (im Verzeichnis `frontend/`):

```
securityops-2-1-sicherheitsdienstverwaltung-frontend@0.0.0 .../frontend
├── jsdom@31.0.0
├── vite@8.3.8
└── vitest@5.1.0
```

Vitest 5.1.0 ist mit der vorhandenen Vite-Version 8.3.8 kompatibel (Installation ohne Peer-Dependency-Fehler).

---

## 4. Tatsächlich ausgeführte Befehle und Ergebnisse

Alle folgenden Befehle wurden real ausgeführt, nicht nur vorbereitet.

### 4.1 `npm ci` (im Verzeichnis `frontend/`)

```bash
cd frontend
npm ci --no-audit --no-fund
```

**Ergebnis:** erfolgreich, `added 151 packages in 9s`, Exit-Code 0.

### 4.2 `npm test` (im Verzeichnis `frontend/`)

```bash
cd frontend
npm test        # -> vitest run
```

**Ergebnis:**

```
✓ tests/store_conflict_contract.test.ts (6 tests) 48ms

Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  2.06s
```

Alle sechs Store-Vertragstests wurden tatsächlich ausgeführt und bestanden:

1. Gültige Konfliktantwort (`applied: true`, `serverState`) → Outbox-Eintrag entfernt, Store aktualisiert — **bestanden**
2. Fehlende Serverantwort (`null`) → Outbox bleibt, `Ungültige Serverantwort` — **bestanden**
3. `applied: false` → Outbox bleibt, Fehler — **bestanden**
4. Fehlender `serverState` (`null`) → Outbox bleibt, Fehler — **bestanden**
5. Netzwerkfehler → Outbox bleibt, Fehler wird weitergereicht — **bestanden**
6. HTTP 409 Conflict (`ApiError`) → Outbox bleibt, Fehler wird weitergereicht — **bestanden**

Die Tests mocken `apiClient.post()` mit dem bereits entpackten `data`-Objekt, entsprechend dem tatsächlichen API-Vertrag. Die `stderr`-Ausgaben (`[CONFLICT RESOLUTION FAILED]`) sind erwartete Logs der Fehlerpfade, keine Testfehler.

### 4.3 `npm run build` (im Verzeichnis `frontend/`)

```bash
cd frontend
npm run build   # -> vite build
```

**Ergebnis:** erfolgreich.

```
✓ 2498 modules transformed.
dist/index.html                    1.48 kB │ gzip:   0.69 kB
dist/assets/index-BOTr3G_8.js  1,370.93 kB │ gzip: 337.98 kB
✓ built in 1.31s
```

Hinweis: Vite meldet lediglich eine Chunk-Größen-Warnung (> 500 kB) und die native-Config-Loader-Warnung zu `__dirname`. Beides sind Warnungen, keine Build-Fehler.

### 4.4 Backend-Prüfung (separat, nur diagnostisch)

```bash
npm --prefix frontend/backend ci
# -> EUSAGE: kein frontend/backend/package-lock.json vorhanden (Bestand, nicht Teil dieses Auftrags)

npm --prefix frontend/backend run build
# -> tsc: 1 Fehler
# src/controllers/authController.ts(153,23): error TS2769
#   jwt.sign(..., { expiresIn: ... }) – Typkonflikt mit @types/jsonwebtoken v9
```

**Bewertung:** Beide Befunde sind vorbestehend und liegen außerhalb des Auftrags (Backend/CI). Es wurden keine Backend-Dateien geändert. `npm ci` für das Backend ist erst möglich, wenn dort ein Lockfile erzeugt wird; der Build-Fehler muss separat behoben werden.

---

## 5. Bereinigung der Doppelstruktur `frontend/frontend/`

Vollständiger Inhalt vor dem Entfernen:

```
frontend/frontend/package.json
frontend/frontend/package-lock.json
frontend/frontend/vite.config.ts
frontend/frontend/STEP_5R_2_12_REPORT.md
frontend/frontend/STEP_5R_2_13_REPORT.md
frontend/frontend/STEP_5R_2_15_REPORT.md
frontend/frontend/tests/store_conflict_contract.test.ts
```

Prüfung und Übernahme:

- `tests/store_conflict_contract.test.ts`: inhaltlich identisch zum bereits vorhandenen `frontend/tests/store_conflict_contract.test.ts` (nur Kommentarzeilen unterschieden sich). Die echte Datei unter `frontend/tests/` bleibt erhalten; keine Übernahme nötig.
- `package.json` / `vite.config.ts`: veraltete Parallelkonfiguration (React 18, Vite 5, Vitest 1). Nicht übernommen, da die echte `frontend/`-Konfiguration bereits aktueller ist.
- `package-lock.json`: künstlich wirkendes Mini-Lockfile (1,5 kB), nicht übernommen.
- `STEP_5R_2_12_REPORT.md`: existiert bereits unter `frontend/`; nicht übernommen.
- `STEP_5R_2_13_REPORT.md` / `STEP_5R_2_15_REPORT.md`: nur in der Doppelstruktur vorhanden, für diesen Auftrag nicht benötigt (weiterhin über die Git-Historie abrufbar).

Anschließend wurde `frontend/frontend/` vollständig gelöscht (7 Dateien). Es existiert nur noch eine Frontend-Konfiguration unter `frontend/`.

---

## 6. Verbleibende Fehler / offene Punkte

1. **Backend-Build rot:** `authController.ts:153` (`jwt.sign` / `expiresIn`-Typisierung) – vorbestehend, außerhalb dieses Auftrags.
2. **Kein Backend-Lockfile:** `frontend/backend/package-lock.json` fehlt, daher schlägt `npm ci` dort fehl – vorbestehend, außerhalb dieses Auftrags.
3. **CI/CD:** Workflows liegen weiterhin unter `frontend/.github/workflows/` und werden von GitHub nicht ausgeführt (müssen nach `/.github/workflows/`). Nicht Teil dieses Auftrags.
4. **Chunk-Größe:** Build-Bundle 1,37 MB – Warnung, kein Fehler; Code-Splitting wäre eine spätere Optimierung.

---

## 7. Abgrenzung: ausgeführte vs. vorbereitete Tests

- **Tatsächlich ausgeführt:** 6 von 6 Frontend-Store-Vertragstests (`npm test`), Frontend-Produktionsbuild (`npm run build`), `npm ci`.
- **Nur vorbereitet / nicht ausgeführt:** keine.
- **Nicht im Scope und daher nicht ausgeführt:** Backend-Jest-Suite (`npm --prefix frontend/backend test`), da sie eine PostgreSQL-Instanz und ein funktionierendes Backend-Lockfile voraussetzt.

---

**Abschlussstatus:** Vitest ist im tatsächlichen Verzeichnis `frontend/` installiert; `npm ci`, `npm test` und `npm run build` wurden real ausgeführt und sind erfolgreich. Die Doppelstruktur ist entfernt.
