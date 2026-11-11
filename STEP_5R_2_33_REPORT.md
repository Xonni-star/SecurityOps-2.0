# SecurityOps 2.0 – Entwicklungsschritt 5R.2.33
## PostgreSQL-Typ-Aliase bei Array-Typen korrekt normalisieren

**Ausgangsstand:** `main` @ `053dd9ed831da2297d07d8b16cd52de6cc8463dd`
**Durchgeführt am:** 2026-11-11
**Commit:** `fix: normalize PostgreSQL array type aliases`

---

## 1. Ausgangsproblem

`stripTypeModifiers()` normalisierte Aliase bisher auf den **vollständigen** gerenderten Typausdruck:

```ts
const normalized = tokensToTypeText(result);
return TYPE_ALIASES[normalized] ?? normalized;
```

Bei Array-Typen lautet der gerenderte Ausdruck jedoch z. B. `int[]` oder `varchar[]`. Ein Alias-Eintrag existiert nur für `int` bzw. `varchar`, nicht für `int[]`. Dadurch blieben Array-Typen unnormalisiert:

- `int[]` blieb `int[]` statt `integer[]`
- `int[][]` blieb `int[][]` statt `integer[][]`
- `varchar(255)[]` wurde zu `varchar[]` statt `character varying[]`
- `timestamp(3)[]` wurde zu `timestamp[]` statt `timestamp without time zone[]`

---

## 2. Implementierung

In `frontend/backend/src/migrations/runner.ts`, Funktion `stripTypeModifiers()`:

1. Typausdruck tokenisieren.
2. Den ersten Typmodifikator auf oberster Ebene entfernen (unverändert aus 5R.2.32).
3. Die verbleibenden Tokens am **ersten Array-Klammerzeichen** trennen:
   - `baseTokens` = Typbasis
   - `arrayTokens` = Array-Suffix inklusive aller Dimensionen (`[]`, `[][]`, `[3]`)
4. Alias-Normalisierung ausschließlich auf die Basis anwenden, und nur wenn die Basis aus **einem einzelnen unquotierten Wort** besteht.
5. Basis und Array-Suffix wieder zusammensetzen.

Damit gilt:

- `int[]` → Basis `int` → Alias `integer` + `[]` → `integer[]`
- `int[][]` → `integer[][]`
- `int4[]` → `integer[]`
- `varchar(255)[]` → Typmod entfernt → `varchar[]` → `character varying[]`
- `numeric(10,2)[]` → `numeric[]`
- `timestamp(3)[]` → `timestamp without time zone[]`
- `"MeinSchema"."MeinTyp"[]` → Basis ist mehrteilig/gequotet → unverändert
- `public."MeinTyp"[][]` → unverändert
- `integer[][]` → Basis `integer` hat keinen Alias → unverändert

Mehrdimensionale Arrays und Array-Suffixe mit Größenangaben bleiben erhalten. Gequotete und schemaqualifizierte benutzerdefinierte Typen werden nicht verändert. Unbekannte Typen bleiben unverändert. Die bestehende Signatur- und Überladungserkennung über `to_regprocedure()` / `oid::regprocedure::text` bleibt unverändert.

---

## 3. Unit-Tests

`frontend/backend/src/tests/migrationParser.test.ts`, Test 19 mit allen verbindlichen Fällen:

| Eingabe | Erwartetes Ergebnis | Ergebnis |
|---|---|---|
| `int[]` | `integer[]` | ✅ |
| `int[][]` | `integer[][]` | ✅ |
| `int4[]` | `integer[]` | ✅ |
| `varchar(255)[]` | `character varying[]` | ✅ |
| `numeric(10,2)[]` | `numeric[]` | ✅ |
| `timestamp(3)[]` | `timestamp without time zone[]` | ✅ |
| `"MeinSchema"."MeinTyp"[]` | unverändert | ✅ |
| `public."MeinTyp"[][]` | unverändert | ✅ |
| `integer[][]` | unverändert | ✅ |

Zusätzlich bleiben die Tests 17 und 18 (Typmodifikatoren bei quoted/schemaqualifizierten Typen) erfolgreich.

---

## 4. PostgreSQL-16-Integrationstests

