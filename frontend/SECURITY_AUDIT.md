# SecurityOps 2.0 - Schritt 3: Sicherheitsaudit & RLS-Härtungsbericht

## 1. Behobene Sicherheitslücken (Schritt 3)

| Lücken-ID | Schweregrad | Bereich | Befund vor Behebung | Durchgeführte Behebung |
|---|---|---|---|---|
| **SEC-S3-01** | **KRITISCH** | Secrets & Konfiguration | Feste Standard-Passwörter in `deploy/docker-compose.yml`, offene Port-Exponierung nach außen (`0.0.0.0:5432`). | `docker-compose.yml` erfordert nun verpflichtend `${POSTGRES_PASSWORD:?Fehler...}` aus der Umgebung. Die Portbindung wurde strikt auf `127.0.0.1:5432:5432` (localhost) begrenzt. Alle echten Zugangsdaten wurden aus `.env.example` entfernt. |
| **SEC-S3-02** | **KRITISCH** | PostgreSQL RLS | Fehlen einer strikten `PERMISSIVE` Policy mit `IS NOT NULL AND != ''` Prüfung. Risiko von Datenzugriff ohne gesetzten Kontext. | Tabellen wurden mit `FORCE ROW LEVEL SECURITY` versehen. Die Policy `tenant_isolation_permissive` prüft explizit `current_setting('app.current_tenant', true) IS NOT NULL AND != ''`. Ohne gesetzten Mandantenkontext liefert die DB physikalisch 0 Zeilen zurück. |
| **SEC-S3-03** | **KRITISCH** | Unprivilegierter DB-User | Anwendung lief potenziell als Superuser oder mit BYPASSRLS-Rechten. | Ein unprivilegierter Datenbankbenutzer `secops_app_user` (`NOSUPERUSER NOBYPASSRLS`) wurde im DDL-Schema angelegt und mit minimal notwendigen Rechten ausgestattet. |
| **SEC-S3-04** | **KRITISCH** | Composite Foreign Keys | Fehlende Composite FKs auf `shifts` (`employee_id, tenant_id`) und `keys` (`current_holder_id, tenant_id`). | `shifts` und `keys` erzwingen nun zusammengesetzte Fremdschlüssel `(employee_id, tenant_id) REFERENCES employees(id, tenant_id) ON DELETE RESTRICT`. Cross-Tenant Zuweisungen werden von PostgreSQL mit `IntegrityError` abgewiesen. |
| **SEC-S3-05** | **HOCH** | RBAC Admin-Bypass | Code-Bypass `role === 'Systemadministrator'` hebelte granulare Datenbankberechtigungen aus. | Die pauschale Rollenprüfung im Middleware-Code wurde restlos entfernt. Jeder Benutzer, auch Administratoren, muss über die explizite Berechtigung in `role_permissions` verfügen. Fehlt die Berechtigung, antwortet die API mit HTTP 403. |
| **SEC-S3-06** | **HOCH** | Session-Widerruf | Sitzungen wurden nur im Speicher gehalten. | Sitzungen werden persistent in `user_sessions` mit kryptografischem SHA-256 Token-Hash verwaltet. Widerrufene (`revoked = true`) oder abgelaufene Tokens werden bei jedem API-Aufruf sofort mit HTTP 401 abgefangen. |
| **SEC-S3-07** | **HOCH** | Wachbuch-Idempotenz | Gleichzeitige Sync-Versuche konnten zu Duplikaten führen. | Atomare Idempotenz via `INSERT ... ON CONFLICT (tenant_id, client_mutation_id) DO NOTHING` implementiert. Nachfolgeaufrufe geben idempotent den bestehenden Datensatz zurück, ohne Duplikate anzulegen. |

---

## 2. Tatsächlich ausgeführte Tests (Jest Test-Suite)
Alle 12 Integrationstests wurden mit eigener Testdatenbank-Isolation ausgeführt:
1. `PostgreSQL-Verbindung antwortet stabil`: **BESTANDEN**
2. `Anwendungsdatenbankrolle besitzt weder SUPERUSER noch BYPASSRLS`: **BESTANDEN**
3. `Mandant A kann NIEMALS Daten von Mandant B lesen`: **BESTANDEN**
4. `Mandant A kann keine Datensätze für Mandant B anlegen`: **BESTANDEN**
5. `Ohne gesetzten Mandantenkontext liefert die DB 0 Datensätze`: **BESTANDEN**
6. `Composite Foreign Key verhindert mandantenübergreifende Beziehungen (Sites)`: **BESTANDEN**
7. `Composite Foreign Key bei Schichten verhindert Mitarbeiter aus fremdem Mandanten`: **BESTANDEN**
8. `Wachbuch: Doppelte client_mutation_id erzeugt nur genau 1 Eintrag (atomar)`: **BESTANDEN**
9. `Widerrufenes Token wird von geschützter Route mit HTTP 401 abgewiesen`: **BESTANDEN**
10. `Abgelaufenes Token wird mit HTTP 401 abgewiesen`: **BESTANDEN**
11. `Benutzer ohne passende Berechtigung erhält HTTP 403`: **BESTANDEN**
12. `Rolle Systemadministrator besitzt keinen pauschalen Berechtigungs-Bypass`: **BESTANDEN**

**Gesamtergebnis**: 12 von 12 Tests erfolgreich bestanden.
