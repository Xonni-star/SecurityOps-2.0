# Next development report: tenant-safe user and role administration

**Report date:** 2026-11-14

**Project status:** In development; not approved for production.

**Change status:** Implemented in the current PR worktree; not integrated in `main`.
**Verification status:** Local backend, frontend, PostgreSQL 16, and Docker checks passed.

This report describes the current worktree only. It does not change the status or limitations of existing modules and does not claim that the system is production-ready, legally compliant, or certified.

## Starting state

`main` remains at `35300252fc471e3e347a4842d35cccb70342adf`. Existing authentication used Argon2id password hashes and opaque, hashed database sessions. The schema already had global legacy roles/permissions and tenant-tagged `user_roles` and `user_sessions`, but those two tables were not protected by RLS/FORCE RLS or tenant-aware membership foreign keys. There were no user/role administration routes, the role model had no site-scoped grants, and employee listing was tenant-wide.

## Existing pull requests checked

| PR | State when checked | Base ← head | Latest known checks |
|---|---|---|---|
| [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16) | Open, unmerged | `main` ← `xonni-star-phase-2-backend-planning` | All four CI jobs succeeded in run `43499444936` |
| [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) | Open, unmerged | `xonni-star-phase-2-backend-planning` ← `xonni-star-phase-2-planning-ui` | All four CI jobs succeeded in run `43499895032` |

This work is based on PR #19's head `05b9b938a95f087dfb37731f3246b0e83874354c` and is intended as a stacked change. The above PR states are not claims about `main`; neither PR was merged or modified by this work.

## Implementation

The existing authentication, tenant, and employee models were extended rather than replaced. The new API supports tenant-scoped user listing/search/filtering, profile updates, account activation/deactivation and lock/unlock, role assignment/removal, audit history, own-password changes, and bounded password-reset preparation/completion. Account deactivation, lock, role changes, password changes, and reset completion revoke the appropriate sessions. New accounts receive a random unusable initial password and a one-time reset token instead of a predictable default.

Tenant-owned roles can be created and edited with tenant- or site-scoped grants; the UI preserves separate scopes and multiple site grants per permission. The shared permission catalog remains read-only to tenants; tenant-specific role changes do not mutate global `role_permissions`. Delegation is checked server-side against the actor's permissions, sensitive administration grants are reserved for the explicit system-administrator boundary, and cross-tenant sites, roles, users, and permissions are rejected. Employee reads support server-enforced site filtering. Other site-grant enforcement is intentionally limited to the API paths listed in the API document; it is not represented as comprehensive site scoping for every resource.

## Files and migration

- `frontend/backend/src/migrations/033_tenant_user_role_administration.sql` adds tenant memberships, tenant-owned roles/grants/assignments, password-reset tokens, login timestamps and lock state; it adds tenant-aware foreign keys and RLS/FORCE RLS to memberships, role assignments, sessions, grants, and reset tokens. Existing global role assignments and permission mappings are copied to tenant-owned roles/grants and ordinary legacy assignments are removed; explicitly marked system-administrator accounts retain their system assignment.
- `frontend/backend/src/controllers/userAdministrationController.ts`, `frontend/backend/src/app.ts`, and `frontend/backend/src/middleware/auth.ts` implement the administrative endpoints, permission/delegation checks, and tenant/site-aware authorization.
- `frontend/backend/src/controllers/authController.ts` and `frontend/backend/src/config/database.ts` extend session/password flows and isolate/reset database request context.
- `frontend/backend/src/controllers/employeeController.ts` enforces tenant and requested-site filters for employee reads.
- `frontend/backend/src/seeds/seed.ts` creates tenant role templates and memberships without changing the existing global role-grant model.
- `frontend/components/UserAdministration.tsx`, `frontend/App.tsx`, and `frontend/components/Sidebar.tsx` provide the API-backed administration screens.
- Focused coverage is in `frontend/backend/src/tests/userAdministrationController.test.ts`, `frontend/backend/src/tests/auth_site_scope.test.ts`, `frontend/backend/src/tests/migrations.test.ts`, updated integration fixtures, and `frontend/tests/UserAdministration.test.tsx`.