`frontend/backend/src/tests/migrations.test.ts`, Test 57:

Migration 005 legt in einer isolierten Datenbank an:

- Schema `"MeinSchema"` und Enum-Typ `"MeinSchema"."MeinTyp"`
- `alias_array_fn(x int[], y varchar(255)[])`
- `multi_array_fn(x int[][])`
- `quoted_array_fn(x "MeinSchema"."MeinTyp"[])`
- zwei Überladungen von `overload_array_fn` mit `int[]` und `varchar(255)[]`

Nachweis:

1. Migration wird erfolgreich ausgeführt.
2. Ein zweiter Lauf des Migrationsrunners führt keine Migration erneut aus und akzeptiert alle Signaturen.
3. Eine nachträglich angelegte, nicht deklarierte Überladung `alias_array_fn(integer[])` wird erkannt.

---

## 5. Lokale Verifikation

Umgebung: Node v26.7.0, PostgreSQL 16.15 (Docker, `postgres:16-alpine`).

| Prüfung | Ergebnis |
|---|---|
| `npx tsc --noEmit` | ✅ Exit 0 |
| `npm run build` | ✅ Exit 0 |
| Parser- und Migrationstests | ✅ **76/76** (19 Unit + 57 Integration) |
| Vollständige Backend-Suite | ✅ **112/112 Tests, 6/6 Suites** |

---

## 6. GitHub Actions

Die CI/CD-Konfiguration wurde nicht verändert.

| Workflow | Run-ID | Job | Ergebnis |
|---|---|---|---|
| SecurityOps 2.0 CI | [`43064547719`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43064547719) | Root – npm ci, Strukturprüfung, Gesamtstart | **success** (47 s) |
| SecurityOps 2.0 CI | [`43064547719`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43064547719) | Frontend – npm ci, Vitest, Produktions-Build | **success** (13 s) |
| SecurityOps 2.0 CI | [`43064547719`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43064547719) | Backend – PostgreSQL 16, Migration, Build, Jest | **success** (1 m 31 s) |
| SecurityOps 2.0 CD | [`43064829396`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43064829396) | Release-Paket aus CI-Artefakten bauen | **success** |

Der Schritt **„Migrationshistorie & Baseline (Integrationstests)“** wurde im Backend-Job mit **success** abgeschlossen; die vollständige Jest-Suite (112 Tests) lief ebenfalls erfolgreich.

### Artefakte (über GitHub-API geprüft)

| Run | Artefakt | Größe | Status |
|---|---|---|---|
| CI `43064547719` | `frontend-dist` | 337.989 Bytes | vorhanden, nicht abgelaufen |
| CI `43064547719` | `backend-dist` | 59.533 Bytes | vorhanden, nicht abgelaufen |
| CD `43064829396` | `securityops-release-2e3d0c158b0402cace1409180f78893d320d6890` | 398.097 Bytes | vorhanden, nicht abgelaufen |

---

## 7. Bekannte Einschränkungen

1. Die Alias-Normalisierung greift nur bei einem einzelnen unquotierten Basiswort. Mehrteilige Typen (`character varying`, `double precision`) und gequotete/schemaqualifizierte Typen werden unverändert gerendert.
2. Array-Größenangaben (`int[3]`) bleiben im Suffix erhalten; PostgreSQL ignoriert sie bei der Typidentität.
3. Nur der erste Typmodifikator auf oberster Ebene wird entfernt.
4. Dynamisches SQL in `DO`-Blöcken wird weiterhin nicht statisch analysiert.
5. Die detaillierten 001–004-Prüfungen bleiben unverändert.

---

## 8. Sicherheitsvorgaben

- ✅ Keine Änderung an Migrationen 001–004
- ✅ Keine Änderung an vorhandenen Daten
- ✅ Keine Änderungen an Frontend oder API
- ✅ Keine Änderungen an Mandantenfähigkeit oder Offline-Synchronisation
- ✅ Keine Änderungen an CI/CD-Konfiguration oder Secrets
- ✅ Keine unnötigen Refactorings
- ✅ Ausschließlich Schritt 5R.2.33 umgesetzt
- ✅ Keine erfundenen Ergebnisse; lokale und CI-Ergebnisse werden getrennt ausgewiesen
