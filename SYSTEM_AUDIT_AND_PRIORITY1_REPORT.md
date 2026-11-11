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