The migration is additive and tested on a fresh PostgreSQL 16 database with the existing migration runner. Existing user-role and session records are backfilled into membership rows before composite membership constraints are applied.

## API

The complete request/response contract and security limitations are in [`frontend/USER_ADMINISTRATION_API.md`](../../frontend/USER_ADMINISTRATION_API.md). Routes are under `/api/v1/admin/users`, `/api/v1/admin/roles`, and `/api/v1/admin/permissions`; own-password and reset completion routes are under `/api/v1/auth`. Tenant IDs are derived from the authenticated session for administrative routes. Reset tokens are returned only once, stored hashed, expire after 30 minutes, and are not emailed or texted because no delivery provider exists.

## Security and offline behavior

- Authentication continues to use Argon2id and opaque, hashed, revocable session cookies; browser mutations retain the existing Origin/CSRF checks.
- PostgreSQL tenant context is set from the authenticated session in a transaction. New policies use `NULLIF`-guarded UUID casts and safe connection-context cleanup.
- RLS and FORCE RLS plus tenant-aware membership constraints cover the new administration data and the pre-existing `user_roles` and `user_sessions` tables.
- User/role administration is online-only. Offline IDs or queued payloads do not confer permission; replay still requires current server authentication, tenant context, and authorization.
- Site scope currently covers the documented employee/admin-user filtered reads and the explicit allowlisted create paths only. `OWN` grants are not loaded because resource-specific owner filtering is not implemented. Other resource routes require tenant-wide grants.
- Reset-token delivery requires an administrator to use a separate secure channel. No email/SMS delivery is implemented or claimed.

## Tests and build evidence

| Check | Result |
|---|---|
| Fresh PostgreSQL 16 migration + seed + backend TypeScript build | Passed |
| Full backend Jest suite | **26 suites, 255 tests passed** |
| API persistence/tenant integration suite | **21 tests passed** |
| Migration upgrade/RLS suite | **68 tests passed**, including legacy-role backfill and system-admin boundary |
| Frontend Vitest suite | **16 files, 96 tests passed** |
| Frontend production build | Passed; existing Vite config-loader and large-chunk warnings remain |
| Production Compose configuration validation | Passed |
| Backend and frontend production Docker image builds | Passed |
| `git diff --check` | Passed |

Jest reports one open `TCPWRAP` handle originating in the existing patrol integration setup (`patrol.integration.test.ts:35`), and pg emits an existing concurrent-query deprecation warning; neither causes test failure.

## Documentation updated

The root and frontend READMEs now distinguish this PR worktree from `main` and retain the non-production-approved status. Directly affected administrator, authentication, business modules, database, deployment, installation, offline, system overview, user guide, and historical test/audit report documents were corrected or visibly labeled as historical. Unsupported compliance, backup, role-switching, architecture, and installation claims were removed or qualified. Phase 2's limitations and current PR status remain distinct from this implementation.

## Open problems and limitations

- This feature is not in `main`, is not deployed, and is not approved for production. The branch must be reviewed and merged by the repository owner; stacked changes may need restacking after the parent PRs merge.
- No reset-token email/SMS provider exists; secure out-of-band delivery is a manual operational responsibility.
- Site-level grants are deliberately partial, as described above; do not treat them as universal per-resource authorization.
- Administrative actions and roles work online only; offline work does not permit account or permission changes.
- There is no claim of legal compliance, DIN certification, or readiness of historical modules.
- Backend `npm audit` reports **7 LOW development-dependency findings** associated with GHSA-gcqx-w2h4 in `deepmerge@4.3.1` through Jest/`ts-jest`; production audit reports **0**. Upstream has no patched 4.x release, and forcing npm's suggested breaking Jest downgrade was not done.
- Existing Jest open-handle and pg deprecation warnings remain as test-hygiene work.
