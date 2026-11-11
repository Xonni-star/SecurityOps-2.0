# SecurityOps 2.0 – Systemaudit und Priorität-1-Teilintegration

**Stand:** 2026-11-11
**Code-Commit:** `25f820869ff2aa391a3ef38be2c133991f9ebd3c`
**CI-Run:** `43069412031` (alle drei Jobs erfolgreich)
**CD-Run:** `43069678435` (Release-Paket erfolgreich)

> **Ehrliche Einordnung:** Priorität 1 ist **teilweise abgeschlossen**. Die nachweisbare, getestete Integration umfasst Login, Kunden, Wachbuch (Lesen), Objekte und Mitarbeiter (Lesen). Die übrigen Fachmodule speichern weiterhin nur im Frontend-Zustand. Die vollständige Integration aller Module ist mit diesem Schritt **nicht** erreicht.

---

## 1. Systemaudit

### 1.1 Übersicht

| Bereich | DB-Tabelle(n) | Backend-Endpunkte | Frontend-Persistenz | Status |
|---|---|---|---|---|
| Authentifizierung | `users`, `user_sessions`, `roles`, `permissions` | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Login-Gate neu; Token in `localStorage` | **Teilweise** (Sitzung sicherheitstechnisch noch Priority 2) |
| Kunden | `clients` | `GET/POST /customers` | Hydration + POST neu | **Teilweise** (Anlegen/Lesen; Ändern/Löschen offen) |
| Objekte | `sites` | `GET /sites` neu | Lesen neu; Anlegen/Ändern weiter lokal | **Teilweise** |
| Mitarbeiter | `employees` | `GET /employees` neu | Lesen neu; Anlegen/Ändern weiter lokal | **Teilweise** |
| Dienstplanung | `shifts` | nur `sync/push` | `addShift`/`assignShiftEmployee` lokal | **Teilweise** |
| Wachbuch | `guardbook_entries`, `guardbook_revisions` | `GET/POST /logbook`, `POST /logbook/revisions`, `sync/push` | Lesen neu; Anlegen über bestehende Outbox/Sync; Stage/Revisionen lokal | **Teilweise** |
| Schlüssel | `keys` | nur `sync/push` | `issueKey`/`returnKey` lokal | **Teilweise** |
| Aufgaben | `tasks` | nur `sync/push` | `addTask`/`toggleTaskStatus` lokal | **Teilweise** |
| Dokumente | **keine Tabelle** | kein Endpunkt | `addDocument`/`deleteDocument` lokal | **Nicht implementiert** |
| SOPs | **keine Tabelle** | kein Endpunkt | `acknowledgeSOP` lokal | **Nicht implementiert** |
| Alarme | **keine Tabelle** | kein Endpunkt | `resolveAlarm` lokal | **Nicht implementiert** |
| Übergaben / Streifen | `shift_handovers`, `patrol_scans` | nur `sync/push` | Mobile Module lokal | **Teilweise** |
| Benutzer-/Rechteverwaltung | `users`, `roles`, `permissions` | keine Verwaltungs-API | nur Anzeige/Rollenwechsel | **Nicht implementiert** |
| Offline / IndexedDB | lokale Outbox | `sync/push`, `sync/conflicts/resolve` | vorhanden; Wachbuch nutzt sie | **Teilweise** |
| KI-Funktionen | – | kein serverseitiger Gemini-Endpunkt | `geminiService.ts` nutzt `@google/genai` direkt im Browser | **Sicherheitskritisch** |
| CI/CD | – | 7 Backend-Suiten, Frontend-Tests, 3 Jobs | – | **Funktionsfähig** |

### 1.2 Zentrale Audit-Ergebnisse

