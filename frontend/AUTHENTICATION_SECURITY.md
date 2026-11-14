# Browser Authentication and Sessions (Phase 2.1)

## Session lifecycle

The browser uses a server-side session, not a JWT bearer credential. Login creates a 256-bit cryptographically random opaque session identifier and stores only its SHA-256 hash in the existing `user_sessions.token_hash` column, associated with the authenticated user and selected tenant. The raw identifier is returned only in the `secops_session` cookie, which is HttpOnly, SameSite=Strict, scoped to `/api/v1`, and Secure in production. The configured `JWT_EXPIRES_IN` value continues to define the fixed session lifetime for deployment compatibility; despite the legacy variable name, no JWT is issued.

Every protected request resolves the cookie hash against an unrevoked, unexpired database session and joins the current active user, tenant membership, roles and permissions. Session lookup uses a narrow RLS policy keyed by the SHA-256 hash of the unguessable cookie; subsequent reads/writes run with the resolved tenant transaction context. `user_roles`, `user_sessions`, tenant memberships and new tenant role tables have `ENABLE` and `FORCE ROW LEVEL SECURITY`. Composite membership foreign keys prevent a session or role assignment from attaching a user to a tenant where the user is not a member. Role changes and permission revocations apply on the next request. Deactivation, lock and role-assignment actions revoke the affected tenant sessions. Session fixation is prevented by generating a fresh random identifier at each login. Migration `033_tenant_user_role_administration.sql` adds the membership state and reset-token schema.

## CSRF and origins

Login requires an allowlisted Origin. Every other state-changing method also requires an exact Origin allowlist match and matching `secops_csrf` cookie / `X-CSRF-Token` header, compared in constant time. The random CSRF value is issued at login and exposed to the frontend as response data/header; the authentication cookie itself remains HttpOnly. CORS credentials are enabled only for configured origins, and preflight permits the CSRF header. GET, HEAD and OPTIONS requests bypass CSRF checks and must remain read-only.

## Frontend and offline behavior

The API client always uses `credentials: include` and sends the CSRF header for mutations. It does not retain bearer credentials; it removes the legacy `secops_access_token` localStorage entry at startup. Tenant preferences and UI theme are not authentication credentials. A 401 clears in-memory auth/CSRF state without clearing IndexedDB; queued mutations remain available for retry after login. Server-side idempotency and revision/conflict processing are unchanged.

## User and role administration

The administration API accepts no client-selected tenant for authenticated operations; it derives the tenant from `req.user.tenantId`. Tenant roles and their permissions are stored separately from the legacy global role catalog, so one tenant's edits cannot alter another tenant's permissions. Sensitive administrative rights cannot be delegated by ordinary tenant admins. Site grants are attached to a tenant role permission and are honored only when a handler supplies/validates the target site or when a supported filtered list explicitly scopes the query; a site grant is not treated as a tenant-wide permission. Account/role administration is online-only.

User profile names and phone numbers in the administration API are stored on `tenant_memberships`; editing a profile in one tenant does not mutate the global `users` row or another tenant's profile. Login and session hydration read the profile belonging to the selected membership. Password change revokes other sessions across the user's memberships while retaining the current session; completing a reset revokes all sessions across memberships.

User creation and administrator-prepared password reset issue a random, one-time token with a 30-minute expiry. Only its SHA-256 hash is stored. The typed `PasswordResetDeliveryProvider` interface in `backend/src/services/passwordResetDelivery.ts` receives the clear token for email delivery; neither API responses, audit details, nor application logs expose it. Replacing or using a token consumes outstanding tokens, and expired or consumed tokens cannot complete a reset. Successful reset delivery revokes the target user's sessions; password changes use Argon2id and revoke other sessions (all sessions for reset).

No email provider implementation or credentials are included or configured by default. Until the application registers a provider, user creation and reset preparation fail with HTTP 503 and a clear configuration message; no token is issued and no delivery is claimed. A provider delivery failure likewise returns a non-success response and rolls back token/account changes. Successful login timestamps are recorded per tenant membership. Audit details do not contain password or token values.

## Alarm roles, site scope, and contact privacy

Alarm routes use database-backed `alarm:*`, `emergency_plan:publish`, and `emergency_contact:*` permissions. In addition to tenant RLS, the alarm API restricts non-elevated users to sites assigned to the employee matching the authenticated email. Elevated role names still require each route's explicit permission. Contacts require `emergency_contact:read`; plan-version responses omit contact snapshots without that permission. Archiving an incident additionally requires `alarm:archive`, even when the caller can otherwise change incident status.

Offline alarm plans and types are cached per tenant/user, but contact snapshots are stripped before persistence. Alarm actions can reference an existing authorized document; binary photo/file capture and upload for alarm records are not implemented.

## Deployment and remaining verification

Production cookies require HTTPS (`Secure`). Configure exact frontend origins in `CORS_ORIGIN` and terminate TLS at the deployment proxy. Validation evidence and environment limitations for the current user/role administration work are recorded in [NEXT_DEVELOPMENT_REPORT.md](../docs/development/NEXT_DEVELOPMENT_REPORT.md); do not reuse older test totals from this historical Phase 2 note as current evidence. The system remains in development and has not been production-approved.
# DMS-Rollen und Tenant-Grenze

Dokumentrouten verwenden dieselbe serverseitige, datenbankgestützte RBAC-Prüfung wie die übrige API. Der Tenant wird ausschließlich aus der authentifizierten Datenbanksitzung (`user_sessions.tenant_id`) übernommen; `currentTenantId` im Browser ist kein Autorisierungsmerkmal. DMS-Tabellen erzwingen PostgreSQL RLS und Beziehungen zu Kunden, Objekten, Mitarbeitern, Schichten und Wachbuchereignissen verwenden zusammengesetzte Fremdschlüssel mit `tenant_id`.

Die granularen DMS-Rechte sind `documents:read`, `documents:create`, `documents:update`, `documents:download`, `documents:archive`, `documents:restore`, `documents:manage` und `documents:approve`. Download erfordert ein eigenes Recht. Audit-Ereignisse sind für die Anwendungsrolle nur les- und anlegbar; zusätzlich verhindert ein Trigger Updates und Deletes.

# Übergabemanagement-Rollen und Tenant-Grenze

Die Handover-Routen verwenden die serverseitigen Rechte `handovers:read`, `handovers:create`, `handovers:update`, `handovers:confirm`, `handovers:tasks` und `handovers:manage`. Die Zuordnung wird in Migration 017 an die bestehenden Einsatz-, Objektleitungs-, Wach- und Auditorrollen vergeben. Jede Controller-Abfrage läuft über `withTenantTransaction`; jede neue Tabelle erzwingt RLS. Bestätigungen prüfen das stabile `employees.account_user_id` des authentifizierten Kontos, verlangen die angezeigte erwartete Revision und binden diese an den Idempotenz-Hash. Mitarbeiter-Kontozuordnungen benötigen das dedizierte Recht `employees:account:link`, das nur an `Personalverwaltung` vergeben wird; ein Bestätiger kann das eigene Konto nicht neu einem Mitarbeiter zuordnen. DMS-Verknüpfungen erfordern zusätzlich `documents:read`.

Offline gespeicherte Übergaben sind bis zur serverseitigen Quittung ausdrücklich nicht bestätigt. Sync-ID-Wiederverwendung mit abweichendem Inhalt wird als Konflikt zurückgegeben; der Server überschreibt keine bestätigten Übergabeinhalte.
