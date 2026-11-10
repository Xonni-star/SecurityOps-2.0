# SECURITYOPS 2.0 – ALEMBIC MIGRATIONEN & ENTWICKLUNGSLEITFADEN

## 1. Migrationsarchitektur
Alle Datenbankänderungen werden ausschließlich über **Alembic** verwaltet.
- **Async Engine Support**: Migrationen laufen über `asyncpg` / `psycopg3`.
- **Idempotenz**: Jedes Skript prüft Vorhandensein von Tabellen/Indizes (`IF NOT EXISTS`).
- **PostgreSQL RLS Enforcement**: Nach jedem `op.create_table()` wird automatisch RLS aktiviert.

---

## 2. Revisionsbaum

```
0001_initial_core_and_tenants (System & Mandanten)
  └── 0002_customers_and_kritis_objects (Kunden & KRITIS-Objekte)
        └── 0003_employees_and_qualifications (Personal & § 34a GewO)
              └── 0004_schedule_and_shifts (Dienstplanung & Konfliktregeln)
                    └── 0005_wachbuch_and_incidents (Wachbuch & Krypto-Hashes)
                          └── 0006_qm_alarms_and_keys (QM, Alarmpläne, Schlüssel)
                                └── 0007_tasks_and_documents (Aufgaben & Dokumente)
                                      └── 0008_offline_sync_and_audit (Sync-Engine & Audit-Logs)
```

---

## 3. Befehle zur Ausführung

```bash
# Aktuellen Migrationsstand anzeigen
alembic current

# Datenbank auf die neueste Revision aktualisieren
alembic upgrade head

# Rollback um eine Revision (Transaktionsgesichert)
alembic downgrade -1

# Neue automatische Revision anhand von SQLAlchemy-Modellen erzeugen
alembic revision --autogenerate -m "add_custom_field_to_patrols"
```

---

## 4. Zero-Downtime Richtlinien
1. **Kein DROP COLUMN ohne 2-Phasen-Deprecation**.
2. **Indizes stets CONCURRENTLY anlegen**: `CREATE INDEX CONCURRENTLY ...`
3. **NOT NULL Spalten nur mit DEFAULT hinzufügen**: Verhindert Tabellensperren im 24/7 Leitstandbetrieb.