1. **Der Frontend-Store war vollständig mock-datengetrieben.** `store.ts` importierte `initialClients`, `initialSites`, `initialEmployees`, `initialShifts` usw. aus `mockData.ts`. Fast alle Modul-Aktionen änderten nur Zustand; nur `sync/push` und `sync/conflicts/resolve` riefen das Backend auf.
2. **Es gab keinen Login im Frontend.** `apiClient.setToken()` wurde nie aufgerufen; API-Aufrufe wären mit HTTP 401 gescheitert.
3. **Nur zwei Fachdomänen hatten Endpunkte:** Kunden und Wachbuch. Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben, Dokumente, SOPs, Alarme und Übergaben hatten keine Lese-/Schreib-API.
4. **Für Dokumente, SOPs und Alarme existieren keine Datenbanktabellen.** Eine echte Persistenz erfordert neue Migrationen.
5. **Der Produktions-Proxy zeigt auf das falsche Backend:** `deploy/Caddyfile` leitet `/api/*` an den Python-FastAPI-Bruchstück-Stack, nicht an das TypeScript-Backend.
6. **JWT wird im `localStorage` gespeichert.** Das ist ein bekanntes XSS-Risiko und Gegenstand von Priorität 2.
7. **Gemini wird direkt im Browser initialisiert.** Ein API-Schlüssel wäre im Client sichtbar; die serverseitige Proxy-Lösung ist nicht angebunden.
8. **Gefundener und behobener Fehler:** Zwei Logins innerhalb derselben Sekunde erzeugten identische JWTs und damit denselben `user_sessions.token_hash` → HTTP 500. Behoben durch eindeutige `jwtid`.

---

## 2. Durchgeführte Änderungen

### 2.1 Backend

| Datei | Änderung |
|---|---|
| `frontend/backend/src/controllers/resourceController.ts` | **Neu:** mandantengetrennte Leseendpunkte für `sites` und `employees` über `withTenantTransaction` (RLS) |
| `frontend/backend/src/app.ts` | Routen `GET /api/v1/sites` und `GET /api/v1/employees` |
| `frontend/backend/src/seeds/seed.ts` | Berechtigung `employees:read` ergänzt |
| `frontend/backend/src/controllers/authController.ts` | Eindeutige `jwtid` pro Login; behebt Session-Hash-Kollision |
| `frontend/backend/src/tests/api_integration.test.ts` | **Neu:** 3 Integrationstests für Persistenz, erneuten Login, Mandantentrennung und Referenzdaten |

### 2.2 Frontend

| Datei | Änderung |
|---|---|
| `frontend/services/apiClient.ts` | `patch()` und `delete()` ergänzt |
| `frontend/store.ts` | Auth-Zustand, `login`/`logout`/`restoreSession`, `loadTenantData`, Mapper für API-Zeilen, persistente Kundenanlage, robuste Hydration über `Promise.allSettled` |
| `frontend/components/LoginScreen.tsx` | **Neu:** Login-Formular mit Lade- und Fehleranzeige |
| `frontend/App.tsx` | Login-Gate, Session-Wiederherstellung, Lade-/Fehlerbanner |
| `frontend/tests/storeApiIntegration.test.ts` | **Neu:** 4 Tests für Hydration, POST-Persistenz, Fehlerpfad und Login |
| `frontend/vite.config.ts` | Dev-Proxy `/api/v1` → `http://localhost:8000` |

---

## 3. Behobene Fehler

1. **Login-Kollision:** Identische JWTs bei zwei Logins in derselben Sekunde verletzten `user_sessions_token_hash_key` (HTTP 500). Behoben durch `jwtid: crypto.randomUUID()`.
2. **Fehlende Authentifizierung im Frontend:** Login-Gate und Token-Setzung ergänzt.
3. **Mock-Persistenz bei Kunden:** `addClient` ruft jetzt `POST /customers` auf; bei Fehler wird keine lokale Scheinpersistenz erzeugt.
4. **Fehlende Referenzdaten:** Objekte und Mitarbeiter werden jetzt aus PostgreSQL geladen, statt aus Mock-Daten.
5. **Kein Dev-API-Zugriff:** `/api/v1` wird im Vite-Dev-Server an das TypeScript-Backend proxied.

