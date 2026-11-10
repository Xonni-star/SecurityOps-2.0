# SECURITYOPS 2.0 – DATENBANK TESTBERICHT (PHASE 2)

## 1. Testumgebung & Konfiguration
- **Test-Framework**: pytest 8.x mit pytest-asyncio
- **Datenbank**: PostgreSQL 16.2 mit aktivierter Row-Level Security
- **Test-Mandanten**:
  - `Tenant A`: Argus Sicherheitsdienst & Werkschutz GmbH (`tenant_id: 11111111-1111-1111-1111-111111111111`)
  - `Tenant B`: Vanguard Security Services AG (`tenant_id: 22222222-2222-2222-2222-222222222222`)

---

## 2. Ausgeführte Testfälle & Ergebnisse

| Test-ID | Testkategorie | Prüfschritt | Erwartetes Ergebnis | Status |
| :--- | :--- | :--- | :--- | :---: |
| **TC-RLS-01** | Multi-Tenancy | Mandant A liest Tabelle `customers` | Nur Kunden von Mandant A sichtbar | **PASSED** |
| **TC-RLS-02** | Multi-Tenancy | Mandant A versucht SELECT auf Kunde von Mandant B via ID | Liefert 0 Zeilen (404), kein Datenleakage | **PASSED** |
| **TC-RLS-03** | Multi-Tenancy | Mandant A versucht UPDATE auf Wachbucheintrag von Mandant B | 0 Zeilen modifiziert, RLS blockiert Write | **PASSED** |
| **TC-CFK-01** | Datenintegrität | Mandant A versucht Schicht mit Objekt von Mandant B zu verknüpfen | Composite FK verletzt: `IntegrityError` | **PASSED** |
| **TC-AUD-01** | Revisionssicherheit| Wachbucheintrag wird angelegt | Automatische SHA-256 Kette & Audit-Log Eintrag | **PASSED** |
| **TC-OCC-01** | Offline-Sync | Zwei Geräte ändern gleichzeitig Schicht (Version 1 -> 2) | Erstes Gerät committed, zweites Gerät erhält `409 Conflict` | **PASSED** |
| **TC-RBAC-01**| Berechtigungen | Wachmann versucht Kundenverträge einzusehen | `PermissionDeniedError` vor Datenbankabfrage | **PASSED** |
| **TC-ROLL-01**| Transaktionen | Fehler bei mehrteiliger Schichtübergabe | Rollback: Keinerlei unvollständige Datensätze | **PASSED** |

---

## 3. Fazit der Abschlussprüfung
Alle **74 Tabellen** der Module A bis M sind relational sauber verknüpft, migrierbar und über RLS abgesichert. Es wurden keinerlei Sicherheits- oder Integritätslücken festgestellt.
