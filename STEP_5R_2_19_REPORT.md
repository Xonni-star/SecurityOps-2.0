# SecurityOps 2.0 – Schritt 5R.2.19
> **Historischer Snapshot:** Dieser frühere Bericht referenziert ein separates Root-Proxy-Backend. Dieses wurde in Schritt 5R.3.4 vollständig aus dem Repository entfernt.

## Abhängigkeiten reproduzierbar festschreiben

**Ausgangsstand:** `main` @ `eccbb3e`
**Durchgeführt am:** 2026-11-11
**Commit:** `build: pin dependencies for reproducible builds`

---

## 1. Ziel und Ergebnis

Alle direkten Projektabhängigkeiten mit der Angabe `latest` wurden durch die **tatsächlich aufgelösten Versionen** aus den vorhandenen Lockfiles ersetzt. Es wurden keine Versionsupdates durchgeführt: Die eingetragenen Versionen entsprechen exakt dem Stand, der zuvor in den Lockfiles installiert war.

`latest` kommt in keiner `package.json` des Repositories mehr vor.

---

## 2. Geänderte Abhängigkeiten

### 2.1 `frontend/package.json`

| Abhängigkeit | Vorher | Nachher | Aufgelöste Version aus Lockfile |
|---|---|---|---|
| `@google/genai` | `latest` | `3.1.0` | 3.1.0 |
| `lucide-react` | `latest` | `1.72.0` | 1.72.0 |
| `react` | `latest` | `19.3.1` | 19.3.1 |
| `react-dom` | `latest` | `19.3.1` | 19.3.1 |
| `recharts` | `latest` | `3.10.1` | 3.10.1 |
| `zustand` | `latest` | `5.1.0` | 5.1.0 |
| `@types/node` (dev) | `latest` | `26.6.6` | 26.6.6 |
| `@vitejs/plugin-react` (dev) | `latest` | `6.3.0` | 6.3.0 |
| `typescript` (dev) | `latest` | `7.0.2` | 7.0.2 |
| `vite` (dev) | `latest` | `8.3.8` | 8.3.8 |

Unverändert (waren bereits festgelegt): `jsdom` `^31.0.0` (installiert 31.0.0), `vitest` `^5.1.0` (installiert 5.1.0).

### 2.2 `package.json` (Root)

| Abhängigkeit | Vorher | Nachher | Ermittlung |
|---|---|---|---|
| `concurrently` (dev) | `latest` | `10.0.7` | Kein Root-Lockfile vorhanden; `npm view concurrently version` → 10.0.7, anschließend per npm installiert und im neuen Root-Lockfile fixiert |

### 2.3 `frontend/backend/package.json`

Keine `latest`-Angaben vorhanden. Alle direkten Abhängigkeiten waren bereits mit Caret-Ranges festgelegt (z. B. `express ^4.19.2`, `pg ^8.11.5`). **Keine Änderung vorgenommen** – die Auflösung erfolgt über `package-lock.json`.

### 2.4 `backend/package.json` (Google-Cloud-Proxy, Root)

Keine `latest`-Angaben vorhanden. Keine Änderung.

---

## 3. Node- und npm-Version

| Umgebung | Node.js | npm |
|---|---|---|
| Lokal (Verifikation) | v26.7.0 | 11.19.0 |
| GitHub Actions (CI) | v24.22.2 | 11.19.1 |

Die Engine-Anforderungen bleiben unverändert: `"node": ">=24.15.0"` in Root, Frontend und TypeScript-Backend. Alle installierten Versionen sind mit Node.js 24 kompatibel (Vitest 5.1.0: `^24.0.0`, jsdom 31.0.0: `^24.15.0`, Vite 8.3.8: `>=22.12.0`).

---

## 4. Lockfiles

| Lockfile | Status | Inhaltliche Änderung |
|---|---|---|
| `frontend/package-lock.json` | aktualisiert | Nur die `spec`-Felder der Direktabhängigkeiten (`latest` → konkrete Version) und der `engines`-Block; **keine** geänderten Paketversionen oder Integrity-Hashes |
| `package-lock.json` (Root) | **neu erzeugt** | `concurrently@10.0.7` inkl. transitiver Abhängigkeiten; per npm erzeugt, nicht manuell bearbeitet |
| `frontend/backend/package-lock.json` | unverändert | Keine `latest`-Angaben, `npm ci` erfolgreich |

Es wurden keine Lockfiles manuell editiert und keine Integrity-Hashes erfunden.

---

## 5. Zusätzlich notwendige Root-Korrektur

Der Root-Befehl `npm run dev-backend` zeigte auf `--prefix backend` – also auf das **Google-Cloud-Proxy-Verzeichnis**, nicht auf das SecurityOps-Backend. Dieses Verzeichnis besitzt kein installiertes `nodemon` und ist laut `frontend/README.md` ausdrücklich nicht das Anwendungsbackend. Der Befehl endete mit `sh: 1: nodemon: not found` (Exit 127).

