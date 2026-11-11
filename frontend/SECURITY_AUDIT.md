# SecurityOps 2.0 - Phase 1: Korrigierter Sicherheits-Audit & Härtungsbericht

## 1. Behobene Sicherheitsprobleme

| Problem-ID | Schweregrad | Bereich | Befund & Ursache | Durchgeführte Behebung |
|---|---|---|---|---|
| **SEC-FIX-01** | **KRITISCH** | Secrets & Konfiguration | Unsichere Fallback-Secrets in `backend/src/config/env.ts` und Vorkommen in Konfigurationsbeispielen. | Alle fest codierten Passwörter und JWT-Fallback-Secrets wurden restlos aus dem Quellcode entfernt. Fehlen Pflichtvariablen wie `JWT_SECRET` oder `DATABASE_URL`, bricht der Backend-Start mit Fehlercode 1 sofort ab. |
| **SEC-FIX-02** | **KRITISCH** | PostgreSQL RLS | RLS-Policies waren unvollständig formuliert und schützten ohne gesetzten Kontext nicht zwingend jede Operation. | Tabellen wurden mit `FORCE ROW LEVEL SECURITY` versehen. Strikte `PERMISSIVE`-Policies erzwingen die Prüfung von `current_setting('app.current_tenant')`. Ohne gesetzten Mandantenkontext werden physisch 0 Datensätze zurückgeliefert. |
| **SEC-FIX-03** | **KRITISCH** | Cross-Tenant Integrität | Gefahr, dass Objekte eines Mandanten Kunden eines fremden Mandanten referenzieren. | Composite Foreign Keys `(client_id, tenant_id)` referencing `clients(id, tenant_id)` verhindern Cross-Tenant-Beziehungen physisch auf PostgreSQL-Ebene. |
| **SEC-FIX-04** | **HOCH** | Session Lifecycle | In-Memory Token Blacklist ging bei Neustart oder Multi-Instanz-Betrieb verloren. | Reale Sitzungsverwaltung über die Tabelle `user_sessions`. Widerrufene Tokens (`revoked = true`) oder abgelaufene Sitzungen werden sofort bei jeder API-Anfrage abgewiesen. |
| **SEC-FIX-05** | **HOCH** | RBAC & Wildcards | Pauschale `permissions: ['*']` Wildcards im Auth-Controller. | Berechtigungen werden nun granular je Rolle aus `role_permissions` und `permissions` geladen und serverseitig in der Middleware validiert. |
| **SEC-FIX-06** | **HOCH** | Brute-Force Schutz | In-Memory Tracker für Login-Fehlversuche. | Fehlversuche und Kontosperren (`failed_login_attempts`, `locked_until`) werden persistent in der Tabelle `users` verwaltet. Nach 5 Fehlversuchen erfolgt eine 15-minütige Sperre. |

---

## 2. Hinweis zur Secrets-Rotation
Alle in früheren Entwicklungsständen oder Commits möglicherweise exponierten Beispiel-Tokens oder Entwicklungs-Passwörter müssen vor dem Produktiveinsatz erneuert werden:
1. `JWT_SECRET`: Neu generieren mit `openssl rand -hex 32`.
2. `DATABASE_URL`: Ein separates, starkes Passwort für `secops_app_user` in PostgreSQL setzen.
3. `.env`-Dateien dürfen niemals im Git-Repository versioniert werden (durch `.gitignore` abgesichert).
