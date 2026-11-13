# Browser Authentication and Sessions (Phase 2.1)

## Session lifecycle

The browser uses a server-side session, not a JWT bearer credential. Login creates a 256-bit cryptographically random opaque session identifier and stores only its SHA-256 hash in the existing `user_sessions.token_hash` column, associated with the authenticated user and selected tenant. The raw identifier is returned only in the `secops_session` cookie, which is HttpOnly, SameSite=Strict, scoped to `/api/v1`, and Secure in production. The configured `JWT_EXPIRES_IN` value continues to define the fixed session lifetime for deployment compatibility; despite the legacy variable name, no JWT is issued.

Every protected request resolves the cookie hash against an unrevoked, unexpired database session and joins the current active user, tenant membership, role and role permissions. Thus role changes and permission revocations apply on the next request. Logout marks the current database session revoked and clears its cookies. Session fixation is prevented by generating a fresh random identifier at each login. Existing `user_sessions` storage is reused; no schema migration is required.

## CSRF and origins

Login requires an allowlisted Origin. Every other state-changing method also requires an exact Origin allowlist match and matching `secops_csrf` cookie / `X-CSRF-Token` header, compared in constant time. The random CSRF value is issued at login and exposed to the frontend as response data/header; the authentication cookie itself remains HttpOnly. CORS credentials are enabled only for configured origins, and preflight permits the CSRF header. GET, HEAD and OPTIONS requests bypass CSRF checks and must remain read-only.

## Frontend and offline behavior

The API client always uses `credentials: include` and sends the CSRF header for mutations. It does not retain bearer credentials; it removes the legacy `secops_access_token` localStorage entry at startup. Tenant preferences and UI theme are not authentication credentials. A 401 clears in-memory auth/CSRF state without clearing IndexedDB; queued mutations remain available for retry after login. Server-side idempotency and revision/conflict processing are unchanged.

## Alarm roles, site scope, and contact privacy

Alarm routes use database-backed `alarm:*`, `emergency_plan:publish`, and `emergency_contact:*` permissions. In addition to tenant RLS, the alarm API restricts non-elevated users to sites assigned to the employee matching the authenticated email. Elevated role names still require each route's explicit permission. Contacts require `emergency_contact:read`; plan-version responses omit contact snapshots without that permission. Archiving an incident additionally requires `alarm:archive`, even when the caller can otherwise change incident status.

Offline alarm plans and types are cached per tenant/user, but contact snapshots are stripped before persistence. Alarm actions can reference an existing authorized document; binary photo/file capture and upload for alarm records are not implemented.

## Deployment and remaining verification

Production cookies require HTTPS (`Secure`). Configure exact frontend origins in `CORS_ORIGIN` and terminate TLS at the deployment proxy. Locally verified: PostgreSQL 16 migrations and database-backed Jest suite (10 suites / 148 tests), tenant isolation and sync/idempotency coverage, backend TypeScript build, frontend Vitest (24 tests) and production build, Docker Compose validation and both production image builds, full-stack smoke check, and root structure check. GitHub CI/CD remains pending publication and must pass for this exact commit. No claim of production readiness is made until full CI/CD succeeds. The current code revokes the logged-in session on logout; a separate administrative “revoke all sessions” operation is not exposed by the existing application and remains an explicit limitation.
# DMS-Rollen und Tenant-Grenze

Dokumentrouten verwenden dieselbe serverseitige, datenbankgestützte RBAC-Prüfung wie die übrige API. Der Tenant wird ausschließlich aus der authentifizierten Datenbanksitzung (`user_sessions.tenant_id`) übernommen; `currentTenantId` im Browser ist kein Autorisierungsmerkmal. DMS-Tabellen erzwingen PostgreSQL RLS und Beziehungen zu Kunden, Objekten, Mitarbeitern, Schichten und Wachbuchereignissen verwenden zusammengesetzte Fremdschlüssel mit `tenant_id`.

Die granularen DMS-Rechte sind `documents:read`, `documents:create`, `documents:update`, `documents:download`, `documents:archive`, `documents:restore`, `documents:manage` und `documents:approve`. Download erfordert ein eigenes Recht. Audit-Ereignisse sind für die Anwendungsrolle nur les- und anlegbar; zusätzlich verhindert ein Trigger Updates und Deletes.

# Übergabemanagement-Rollen und Tenant-Grenze

Die Handover-Routen verwenden die serverseitigen Rechte `handovers:read`, `handovers:create`, `handovers:update`, `handovers:confirm`, `handovers:tasks` und `handovers:manage`. Die Zuordnung wird in Migration 017 an die bestehenden Einsatz-, Objektleitungs-, Wach- und Auditorrollen vergeben. Jede Controller-Abfrage läuft über `withTenantTransaction`; jede neue Tabelle erzwingt RLS. Bestätigungen prüfen zusätzlich, dass die E-Mail des authentifizierten Kontos mit dem zugeordneten Übergabe-/Übernahmemitarbeiter übereinstimmt. DMS-Verknüpfungen erfordern zusätzlich `documents:read`.

Offline gespeicherte Übergaben sind bis zur serverseitigen Quittung ausdrücklich nicht bestätigt. Sync-ID-Wiederverwendung mit abweichendem Inhalt wird als Konflikt zurückgegeben; der Server überschreibt keine bestätigten Übergabeinhalte.