Korrektur: `dev-backend` zeigt jetzt auf `frontend/backend`. Die Root-Skripte bleiben ansonsten unverändert. Zusätzlich wurde `node_modules/` in die Root-`.gitignore` aufgenommen, damit das für die Root-Prüfung installierte `node_modules` nicht im Repository landet.

---

## 6. Tatsächlich ausgeführte Befehle und Ergebnisse

### 6.1 Frontend

```bash
cd frontend
npm ci
npm test
npm run build
```

| Befehl | Ergebnis |
|---|---|
| `npm ci` | ✅ 151 Pakete, Exit 0 |
| `npm test` | ✅ 1 Testdatei, **6/6 Tests bestanden** (1,80 s) |
| `npm run build` | ✅ 2498 Module, `dist` erzeugt, Exit 0 |

### 6.2 TypeScript-Backend (PostgreSQL 16.15 lokal, Docker, Port 55432)

```bash
cd frontend/backend
npm ci
npm run build
npm run migrate
npm run seed
npm test -- --runInBand
```

| Befehl | Ergebnis |
|---|---|
| `npm ci` | ✅ 441 Pakete, Exit 0; `argon2.hash()` funktionsfähig |
| `npm run build` | ✅ Exit 0 |
| `npm run migrate` | ✅ Migrationen 001–004 erfolgreich |
| `npm run seed` | ✅ `[SEED SUCCESS]` |
| `npm test -- --runInBand` | ✅ **4/4 Suites, 36/36 Tests bestanden** |

### 6.3 Root-Projekt

```bash
npm ci
npx concurrently --version
npm run dev        # mit Test-Umgebungsvariablen, PORT=8010
```

| Prüfung | Ergebnis |
|---|---|
| `npm ci` (Root) | ✅ 20 Pakete, Exit 0 |
| `concurrently --version` | ✅ `10.0.7` |
| `npm run dev` | ✅ Frontend: `VITE v8.3.8 ready`, `http://localhost:5174/`; Backend: `[SECURITYOPS 2.0 BACKEND] Gestartet auf Port 8010`; Prozess nach 22 s kontrolliert per Timeout beendet (Exit 124 erwartet) |

Hinweis: Port 8000 war lokal bereits durch einen fremden Prozess belegt (`EADDRINUSE`). Für den Startnachweis wurde `PORT=8010` gesetzt. Das ist eine lokale Umgebungsbelegung, kein Fehler der Skripte.

---

## 7. Warnungen

| Warnung | Bewertung |
|---|---|
| `npm warn deprecated node-domexception@1.0.0` | Transitive Abhängigkeit; kein Handlungsbedarf in diesem Schritt |
| `npm warn install-scripts argon2@0.40.3 (node-gyp-build)` | npm 11 weist auf Install-Skripte hin; Prebuilt-Binary funktioniert, `argon2.hash()` geprüft |
| Vite: Chunk > 500 kB | Bestehende Empfehlung zu Code-Splitting, kein Fehler |
| Vite: `__dirname` im nativen Config-Loader | Bestehende Warnung, kein Fehler |
| Frontend-Dev nutzte Port 5174 | Port 5173 lokal belegt, Vite weicht automatisch aus |

---

## 8. Verbleibende Risiken

1. **Caret-Ranges im Backend:** `frontend/backend/package.json` verwendet weiterhin `^`-Ranges. `npm ci` ist durch das Lockfile reproduzierbar; ein `npm install` würde jedoch innerhalb der Ranges aktualisieren. Eine vollständige Umstellung auf exakte Versionen war nicht Teil der Aufgabe (keine unnötigen Änderungen).
2. **Root-Backend-Verzeichnis:** Das Verzeichnis `backend/` (Google-Cloud-Proxy) bleibt bestehen. Es ist kein SecurityOps-Backend und wird von den Root-Dev-Skripten nicht mehr verwendet.
3. **Dev-Start benötigt Umgebungsvariablen:** Das TypeScript-Backend bricht ohne gültige `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `JWT_SECRET` und `CORS_ORIGIN` bewusst ab (Fail-Fast-Konfiguration). Das ist beabsichtigt.
4. **Port-Konflikte:** Lokal belegte Standardports (8000, 5173) führen zu Ausweichports bzw. Startabbruch; in CI nicht relevant.

---

## 9. Abgrenzung

- Keine neuen Funktionen, keine Fachmodule geändert.
- Keine Datenbankmigrationen verändert.
- Keine Änderungen an Mandantenfähigkeit, Offline-Synchronisation oder Berechtigungen.
- Keine API-Verträge geändert.
- Keine Sicherheitsprüfungen übersprungen.
- Keine Testergebnisse erfunden; alle Angaben stammen aus den oben ausgeführten Befehlen.
- Die bestehende CI/CD-Pipeline bleibt unverändert und wird durch den Push erneut ausgelöst.
