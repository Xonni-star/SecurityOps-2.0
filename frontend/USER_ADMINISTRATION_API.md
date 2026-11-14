# Benutzer- und Rollenadministration API

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Dieser Vertrag beschreibt Migration 033 und den aktuellen PR-Arbeitsstand, nicht den in `main` verfügbaren oder produktiv abgenommenen Funktionsstand.

## Sicherheitsmodell

Authentifizierte Endpunkte benötigen das opake Cookie `secops_session`. Schreibanfragen aus dem Browser müssen außerdem die vorhandenen Origin-/CSRF-Prüfungen bestehen. `authenticateJwt` leitet `userId` und `tenantId` aus der gespeicherten Sitzung ab; Administrationsendpunkte akzeptieren keine Mandantenauswahl. Ein mitgesendetes/manipuliertes `tenantId` wird, wo ein striktes Schema greift, abgewiesen und niemals als Autorisierungskontext verwendet. Datenbankzugriffe laufen in Transaktionen mit `app.current_tenant`; Migration 033 erzwingt RLS/FORCE RLS und mandantenbewusste Fremdschlüssel für Mitgliedschaften, Rollen, Grants, Reset-Tokens und Sitzungen. Bestehende globale Rollenzuordnungen werden in tenant-eigene Rollen, Grants und Zuordnungen überführt; die migrierten Zuweisungen werden nicht weiterhin aus globalen `role_permissions` geladen. Für echte Systemadministratorkonten bleibt die explizite Systemrolle erhalten.

Die Routenberechtigung ist notwendig, aber nicht ausreichend für administrative Schreibzugriffe. Administratoren dürfen nur Berechtigungscodes delegieren, die sie selbst besitzen. Reguläre Mandantenadministratoren dürfen `users:manage`, `roles:manage` und `roles:delegate_admin` nicht delegieren; Systemadministrationsfunktionen bilden eine getrennte Grenze. Neue Mandantenrollen erhalten standardmäßig keine Berechtigungen.

Berechtigungs-Grants unterstützen den Datenzugriffsscope `TENANT` oder `SITE`. Ein Site-Grant muss ein Objekt des authentifizierten Mandanten referenzieren. `OWN` wird derzeit abgewiesen und nie als Berechtigung geladen, da die ressourcenspezifische Eigentümerfilterung nicht implementiert ist. Site-scoped Lesezugriffe sind bewusst begrenzt: Filter sind nur bei `GET /admin/users?siteId=...` und `GET /employees?siteId=...` unterstützt. Site-scoped Berechtigungsprüfungen für Anlage sind nur bei `POST /shifts`, `/keys`, `/handovers`, `/alarms`, `/patrol/exceptions`, `/patrol/rounds` und `/logbook` verfügbar und gelten nur, wenn der jeweilige Handler das Objekt validiert. Andere Routen benötigen einen tenantweiten Grant; ein Site-Grant wird nicht zu tenantweitem Zugriff erweitert.

## Benutzerendpunkte

Alle folgenden Pfade liegen unter `/api/v1`. Erfolgsantworten verwenden `{ "success": true, "data": ... }`; Fehlerantworten `{ "success": false, "message": ... }`.

| Methode und Pfad | Routenberechtigung | Zweck |
|---|---|---|
| `GET /admin/users?q=&status=&roleId=&siteId=` | `users:read` | Suche nach Name/E-Mail; optionale Filter `ACTIVE`, `INACTIVE`, `LOCKED`, Rolle und Objekt |
| `POST /admin/users` | `users:manage` | Konto, Mitgliedschaft und erste Rollenzuordnung anlegen und Passwort-Reset-E-Mail zustellen |
| `GET /admin/users/:id` | `users:read` | Mandantenmitgliedschaft, Profil und Rollenzuordnungen |
| `PATCH /admin/users/:id` | `users:manage` | Vorname, Nachname und Telefon aktualisieren |
| `POST /admin/users/:id/status/:action` | `users:manage` | `activate`, `deactivate`, `lock` oder `unlock` |
| `POST /admin/users/:id/roles` | `users:manage` | Mandantenrolle optionalen Site-IDs zuordnen |
| `DELETE /admin/users/:id/roles/:assignmentId` | `users:manage` | Eine Rollenzuordnung entfernen |
| `POST /admin/users/:id/password-reset` | `users:manage` | Einmaligen, 30 Minuten gültigen Reset-Token per E-Mail zustellen |
| `GET /admin/users/:id/audit` | `users:read` | Bis zu 100 Audit-Ereignisse des Benutzers zurückgeben |
| `POST /auth/password` | Authentifizierte Sitzung | Eigenes Passwort ändern; aktuelles Passwort und neues Passwort mit 12–256 Zeichen erforderlich |
| `POST /auth/password-reset/complete` | Reset-Token | Zurücksetzung mit Tenant-ID, Token und neuem Passwort abschließen |

