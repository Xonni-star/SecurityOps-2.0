# SecurityOps 2.0 - Phase 13: Mandantenisolations-Prüfbericht

## 1. Testmandanten
- **Mandant A**: Securitas & Wache Frankfurt GmbH (`tenant-frankfurt`)
- **Mandant B**: Bavaria Schutz & Werkschutz AG (`tenant-bavaria`)

## 2. Getestete Angriffsszenarien
- **Angriff 1: Manipulierte `tenant_id` im Request-Body**:
  - *Ergebnis*: **ABGEWEHRT**. Der Server ignoriert clientseitig übergebene `tenant_id` Felder und leitet den Mandanten ausschließlich aus dem signierten JWT-Token ab.
- **Angriff 2: Cross-Tenant Foreign Key Manipulation**:
  - *Ergebnis*: **ABGEWEHRT**. Der Versuch, ein Objekt in Mandant A mit einem Kunden aus Mandant B zu verknüpfen, wird durch den Composite Foreign Key `(customer_id, tenant_id)` physisch abgebrochen.
- **Angriff 3: Direkte SQL-Query ohne RLS-Variable**:
  - *Ergebnis*: **ABGEWEHRT**. Wenn `app.current_tenant` nicht gesetzt ist, liefert die RLS-Policy `tenant_isolation_policy` 0 Zeilen zurück.