---

## 4. Neue Funktionen (vollständig/teilweise)

| Funktion | Status |
|---|---|
| Login gegen das bestehende Auth-Backend | **Vollständig für den Slice** |
| Session-Wiederherstellung über `GET /auth/me` | **Vollständig für den Slice** |
| Hydration von Kunden, Objekten, Mitarbeitern, Wachbuch | **Vollständig für den Slice** |
| Persistente Kundenanlage über PostgreSQL | **Vollständig für den Slice** |
| Mandantengetrennte Leseendpunkte für Objekte/Mitarbeiter | **Vollständig für den Slice** |
| Lade-/Fehleranzeige und Benachrichtigungen | **Teilweise** (global; modulindividuelle Feinanzeige offen) |
| Persistenz für Schichten, Schlüssel, Aufgaben, Dokumente, SOPs, Alarme | **Noch offen** |

---

## 5. Durchgeführte Tests

### 5.1 Backend (Jest, echtes PostgreSQL 16)

- Bestehende Suiten: Migrationen, Parser, RLS, Rollen, Sync, CORS.
- **Neu:** `api_integration.test.ts`
  1. Kunde wird über `POST /customers` gespeichert und nach erneutem Login über `GET /customers` geladen.
  2. Benutzer aus Mandant B sieht den Kunden aus Mandant A nicht.
  3. `GET /sites` und `GET /employees` liefern mandantengetrennte Daten.

### 5.2 Frontend (Vitest)

- Bestehende Store-Konflikttests (6).
- **Neu:** `storeApiIntegration.test.ts` (4 Tests)
  1. Hydration aus den vier API-Endpunkten.
  2. `addClient` ruft `POST /customers` auf und übernimmt die Server-ID.
  3. Fehlgeschlagene Kundenanlage erzeugt keine lokale Scheinpersistenz.
  4. Login setzt Token und lädt Mandantendaten.

### 5.3 Builds

- Frontend: `vite build` erfolgreich.
- Backend: `tsc` erfolgreich.

---

## 6. Testergebnisse

| Prüfung | Ergebnis |
|---|---|
| Backend-Gesamtsuite | ✅ **118/118 Tests, 7/7 Suiten** |
| Frontend-Gesamtsuite | ✅ **10/10 Tests, 2/2 Dateien** |
| Backend-Build (`tsc`) | ✅ Exit 0 |
| Frontend-Build (`vite build`) | ✅ Exit 0 |
| GitHub-CI `43069412031` | ✅ Root, Frontend, Backend erfolgreich |
| GitHub-CD `43069678435` | ✅ Release-Paket erfolgreich |
| CI-Artefakte | `frontend-dist` 340.061 B, `backend-dist` 63.238 B, Release 403.906 B |

---

## 7. Verbleibende Probleme

### 7.1 Nicht integrierte Fachmodule

- Objekte: Anlegen/Ändern/Löschen weiter nur lokal.
- Mitarbeiter: Anlegen/Ändern weiter nur lokal.
- Schichten: Anlegen/Zuweisen nur lokal (kein Lese-Endpunkt).
- Schlüssel: Ausgabe/Rückgabe nur lokal.
- Aufgaben: Anlegen/Statuswechsel nur lokal.
- Dokumente, SOPs, Alarme: **keine Tabellen, keine Endpunkte**.
- Übergaben/Streifenkontrollen: nur lokale Mobile-Module.
- Benutzer-/Rechteverwaltung: keine API.

### 7.2 Daten- und Sicherheitsprobleme

