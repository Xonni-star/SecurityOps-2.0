# Phase 2 service planning — final status report

**Status snapshot:** 2026-11-13. This report records verified implementation and CI evidence; it does not declare Phase 2 complete, production-ready, or legally compliant.

## Pull requests and stack

| PR | State | Base | Verified head | CI |
|---|---|---|---|---|
| [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16) — backend planning | Open, unmerged | `main` | `062154fc2e79639fd7dce1b837e6bb1076add363` | Run `43495705927`: Root, Frontend, Backend/PostgreSQL/Migration/Jest, and Production-Docker all passed. |
| [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) — planning UI | Open, unmerged | `xonni-star-phase-2-backend-planning` | Pending reconciliation commit/CI | Earlier head `db1ded865e59b94f8e38dabd62b3b45f9c0d193e` has all four jobs passed in run `43493681913`; current stack requires fresh checks. |

Neither pull request has been merged. PR #19 includes the current PR #16 head as its base; the only merge conflict was `frontend/backend/SERVICE_PLANNING_API.md`. The PR #16 schemas and route documentation were retained, with the frontend integration boundaries reconciled to those contracts.

## Backend schema and API

Migrations `frontend/backend/src/migrations/030_service_planning.sql`, `031_planning_cover_actuals.sql`, and `032_planning_approvals_templates_notifications.sql` add schedule periods, templates, staffing requirements and assignments, versioned rule profiles/findings/exceptions, swaps, audit events, cover requests, and actual-time records with approval/history. They also add site time zones, persisted shift interval/end-date handling, template break/demand/effective-date fields, tenant-scoped notifications, tenant-aware composite constraints, and `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` policies for the planning tenant tables.

The verified backend contract includes revisioned shift and period operations; template list/create/edit/activate/deactivate/apply; non-binding explainable staffing suggestions with capped exclusion reason codes; cover and swap requests/decisions; actual-time create/correction, independent approval, and current-record/revision/audit-history reads; tenant/user-scoped planning inbox/read endpoints; sourced rule-profile versions and approvals; audit and work-hours, coverage, qualification, and absence reports. Routes enforce their documented permissions, mutations use optimistic revisions and server-side validation, and idempotent operations use client mutation IDs where specified.

The PR #16 CI-verified routes used by the UI include `GET /planning/shifts/:id/staffing-suggestions`, `PATCH /planning/templates/:templateId`, actual-time read/record/correction plus `POST /planning/shifts/:id/actual-time/approve`, `GET /planning/notifications`, and `POST /planning/notifications/:notificationId/read`. Work-hours reports include `hours_variance`, `minus_hours`, and their status/source fields; the UI also consumes coverage, qualification, and absence reports.

The frontend did not invent routes or change endpoint schemas. It consumes the routes documented by PR #16. Frontend-specific notes in `SERVICE_PLANNING_API.md` describe the online/offline boundary and the current UI use of those routes.

## Frontend behavior

The existing roster module, employee/site/client masters, API client, tenant-scoped cache, and IndexedDB outbox are reused. The UI now:

- Edits templates and activates/deactivates them with the loaded revision; inactive templates can be loaded. It does not expose hard delete or claim a dedicated template-copy route.
- Creates and revision-edits templates with break duration, staffing demand, and inclusive effective dates; applies only active templates to draft shifts. Hard delete and a dedicated copy endpoint remain unavailable.
- Displays server staffing suggestions, eligibility findings, weekly scheduled minutes, and capped ID-only exclusion reasons. Selecting a suggestion only fills the assignment control; the user must separately confirm assignment, which the server revalidates.
- Loads current actual-time values, persisted revision, approval state, and audit history when opening assigned shift details and when changing the selected employee. Corrections use the loaded server revision; a permitted different user can independently approve the current revision, and corrections return it to pending.
- Displays nullable captured and approved actual hours, server-provided `hours_variance`/`minus_hours`, and status/source metadata rather than substituting zeroes. Configured overtime remains a distinct metric. Coverage, qualification, and absence reports remain API-backed.
- Loads and marks read in-app planning notifications for the authenticated user; the backend contract does not provide email/push delivery.
- Clears tenant/user-sensitive planning state on identity changes and ignores stale asynchronous detail/template responses.

After authenticated data hydration, generic outbox replay starts even when the app is already online. Every queued action must match the exact current tenant and user; ownerless legacy entries are not replayed. Offline queuing remains limited to supported shift draft/create and update workflows in the existing outbox. Assignment, cover/swap actions and decisions, template operations, actual-time reads/writes/approval, notification reads, rule-profile changes/approvals, reports, and publication stay online-only. Retry uses the existing stable mutation IDs.

The planning cache remains a single most-recently-loaded range per tenant/user, not a multi-range offline replica. The UI discloses this limitation and warns when an offline request is not fully covered, so empty out-of-range dates are not presented as confirmed absence of shifts. Shift conflict resolution displays the tenant-validated current shift snapshot from the current sync receipt before enabling a resolution.

## Security and integrity properties

Planning access is permission-gated by the backend, scoped by tenant-aware data access and row-level policies, and not authorized solely by frontend controls. Revisions protect concurrent edits; server-side validation is authoritative for assignments, decisions, approval, and publication. Actual-time changes and approvals are audited. No route or endpoint schema was invented or changed in this frontend follow-up; the API spec additions document frontend boundaries and current UI usage.

The API rate limit is per-IP, with a default of 120 requests per minute. Its in-process counter is not shared across backend replicas. CSV handling neutralizes formula-leading text fields while preserving numeric report values.

## Verification

- Local frontend tests: `cd frontend && npm test` — 15 test files, 94 tests passed.
- Local production build: `cd frontend && npm run build` — passed. Vite emitted the existing `__dirname` config-loader warning and a bundle-size warning for a chunk above 500 kB.
- Frontend dependency audit: `cd frontend && npm audit` — 0 vulnerabilities.
- Backend dependency audit: `cd frontend/backend && npm audit` — 7 low findings in the Jest/`ts-jest` development-test toolchain, including `deepmerge` GHSA-gcqx-w48m-w2h4. `cd frontend/backend && npm audit --omit=dev` — 0 vulnerabilities. The suggested forced remediation is a breaking Jest downgrade; no dependency changes were made.
- PR #16 current-head CI: run `43495705927`, all four jobs passed at `062154fc2e79639fd7dce1b837e6bb1076add363`.
- PR #19 reconciliation-head CI: pending.

## Remaining gaps and limits

- No hard-delete or dedicated copy endpoint for templates.
- Staffing-suggestion exclusion details are capped at 50 per requirement and cover the documented main active/site/qualification filters; they are not a complete explanation of every potential eligibility decision.
- Actual-time approval is a workflow control only; it does not establish a payroll result or legal compliance.
- Planning notifications are in-app only; email/push delivery is not implemented.
- Offline planning remains limited to the single most-recently-cached date range per tenant/user.
- Rule-profile scope is tenant-wide or site-only; employee-group and employment-type scopes are not implemented.
- Rate limiting uses an in-memory store and is not coordinated across replicas; a shared gateway limit is needed for multi-replica deployments.
- Device/browser coverage, deployment operations, operational recovery, and domain/legal review have not been established by these checks. Configured rules and report values do not prove compliance with law, contracts, or policy.
