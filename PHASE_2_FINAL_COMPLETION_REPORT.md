# Phase 2 service planning — final status report

**Status snapshot:** 2026-11-13. This report records verified implementation and CI evidence; it does not declare Phase 2 complete, production-ready, or legally compliant.

## Pull requests and stack

| PR | State | Base | Verified head | CI |
|---|---|---|---|---|
| [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16) — backend planning | Open, unmerged | `main` | `c826460f0cc70e16031db93f8c5b0ccb8e3606da` | Run `43487585461`: Root, Frontend, Backend/PostgreSQL/Migration/Jest, and Production-Docker all passed. |
| [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) — planning UI | Open, unmerged | `xonni-star-phase-2-backend-planning` | `594b09734751e32a267c70d9906066798e0156ea` | Run `43492863751`: Root, Frontend/Vitest/Build, Backend/PostgreSQL/Migration/Jest, and Production-Docker all passed. |

Neither pull request has been merged. PR #19 includes the current PR #16 head as its base; the only merge conflict was `frontend/backend/SERVICE_PLANNING_API.md`. The PR #16 schemas and route documentation were retained, with the frontend integration boundaries reconciled to those contracts.

## Backend schema and API

Migrations `frontend/backend/src/migrations/030_service_planning.sql` and `031_planning_cover_actuals.sql` add schedule periods, templates, staffing requirements and assignments, versioned rule profiles/findings/exceptions, swaps, audit events, cover requests, and actual-time records. They also add site time zones, persisted shift interval/end-date handling, tenant-aware composite constraints, and `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` policies for the planning tenant tables.

The verified backend contract includes revisioned shift and period operations; template list/create/edit/activate/deactivate/apply; non-binding explainable staffing suggestions; cover and swap requests/decisions; actual-time create/correction plus current-record and audit-history reads; sourced rule-profile versions and approvals; audit and work-hours, coverage, qualification, and absence reports. Routes enforce their documented permissions, mutations use optimistic revisions and server-side validation, and idempotent operations use client mutation IDs where specified.

The PR #16 CI-verified routes used by the newly added UI workflows are `GET /planning/shifts/:id/staffing-suggestions` (non-binding candidate explanations), `PATCH /planning/templates/:templateId` (revision-checked edit/activation), `GET /planning/shifts/:id/actual-time?employeeId=...` (current record, revision, and history), and `POST /planning/shifts/:id/actual-time` (audited, version-checked record/correction). The UI also consumes the documented work-hours, coverage, qualification, and absence report routes; there is no separate actual-time approval route.

The frontend did not invent routes or change endpoint schemas. It consumes the routes documented by PR #16. Frontend-specific notes in `SERVICE_PLANNING_API.md` describe the online/offline boundary and the current UI use of those routes.

## Frontend behavior

The existing roster module, employee/site/client masters, API client, tenant-scoped cache, and IndexedDB outbox are reused. The UI now:

- Edits templates and activates/deactivates them with the loaded revision; inactive templates can be loaded. It does not expose hard delete or claim a dedicated template-copy route.
- Does not invent template pause/break, staffing-demand, or validity-date controls because the current contract lacks those fields. Template application currently creates one staffing requirement (`required_count=1`) and uses the database's 0-minute break default.
- Displays server staffing suggestions with eligibility reasons/findings and weekly scheduled minutes. The API only returns candidates passing its initial site/qualification filters; it does not enumerate prefiltered employees with individual exclusion reasons. Selecting a suggestion only fills the assignment control; the user must separately confirm assignment, which the server revalidates.
- Loads current actual-time values, persisted revision, and audit history when opening assigned shift details and when changing the selected employee. Corrections use the loaded server revision, including after reload.
- Displays nullable actual, overtime, weekend, holiday, and night report values with API status/source metadata rather than substituting zeroes. It separately shows actual-minus-planned variance, carrying the actual-data status; configured overtime remains a distinct metric. Coverage, qualification, and absence reports remain API-backed.
- Clears tenant/user-sensitive planning state on identity changes and ignores stale asynchronous detail/template responses.

After authenticated data hydration, generic outbox replay starts even when the app is already online. Every queued action must match the exact current tenant and user; ownerless legacy entries are not replayed. Offline queuing remains limited to supported shift draft/create and update workflows in the existing outbox. Assignment, cover/swap actions and decisions, template operations, actual-time reads/writes, rule-profile changes/approvals, reports, and publication stay online-only. Retry uses the existing stable mutation IDs.

The planning cache remains a single most-recently-loaded range per tenant/user, not a multi-range offline replica. Its dates are stored and the UI warns when an offline request is not fully covered, so empty out-of-range dates are not presented as confirmed absence of shifts. Shift conflict resolution is blocked in SyncManager until the backend returns a tenant-validated current shift snapshot; the current conflict receipt provides only version/status metadata.

## Security and integrity properties

Planning access is permission-gated by the backend, scoped by tenant-aware data access and row-level policies, and not authorized solely by frontend controls. Revisions protect concurrent edits; server-side validation is authoritative for assignments, decisions, and publication. Actual-time changes are audited, but audit history is not an independent approval. No route or endpoint schema was invented or changed in this frontend follow-up; the API spec additions document frontend boundaries and currently unavailable capabilities only.

The API rate limit is per-IP, with a default of 120 requests per minute. Its in-process counter is not shared across backend replicas. CSV handling neutralizes formula-leading text fields while preserving numeric report values.

## Verification

- Local frontend tests: `cd frontend && npm test` — 15 test files, 90 tests passed.
- Local production build: `cd frontend && npm run build` — passed. Vite emitted the existing `__dirname` config-loader warning and a bundle-size warning for a chunk above 500 kB.
- Frontend dependency audit: `cd frontend && npm audit` — 0 vulnerabilities.
- Backend dependency audit: `cd frontend/backend && npm audit` — 7 low findings in the Jest/`ts-jest` development-test toolchain, including `deepmerge` GHSA-gcqx-w48m-w2h4. `cd frontend/backend && npm audit --omit=dev` — 0 vulnerabilities. The suggested forced remediation is a breaking Jest downgrade; no dependency changes were made.
- PR #16 current-head CI: run `43487585461`, all four jobs passed at `c826460f0cc70e16031db93f8c5b0ccb8e3606da`.
- PR #19 current implementation-head CI: run `43492863751`, all four jobs passed at `594b09734751e32a267c70d9906066798e0156ea`.

## Remaining gaps and limits

- No hard-delete or dedicated copy endpoint for templates.
- Template pause/break configuration, configurable staffing demand, and validity dates are absent from the current API; related UI controls remain blocked pending the exact backend contract.
- No complete list or individual exclusion reasons for candidates filtered out before the staffing-suggestion evaluation.
- Shift conflict receipts do not include a tenant-validated current shift field snapshot yet; conflict actions remain disabled until that backend contract is available.
- No separate actual-time approval workflow; recorded values are not independently approved payroll results.
- No user-facing planning notifications.
- Rule-profile scope is tenant-wide or site-only; employee-group and employment-type scopes are not implemented.
- Rate limiting uses an in-memory store and is not coordinated across replicas; a shared gateway limit is needed for multi-replica deployments.
- Device/browser coverage, deployment operations, operational recovery, and domain/legal review have not been established by these checks. Configured rules and report values do not prove compliance with law, contracts, or policy.