- `documents`, `sops`, `alarms`, `emergency_plans` fehlen im Schema.
- JWT weiterhin in `localStorage` (Priorität 2).
- Gemini-Integration im Browser statt serverseitig (Priorität 6).
- Caddy-Produktionsproxy zeigt `/api/*` auf den FastAPI-Stack statt auf das TS-Backend.
- `employees:read` muss in bestehenden Datenbanken durch erneutes Seed-Laufen ergänzt werden.
- Offline-Hydration nach Wiederverbindung ist noch nicht vollständig an die neuen Leseendpunkte gekoppelt.
- Weitere Module zeigen weiterhin Mock-Daten; das ist **nicht produktionsreif**.

---

## 8. Nächster konkreter Entwicklungsschritt

**Priorität 1 fortsetzen – ohne Priorität 2 zu beginnen:**

1. Tenant-scoped CRUD-Endpunkte für `sites`, `employees`, `shifts`, `keys`, `tasks` (List/Create/Update; Löschen nur wo fachlich zulässig).
2. Frontend-Aktionen dieser Module auf die API umstellen; Mock-Daten entfernen.
3. Neue Migrationen für `managed_documents`, `instructions`/`acknowledgements`, `alarm_plans` und die zugehörigen Endpunkte.
4. Offline-Outbox für alle schreibenden Module erweitern; nach Reconnect API-Hydration auslösen.
5. E2E-Test: Login → Moduländerung → Logout → Login → Daten aus PostgreSQL sichtbar.

**Nicht begonnen:** Priorität 2 (Auth-Härtung/Cookies), Priorität 3 (weitere RLS-Härtung), Priorität 4–7.

---

## 9. Git-Commit

- **`25f820869ff2aa391a3ef38be2c133991f9ebd3c`** – `feat: add authenticated PostgreSQL hydration for core modules`
- Vorheriger Stand: `15b72d5b508bf302763343a04d43d60c4631dad3`

**Status dieses Schritts:** **teilweise abgeschlossen** – der getestete Integrations-Slice ist umgesetzt und gesichert; die vollständige Integration aller Fachmodule ist noch offen.

---

# 10. Nachtrag: Zweite Integrationstranche (2026-11-11)

**Code-Commit:** `7a43fd44efbdf7ba8d60a12e4732361d59a37b5c`
**CI-Run:** `43071045069` – Root, Frontend und Backend erfolgreich
**CD-Run:** `43071309357` – Release-Paket erfolgreich
**Artefakte:** `frontend-dist` 340.462 B, `backend-dist` 65.460 B, Release 406.529 B

## 10.1 Neu implementiert

### Backend
- `POST /api/v1/sites` und `PATCH /api/v1/sites/:id` (Zod-Validierung, RLS, `sites:create`).
- `POST /api/v1/employees` und `PATCH /api/v1/employees/:id` (Zod-Validierung, RLS, `employees:manage`).
- Einheitliches Validierungsfehlerformat: Zod-Fehler liefern HTTP 400 statt 500.
- Neue Berechtigung `employees:manage` im Seed.

### Frontend
- `addSite` persistiert über `POST /sites`.
- `addEmployee` persistiert über `POST /employees`.
- `updateEmployee` persistiert über `PATCH /employees/:id`.
- Fehlerpfade erzeugen keine lokale Scheinpersistenz, sondern eine Alert-Benachrichtigung.

### Tests
- Backend: **120/120 Tests, 7/7 Suiten**; neu: Objekt-/Mitarbeiteranlage, erneuter Login, Aktualisierung, Mandantentrennung.
- Frontend: **12/12 Tests, 2/2 Dateien**; neu: `addSite`, `addEmployee`, `updateEmployee`.

## 10.2 Aktualisierter Status

