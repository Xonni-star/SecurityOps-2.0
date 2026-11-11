# SecurityOps 2.0 – Schritt 5R.2.24
## RLS-Policy-Vollständigkeit und sichere Leer-Datenbank-Erkennung

**Ausgangsstand:** `main` @ `944035cad0d18f857e66dc535eb466c523b779ee`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: reject extra RLS policies and non-empty database baselines`

---

## 1. Aufgabe 1 – Zusätzliche RLS-Policies erkennen

### Ausgangsproblem
Die gefundenen Policies wurden in einer `Map` mit dem **Tabellennamen** als Schlüssel gespeichert. Bei mehreren Policies auf derselben Tabelle überschrieb die letzte die vorherigen. Zusätzliche Policies – insbesondere permissive Policies, die PostgreSQL mit `OR` verknüpft – konnten dadurch unbemerkt bleiben.

### Behebung
- Alle Policy-Zeilen werden jetzt pro Tabelle in einem **Array** gesammelt (`Map<string, PolicyRow[]>`).
- Für jede der 14 erwarteten RLS-Tabellen gilt:
  - **0 Policies** → Abbruch (`RLS-Policy fehlt`).
  - **mehr als 1 Policy** → Abbruch mit Nennung aller Namen, Modi (`PERMISSIVE`/`RESTRICTIVE`) und Kommandos. Der Hinweis auf die ODER-Verknüpfung permissiver Policies ist Teil der Fehlermeldung.
  - **genau 1 Policy** → vollständige Prüfung von Name, Modus, Rollen, Kommando, `USING`- und `WITH CHECK`-Ausdruck.
- Eine zusätzliche Policy mit anderem Namen kann die Prüfung damit nicht mehr umgehen; sie erhöht die Anzahl und führt zum Abbruch.
- Doppelte identische Policy-Namen sind in PostgreSQL pro Tabelle nicht zulässig (Unique-Constraint auf `(table, policyname)`); der Fall „mehrere Policies“ wird über die Anzahl erkannt.

---

## 2. Aufgabe 2 – Leer-Datenbank-Erkennung absichern

### Ausgangsproblem
Eine Datenbank galt als leer, sobald keine der 21 erwarteten Tabellen existierte. Fremde Tabellen, Views, Sequenzen usw. wurden ignoriert – die Migrationen wären dann blind auf einem unbekannten Schema ausgeführt worden.

### Behebung
Die Prüfung für `public` erfasst jetzt zusätzlich:

- Tabellen (`r`) und partitionierte Tabellen (`p`)
- Views (`v`)
- Materialized Views (`m`)
- Sequenzen (`S`)
- Fremdtabellen (`f`)
- Funktionen und Prozeduren
- Enums und Domains

Die Historientabelle `schema_migrations` ist von dieser Prüfung ausgenommen, da der Runner sie selbst anlegt.

Verhalten:

| Zustand | Verhalten |
|---|---|
| Keine erwarteten Tabellen **und** keine sonstigen Objekte | **Leer** → Migrationen 001–004 werden ausgeführt |
| Keine erwarteten Tabellen, aber fremde Objekte | **Abbruch** mit Nennung von Typ und Name jedes Objekts |
| Erwartete Tabellen vorhanden, aber Abweichungen | Abbruch (wie in 5R.2.23) |
| Erwartete Tabellen vollständig und exakt | Baseline-Übernahme |

Es werden keine Objekte oder Daten gelöscht, verschoben oder überschrieben. Die Fehlermeldung nennt bis zu acht Details und die Gesamtzahl weiterer Abweichungen.

---

## 3. Tests

`frontend/backend/src/tests/migrations.test.ts` wurde von 21 auf **28 Integrationstests** erweitert.

Neue Tests:

| # | Test | Ergebnis |
|---|---|---|
| 22 | Zusätzliche permissive RLS-Policy verhindert Baseline | ✅ |
| 23 | Zusätzliche restrictive RLS-Policy verhindert Baseline | ✅ |
| 24 | Mehrere zusätzliche Policies werden vollständig erkannt (3 Policies, Namen im Fehlertext) | ✅ |
| 25 | Tatsächlich leere Datenbank wird weiterhin akzeptiert (001–004 werden angewendet) | ✅ |
| 26 | Fremde Tabelle verhindert Einstufung als leer; Daten bleiben erhalten | ✅ |
| 27 | Vorhandene View ohne erwartete Tabellen verhindert Einstufung als leer | ✅ |
| 28 | Bestehende Daten bleiben bei abgelehnter Leer-Erkennung unverändert; Historie bleibt leer | ✅ |

Weiterhin bestanden:

- Vollständige korrekte Baseline aus 5R.2.23 (Test 7)
- Fehlende/veränderte RLS-Policy (Tests 10/11)
- Trigger-, Funktions-, Constraint- und Rechteabweichungen (Tests 12–16)
- Datenunverändertheit bei abgelehnter Baseline (Test 19)
- Historie-Konsistenz (Tests 20/21)

---

## 4. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker), isolierte Testdatenbanken `secops_migtest_*`.

| Prüfung | Ergebnis |
|---|---|
| `npm run build` (TypeScript) | ✅ Exit 0 |
| Migrationstests | ✅ **28/28** |
| Gesamte Backend-Suite | ✅ **64/64 Tests, 5/5 Suites** |

---

## 5. GitHub Actions

Die bestehende CI/CD-Struktur wurde beibehalten. Der Backend-Job führt weiterhin den Schritt „Migrationshistorie & Baseline (Integrationstests)“ aus, nun mit 28 Tests.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | _wird ergänzt_ | Root | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Frontend | _wird ergänzt_ |
| SecurityOps 2.0 CI | _wird ergänzt_ | Backend (inkl. 28 Migrationstests) | _wird ergänzt_ |
| SecurityOps 2.0 CD | _wird ergänzt_ | Release-Paket | _wird ergänzt_ |

---

## 6. Sicherheitsvorgaben

- ✅ Keine SQL-Migration 001–004 verändert
- ✅ Keine produktiven Daten verändert
- ✅ Keine bestehende Historie gelöscht
- ✅ Keine neuen Secrets
- ✅ Keine Frontend-Änderungen
- ✅ Keine Änderungen an Offline-Synchronisation oder Mandantenarchitektur
- ✅ Bestehende CI/CD-Struktur beibehalten
- ✅ Keine zusätzlichen Entwicklungsaufgaben begonnen
