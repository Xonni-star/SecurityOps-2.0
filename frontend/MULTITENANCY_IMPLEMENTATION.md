# SECURITYOPS 2.0 – MULTI-TENANCY IMPLEMENTIERUNG (PHASE 3)

## 1. Das "Dual-Guard" Schutzprinzip
SecurityOps 2.0 schützt Mandantendaten zweistufig:

1. **Stufe 1: Backend Middleware Authorization Guard**:
   Der Client kann **niemals** eine fremde `tenant_id` fälschen. Die Middleware prüft, ob die angefragte Mandanten-ID in der verifizierten `user_tenants` Tabelle für den angemeldeten Benutzer hinterlegt und aktiv ist.
2. **Stufe 2: PostgreSQL Kernel Row-Level Security (RLS)**:
   Vor jeder Datenbankoperation führt SQLAlchemy folgendes Statement im Connection-Pool aus:
   ```sql
   SET LOCAL app.current_tenant_id = '<validierte_tenant_id>';
   ```
   Selbst bei Programmierfehlern im SQL (`WHERE` vergessen) verweigert die Datenbank Kernel-Ebene jeden Zugriff auf fremde Datensätze.

---

## 2. Schutz vor mandantenübergreifenden Fremdschlüsseln
Alle relationalen Verknüpfungen nutzen **zusammengesetzte Fremdschlüssel** (Composite Foreign Keys):
```sql
CONSTRAINT fk_object_customer 
FOREIGN KEY (tenant_id, customer_id) 
REFERENCES customers (tenant_id, id)
```
Ein Versuch, ein Objekt von Mandant A einem Kunden von Mandant B zuzuordnen, scheitert zwingend mit einem `IntegrityError`.