| Bereich | Status |
|---|---|
| Kunden | Anlegen/Lesen persistiert; Ändern/Löschen offen |
| Objekte | **Anlegen/Lesen/Ändern persistiert**; Archivieren/Löschen offen |
| Mitarbeiter | **Anlegen/Lesen/Ändern persistiert**; Deaktivieren/Qualifikationen offen |
| Schichten | weiterhin nur lokaler Zustand |
| Wachbuch | Lesen persistiert; Schreiben über Outbox/Sync; Revisionen/Stage lokal |
| Schlüssel | weiterhin nur lokaler Zustand |
| Aufgaben | weiterhin nur lokaler Zustand |
| Dokumente/SOPs/Alarme | keine Tabellen/Endpunkte |
| Übergaben/Streifen | lokal |
| Benutzer/Rechte | keine Verwaltungs-API |

## 10.3 Verbleibende Arbeiten

1. CRUD für Schichten, Schlüssel und Aufgaben (Tabellen vorhanden).
2. Migrationen und Endpunkte für Dokumente, SOPs, Alarme und Notfallpläne.
3. Offline-Outbox auf alle schreibenden Module ausweiten; Reconnect-Hydration.
4. Revisionssichere Wachbuchkorrekturen und PDF-Export.
5. Rollen-/Benutzerverwaltung und serverseitige Berechtigungstests für alle Module.
6. Auth-Härtung (HttpOnly-Cookies, CSRF, Rate-Limiting).
7. Serverseitige KI-Schnittstelle statt Browser-API-Key.
8. Produktions-Proxy (Caddy) auf das TypeScript-Backend umstellen.
9. E2E-Tests A–H und vollständige CI-Erweiterung (Linting, Security-Scan).
10. Dokumentation der tatsächlich implementierten Funktionen.

## 10.4 Vorläufige Bewertung (nicht final)

| Kriterium | Note |
|---|---|
| Architektur | 6/10 |
| Funktionalität | 4/10 |
| Datenbank | 6/10 |
| Mandantenfähigkeit | 7/10 |
| Sicherheit | 5/10 |
| Offlinefähigkeit | 5/10 |
| Benutzerfreundlichkeit | 6/10 |
| Testabdeckung | 6/10 |
| Produktionsreife | 3/10 |

**Gesamtstatus:** Die Integration ist über Kunden, Objekte, Mitarbeiter und Wachbuch (Lesen) hinausgewachsen, aber **weiterhin nicht vollständig**. Das Projekt ist noch kein produktionsreifes System im Sinne der Abnahmekriterien.

---

# 11. Nachtrag: Dritte Integrationstranche (2026-11-11)

**Code-Commit:** `131773608f371c8b6e26d9d10365acb71c67a579`
**CI-Run:** `43072597716` – Root, Frontend und Backend erfolgreich
**CD-Run:** `43072866276` – Release-Paket erfolgreich
**Artefakte:** `frontend-dist` 341.253 B, `backend-dist` 68.082 B, Release 409.941 B

## 11.1 Neu implementiert

### Backend
- Vollständige CRUD-Endpunkte für **Schichten**:
  - `GET/POST /api/v1/shifts`, `PATCH/DELETE /api/v1/shifts/:id`
  - Berechtigungen `shifts:read` / `shifts:manage`
- Vollständige CRUD-Endpunkte für **Schlüssel**:
  - `GET/POST /api/v1/keys`, `PATCH/DELETE /api/v1/keys/:id`
  - Berechtigungen `keys:read` / `keys:manage`
- Vollständige CRUD-Endpunkte für **Aufgaben**:
  - `GET/POST /api/v1/tasks`, `PATCH/DELETE /api/v1/tasks/:id`
  - Berechtigungen `tasks:read` / `tasks:manage`
- Alle Schreiboperationen laufen mandantengetrennt über `withTenantTransaction` und RLS.
- Versionsfeld `revision_version` wird bei Schicht-/Schlüssel-/Aufgabenänderungen erhöht.

### Frontend
- Hydration aus PostgreSQL für Schichten, Schlüssel und Aufgaben.
- Neue Mapper für `shifts`, `keys`, `tasks`.
- Persistente Aktionen:
  - `addShift` → `POST /shifts`
  - `assignShiftEmployee` → `PATCH /shifts/:id`
  - `issueKey` / `returnKey` → `PATCH /keys/:id`
  - `addTask` → `POST /tasks`
  - `toggleTaskStatus` → `PATCH /tasks/:id`