Anfrage zum Anlegen eines Benutzers:

```json
{
  "email": "person@example.test",
  "firstName": "Alex",
  "lastName": "Example",
  "phone": null,
  "roleId": "tenant-role-uuid",
  "siteIds": ["site-uuid"]
}
```

Dem Konto wird kein vorhersagbares Standardpasswort zugewiesen. Der Klartext-Token wird weder in der API-Antwort noch in Logs oder Auditdetails ausgegeben, sondern nur an den konfigurierten E-Mail-Provider übergeben. Er wird nicht gespeichert, läuft nach 30 Minuten ab und wird bei Ersetzung oder Nutzung ungültig. Ohne registrierten Provider antworten Benutzeranlage und Reset-Vorbereitung mit HTTP 503; es wird kein Token angelegt und keine Zustellung behauptet. Der Backend-Vertrag dafür ist `PasswordResetDeliveryProvider` unter `backend/src/services/passwordResetDelivery.ts`; ein konkreter E-Mail-Dienst und dessen Zugangsdaten sind nicht enthalten und müssen durch das Deployment bereitgestellt werden. Deaktivierung, Sperre und Rollenänderungen widerrufen betroffene Sitzungen im Mandanten. Eine Passwortänderung widerruft andere Sitzungen über alle Mitgliedschaften hinweg; eine abgeschlossene Zurücksetzung widerruft alle Sitzungen. Passworthashes verwenden Argon2id.

## Rollen- und Berechtigungsendpunkte

| Methode und Pfad | Routenberechtigung | Zweck |
|---|---|---|
| `GET /admin/roles` | `roles:read` | Mandanteneigene Rollen und Grants |
| `GET /admin/permissions` | `roles:read` | Berechtigungskatalog |
| `GET /admin/sites` | `users:read` | Aktive Objekte des aktuellen Mandanten |
| `POST /admin/roles` | `roles:manage` | Mandanteneigene Rolle anlegen |
| `PATCH /admin/roles/:id` | `roles:manage` | Mandanteneigene Rolle und Grants bearbeiten/ersetzen |

Rollen-Payloads enthalten `name`, optional `description` und optional ein `permissions`-Array. Jeder Grant enthält `code`, optional `siteId` sowie `dataScope` (`TENANT` oder `SITE`); bei `SITE` ist eine Objekt-ID desselben Mandanten erforderlich. Die UI kann für jede Berechtigung mehrere Objekt-Grants pflegen. Ein optionales `canDelegate`-Feld wird nicht als eigenständige Delegierungsberechtigung verwendet; maßgeblich sind die Berechtigungen des handelnden Administrators. Der Berechtigungskatalog ist gemeinsam, Rollen-Grants und Rollenzuordnungen sind mandanteneigen. Änderungen an einer Mandantenrolle verändern niemals die globale Tabelle `role_permissions`.

Profilnamen und Telefonnummern liegen auf der Mandantenmitgliedschaft und nicht auf dem globalen Benutzerkonto. Eine Profiländerung durch einen Mandantenadministrator ändert deshalb keine Mitgliedschaft in einem anderen Mandanten.

## Audit und Offline-Verhalten

Änderungen am Lebenszyklus von Benutzern und Rollen schreiben tenant-scoped `audit_logs` mit Akteur, Aktion, Ziel und nicht geheimen Details. Passwörter und Reset-Tokenwerte werden ausgeschlossen. Der Audit-Zugriff ist mandantengefiltert. Benutzer- und Rollenadministration ist nur online verfügbar; lokal gespeicherte Benutzer-/Mandanten-IDs sind keine Berechtigungsnachweise. Jede Offline-Mutationswiedergabe muss weiterhin die aktuelle Sitzung, den Mandanten und serverseitige Berechtigungen bestehen.
