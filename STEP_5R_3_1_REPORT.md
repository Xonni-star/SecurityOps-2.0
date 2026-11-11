# SecurityOps 2.0 – Entwicklungsschritt 5R.3.1
## CORS-Konfiguration für alle vorhandenen API-Methoden korrigieren und testen

**Durchgeführt am:** 2026-11-11
**Code-Commit:** `7a1e860` – `fix: allow PATCH requests in CORS preflight`
**Merge-Commit (Remote-README integriert):** `3e3e31c`
**GitHub CI:** `43075445680` – Root, Frontend, Backend erfolgreich
**GitHub CD:** `43075684622` – Release-Paket erfolgreich

---

## 1. Ursache des Fehlers

In `frontend/backend/src/app.ts` war die CORS-Methodenliste unvollständig:

```ts
methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
```

Das Backend registriert jedoch bereits PATCH-Endpunkte für:

- Objekte (`PATCH /api/v1/sites/:id`)
- Mitarbeiter (`PATCH /api/v1/employees/:id`)
- Schichten (`PATCH /api/v1/shifts/:id`)
- Schlüssel (`PATCH /api/v1/keys/:id`)
- Aufgaben (`PATCH /api/v1/tasks/:id`)

Browser senden für diese Aufrufe einen OPTIONS-Preflight mit
`Access-Control-Request-Method: PATCH`. Da PATCH nicht in
`Access-Control-Allow-Methods` stand, hätte der Browser den eigentlichen
PATCH-Request blockiert. Gleichzeitig war `PUT` freigegeben, obwohl keine
PUT-Route existiert.

---

## 2. Geänderte Dateien

| Datei | Änderung |
|---|---|
| `frontend/backend/src/app.ts` | CORS-Methodenliste korrigiert; PATCH ergänzt, ungenutztes PUT entfernt |
| `frontend/backend/src/tests/cors.test.ts` | Zehn echte HTTP-Preflight- und Header-Tests |

Die Origin-Whitelist (`env.ALLOWED_CORS_ORIGINS`), `credentials: true`,
`helmet()` und alle bestehenden Sicherheitsheader blieben unverändert.

---

## 3. Korrigierte CORS-Methoden

```ts
methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
```

Abgleich mit den tatsächlich registrierten Routen:

| Methode | Verwendung |
|---|---|
| GET | Health, Auth/me, Kunden, Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben, Wachbuch |
| POST | Login, Logout, Kunden, Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben, Wachbuch, Sync |
| PATCH | Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben |
| DELETE | Schichten, Schlüssel, Aufgaben |
| OPTIONS | CORS-Preflight |

`PUT` wird von keiner Route verwendet und wurde daher aus der Freigabe entfernt.

---

## 4. Neue Preflight-Tests

`frontend/backend/src/tests/cors.test.ts` enthält jetzt zehn Tests, die echte
HTTP-Anfragen über `supertest` ausführen – keine reine Konfigurationsprüfung:

1. Erlaubte Origin erhält `Access-Control-Allow-Origin`.
2. Unerlaubte Origin wird abgewiesen.
3. Anfrage ohne Origin wird zugelassen.
4. OPTIONS-Preflight für **PATCH**.
5. OPTIONS-Preflight für **POST**.
6. OPTIONS-Preflight für **DELETE**.
7. `Access-Control-Allow-Methods` entspricht den registrierten Methoden
   (PATCH enthalten, PUT nicht enthalten).
8. `Access-Control-Allow-Headers` enthält `authorization`, `content-type`
   und `x-requested-with`.
9. Credentials-Verhalten: `Access-Control-Allow-Credentials: true`,
   `Allow-Origin` ist die konkrete Origin und nicht `*`.
10. Preflight einer nicht erlaubten Origin wird abgewiesen
    (kein `Allow-Origin`, HTTP 500 mit CORS-Fehlermeldung).

Die Tests simulieren die Preflight-Header
`Origin`, `Access-Control-Request-Method` und
`Access-Control-Request-Headers` real.

---

## 5. Tatsächliche Testergebnisse

### CORS-Suite

```
Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
```

### Backend-Gesamtsuite

```
Test Suites: 7 passed, 7 total
Tests:       129 passed, 129 total
```

Enthalten: Migrationen, Parser, RLS, Rollen, Sync, API-CRUD, CORS.

### Frontend

```
Test Files: 2 passed (2)
Tests:      14 passed (14)
```

---

## 6. Build-Ergebnisse

| Build | Ergebnis |
|---|---|
| `npm --prefix frontend/backend run build` (`tsc`) | ✅ Exit 0 |
| `npm run build` im Frontend (`vite build`) | ✅ Exit 0 |

Hinweis: Vite meldet weiterhin die bekannte Chunk-Größen-Warnung
(> 500 kB) und die `__dirname`-Warnung des nativen Config-Loaders.
Beides sind Warnungen, keine Build-Fehler.

---

## 7. GitHub Actions – tatsächliche Ergebnisse

| Workflow | Run-ID | Ergebnis |
|---|---|---|
| SecurityOps 2.0 CI | [`43075445680`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43075445680) | **success** (Root, Frontend, Backend) |
| SecurityOps 2.0 CD | [`43075684622`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43075684622) | **success** (Release-Paket) |

Artefakte:

| Run | Artefakt | Größe |
|---|---|---|
| CI `43075445680` | `frontend-dist` | 341.253 Bytes |
| CI `43075445680` | `backend-dist` | 68.810 Bytes |
| CD `43075684622` | `securityops-release-3e3e31c…` | 410.669 Bytes |

Alle Artefakte waren zum Prüfzeitpunkt vorhanden und nicht abgelaufen.

---

## 8. Git-Historie

- `7a1e860` – `fix: allow PATCH requests in CORS preflight` (Code-Commit)
- `47a1c33` – `docs: rewrite README for SecurityOps 2.0` (Remote-Commit)
- `3e3e31c` – Merge des Remote-README in den lokalen Branch; beide Remotes
  (GitHub und Gitea) stehen auf diesem Stand.

Der Merge war notwendig, weil GitHub zwischenzeitlich einen README-Commit
enthielt. Der CORS-Fix blieb dabei vollständig erhalten.

---

## 9. Bekannte Einschränkungen

1. `PUT` ist bewusst nicht freigegeben, da keine PUT-Route existiert.
2. Die Tests verwenden die konfigurierte Test-Origin
   `http://localhost:3000`. Produktive Origins müssen weiterhin über
   `CORS_ORIGIN` als explizite Whitelist gesetzt werden.
3. Eine nicht erlaubte Origin führt – wie bisher – über den zentralen
   Error-Handler zu HTTP 500 mit CORS-Fehlermeldung. Das Verhalten wurde
   nicht verändert.
4. Die CORS-Konfiguration betrifft nur den TypeScript-Backend-Stack.
   Der separate Produktions-Caddy-Proxy wurde in diesem Schritt nicht
   angepasst.
5. Es wurden keine weiteren Funktionen oder Module implementiert.

---

**Abschlussstatus:** PATCH-Preflight funktioniert, die Origin-Whitelist und
Credentials-Einstellung bleiben unverändert sicher, alle Tests und Builds
sind erfolgreich, und die GitHub-CI wurde tatsächlich bestätigt.
