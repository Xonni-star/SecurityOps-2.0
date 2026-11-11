# SecurityOps 2.0 - Abschlussbericht Schritt 5R.2.7
## Idempotenz zwischen Sync-Push und Konfliktauflösung korrigiert

### 1. Ursache des Idempotenzfehlers
In Schritt 5R.2.6 nutzten sowohl der normale `/sync/push` als auch `/sync/conflicts/resolve` dieselbe Tabelle `sync_idempotency_receipts`. Wenn ein Push für eine Aufgabe oder Schicht fehlschlug (Status: `CONFLICT`), legte der Server eine Quittung mit dem Hash des ursprünglichen Push-Payloads ab.
Wollte der Benutzer diesen Konflikt anschließend über `/sync/conflicts/resolve` mit derselben `clientUuid` lösen, fand der Konflikt-Controller den vorhandenen Push-Quittungseintrag. Da der Payload-Hash der Konfliktauflösung (`strategy`, `expectedVersion`, etc.) naturgemäß von der Push-Mutation abweicht, stufte die bisherige Logik die legitime Konfliktlösung fälschlich als `Integritätsverletzung` ein und wies sie mit HTTP 409 ab.

---

### 2. Gewählte technische Lösung & Datenbankänderungen

1. **Physische Trennung der Quittungstabellen (`003_conflict_receipts_separation.sql`)**:
   - `sync_idempotency_receipts`: Speichert ausschließlich Quittungen aus `POST /api/v1/sync/push`.
   - `sync_conflict_resolution_receipts`: Speichert dediziert Quittungen aus `POST /api/v1/sync/conflicts/resolve`.
   - Beide Tabellen sind mit `FORCE ROW LEVEL SECURITY` und strikter `PERMISSIVE`-Policy an den Mandanten gebunden.
   - Der unprivilegierte Benutzer `secops_app_user` besitzt selektive `SELECT, INSERT, UPDATE` Rechte.

2. **Transaktionssichere Idempotenz & Lock-Serialisierung**:
   - `resolveSyncConflict` verwendet einen separaten PostgreSQL Advisory Lock:
     `SELECT pg_advisory_xact_lock(hashtext($1))` mit `${tenantId}:conflict_resolve:${body.clientUuid}`.
   - Ein vorangegangener Push-Conflict blockiert die spätere Konfliktentscheidung nicht mehr.
   - Wiederholte identische Konfliktauflösungen geben exakt dieselbe Serverquittung zurück: **Kein zweiter Audit-Log, keine doppelte Wachbuch-Revision**.
   - Wiederholte Konfliktauflösungen mit manipuliertem/verändertem Inhalt bei gleicher ID werden zuverlässig mit HTTP 409 abgewiesen.
   - In `guardbook_revisions` wird die `client_mutation_id` mit dem Präfix `rev-${body.clientUuid}` gespeichert, sodass Wachbuch-Neuanlagen und Wachbuch-Korrekturen niemals denselben Primärschlüssel-Raum kollidieren lassen.

3. **Frontend-Testkonfiguration eingerichtet**:
   - `package.json` im Frontend-Root stellt das eigenständige Testskript `npm test` bereit.
   - Die 6 echten Store-Vertragstests in `tests/store_conflict_contract.test.ts` rufen reale Store-Funktionen auf und weisen nach:
     - Outbox wird erst nach gültiger Serverbestätigung (`applied: true`, vorhandener `serverState`) entfernt.
     - Bei fehlerhafter Antwort, fehlendem `data`, `applied: false` oder Netzwerkfehlern bleibt die Mutation unversehrt in der Outbox.

---

### 3. Tatsächlich ausgeführte Befehle & Testergebnisse

#### Backend (TypeScript-Backend unter `backend/`):
```bash
npm run build --prefix backend
npm run migrate --prefix backend
npm test --prefix backend
```

| Test-Suite | Befehl | Ausgeführte Einzeltests | Status |
|---|---|---|---|
| **TypeScript Build Backend** | `npm run build --prefix backend` | Kompilierung | **BESTANDEN (0 Fehler)** |
| **CORS & Whitelist Tests** | `npm test --prefix backend -- cors.test.ts` | 3 Tests | **BESTANDEN (100%)** |
| **RLS Isolation Tests** | `npm test --prefix backend -- tenant_isolation.test.ts` | 2 Tests | **BESTANDEN (100%)** |
| **Backend & Least-Privilege** | `npm test --prefix backend -- backend_phase1.test.ts` | 13 Tests | **BESTANDEN (100%)** |
| **Schritt 5R.2.7 Sync & Idempotenz** | `npm test --prefix backend -- sync_and_roles.test.ts` | 18 Tests | **BESTANDEN (100%)** |

#### Frontend (Jest JSDOM Testsuite im Root):
```bash
npm test -- store_conflict_contract.test.ts
```

| Test-Suite | Befehl | Ausgeführte Einzeltests | Status |
|---|---|---|---|
| **Frontend Store Konfliktvertrag** | `npm test -- store_conflict_contract.test.ts` | 6 Tests | **BESTANDEN (100%)** |

**Gesamtergebnis**: **36 Tests im Backend + 6 Tests im Frontend = 42 von 42 Tests erfolgreich bestanden** (100% PASS, 0 Fehler).

#### Aufschlüsselung der erweiterten Tests in `sync_and_roles.test.ts`:
- *Test 14 (Schritt 5R.2.7 Kern-Test)*: `Push-CONFLICT blockiert nicht die nachfolgende Konfliktauflösung derselben clientUuid`: **PASS**
- *Test 15*: `Wachbuch: Wiederholte Konfliktauflösung erzeugt WEDER zweite Revision NOCH zweiten Audit-Eintrag`: **PASS**
- *Test 16*: `Gleiche Konflikt-UUID mit verändertem Inhalt wird mit HTTP 409 abgewiesen`: **PASS**
- *Test 17*: `Mandantenisolation bei Konfliktauflösung: Mandant B kann keine Aufgaben von A auflösen`: **PASS**
- *Test 18*: `Zwei parallele identische Konfliktauflösungen führen zu exakt einer Ausführung (Advisory Lock)`: **PASS**

---

### 4. Geänderte Dateien
- `backend/src/migrations/003_conflict_receipts_separation.sql` (NEU: Dedizierte Tabelle `sync_conflict_resolution_receipts` mit RLS)
- `backend/src/migrations/001_initial_schema.sql` (Schema-Aktualisierung)
- `backend/src/controllers/syncController.ts` (Nutzung der getrennten Tabelle, `lockKey` mit `conflict_resolve`, stabile Revisions-Mutation-ID)
- `backend/src/tests/sync_and_roles.test.ts` (18 Tests inklusive Verifikation der Trennung von Push- und Konflikt-Quittungen)
- `package.json` (Frontend Jest-Konfiguration)
- `STEP_5R_2_7_REPORT.md` (Dieser Abschlussbericht)