- Lade-/Fehlerbehandlung über `Promise.allSettled`; Teilausfälle werden sichtbar gemeldet.

### Tests
- Backend: **122/122 Tests, 7/7 Suiten**.
  - Neu: Schicht, Schlüssel und Aufgabe anlegen, nach erneutem Login laden, aktualisieren.
  - Neu: Mandant B sieht diese Datensätze nicht.
- Frontend: **14/14 Tests, 2/2 Dateien**.
  - Neu: `addShift`, `assignShiftEmployee`, `addTask`, `toggleTaskStatus`, `issueKey`, `returnKey`.

## 11.2 Aktualisierter Status

| Bereich | Status |
|---|---|
| Kunden | Anlegen/Lesen persistiert; Ändern/Löschen offen |
| Objekte | Anlegen/Lesen/Ändern persistiert; Archivieren/Löschen offen |
| Mitarbeiter | Anlegen/Lesen/Ändern persistiert; Deaktivieren/Qualifikationen offen |
| Schichten | **Anlegen/Lesen/Ändern/Löschen persistiert** |
| Wachbuch | Lesen persistiert; Schreiben über Outbox/Sync; Revisionen/Stage teilweise lokal |
| Schlüssel | **Anlegen/Lesen/Ändern/Löschen persistiert** |
| Aufgaben | **Anlegen/Lesen/Ändern/Löschen persistiert** |
| Dokumente/SOPs/Alarme | **keine Tabellen/Endpunkte** |
| Übergaben/Streifen | lokal |
| Benutzer/Rechte | keine Verwaltungs-API |
| Offline-Sync | Outbox teilweise; nicht alle Module angebunden |
| KI | weiterhin Browser-seitig; nicht serverseitig abgesichert |
| Produktionsproxy | Caddy zeigt weiterhin auf den FastAPI-Stack |

## 11.3 Verbleibende Arbeiten

1. Migrationen und CRUD für Dokumente, SOPs, Alarme und Notfallpläne.
2. Übergaben und Streifenkontrollen an API/DB anbinden.
3. Offline-Outbox für Schichten, Schlüssel, Aufgaben und Stammdaten erweitern.
4. Reconnect-Hydration und Konfliktauflösung für alle Module.
5. Wachbuch-Revisionen/Stage serverseitig abschließen; PDF/CSV-Export.
6. Benutzer-/Rechteverwaltung und serverseitige Berechtigungstests.
7. Auth-Härtung: HttpOnly-Cookies, CSRF, Login-Rate-Limit.
8. Serverseitige Gemini-Integration; API-Key aus dem Browser entfernen.
9. Caddy/Deployment auf das TypeScript-Backend korrigieren.
10. E2E-Tests A–H, Linting und Security-Scan.

## 11.4 Vorläufige Bewertung (nicht final)

| Kriterium | Note |
|---|---|
| Architektur | 6/10 |
| Funktionalität | 5/10 |
| Datenbank | 7/10 |
| Mandantenfähigkeit | 7/10 |
| Sicherheit | 5/10 |
| Offlinefähigkeit | 5/10 |
| Benutzerfreundlichkeit | 6/10 |
| Testabdeckung | 7/10 |
| Produktionsreife | 4/10 |

**Gesamtstatus:** Die Kernmodule Kunden, Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben und Wachbuch (Lesen) sind jetzt API-/PostgreSQL-gestützt. **Dokumente, SOPs, Alarme, Übergaben, Streifenkontrollen, Offline-Vollabdeckung, Auth-Härtung, KI-Serverseite und Deployment sind weiterhin offen.** Das Projekt ist **nicht vollständig produktionsreif**.
