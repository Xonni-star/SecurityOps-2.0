# Phase 2 service planning — final status report

**Status snapshot:** 2026-11-13. This report records verified implementation and CI evidence; it does not declare Phase 2 complete, production-ready, or legally compliant.

## Pull requests and stack

| PR | State | Base | Verified head | CI |
|---|---|---|---|---|
| [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16) — backend planning | Open, unmerged | `main` | `c826460f0cc70e16031db93f8c5b0ccb8e3606da` | Run `43487585461`: Root, Frontend, Backend/PostgreSQL/Migration/Jest, and Production-Docker all passed. |
| [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) — planning UI | Open, unmerged | `xonni-star-phase-2-backend-planning` | `05865dd538da3c1c7836253d43c42081b01da67f` | Run `43488469839`: Root, Frontend/Vitest/Build, Backend/PostgreSQL/Migration/Jest, and Production-Docker all passed on this implementation head. A later report-only commit triggers another run. |

Neither pull request has been merged. PR #19 includes the current PR #16 head as its base; the only merge conflict was `frontend/backend/SERVICE_PLANNING_API.md`. The PR #16 schemas and route documentation were retained, with the frontend integration boundaries reconciled to those contracts.

## Backend schema and API

Migrations `frontend/backend/src/migrations/030_service_planning.sql` and `031_planning_cover_actuals.sql` add schedule periods, templates, staffing requirements and assignments, versioned rule profiles/findings/exceptions, swaps, audit events, cover requests, and actual-time records. They also add site time zones, persisted shift interval/end-date handling, tenant-aware composite constraints, and `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` policies for the planning tenant tables.

The verified backend contract includes revisioned shift and period operations; template list/create/edit/activate/deactivate/apply; non-binding explainable staffing suggestions; cover and swap requests/decisions; actual-time create/correction plus current-record and audit-history reads; sourced rule-profile versions and approvals; audit and work-hours, coverage, qualification, and absence reports. Routes enforce their documented permissions, mutations use optimistic revisions and server-side validation, and idempotent operations use client mutation IDs where specified.

The frontend did not invent routes or change endpoint schemas. It consumes the routes documented by PR #16. Frontend-specific notes in `SERVICE_PLANNING_API.md` describe the online/offline boundary and the current UI use of those routes.

## Frontend behavior

The existing roster module, employee/site/client masters, API client, tenant-scoped cache, and IndexedDB outbox are reused. The UI now:

- Edits templates and activates/deactivates them with the loaded revision; inactive templates can be loaded. It does not expose hard delete or claim a dedicated template-copy route.
- Displays server staffing suggestions with eligibility reasons/findings and weekly scheduled minutes. Selecting a suggestion only fills the assignment control; the user must separately confirm assignment, which the server revalidates.
- Loads current actual-time values, persisted revision, and audit history when opening assigned shift details and when changing the selected employee. Corrections use the loaded server revision, including after reload.
- Displays nullable actual, overtime, weekend, holiday, and night report values with API status/source metadata rather than substituting zeroes. Coverage, qualification, and absence reports remain API-backed.
- Clears tenant/user-sensitive planning state on identity changes and ignores stale asynchronous detail/template responses.

Offline queuing remains limited to the supported shift draft/create and update workflows in the existing outbox. Assignment, cover/swap actions and decisions, template operations, actual-time reads/writes, rule-profile changes/approvals, reports, and publication stay online-only. No unsupported action is presented as an offline mutation.

## Security and integrity properties

Planning access is permission-gated by the backend, scoped by tenant-aware data access and row-level policies, and not authorized solely by frontend controls. Revisions protect concurrent edits; server-side validation is authoritative for assignments, decisions, and publication. Actual-time changes are audited, but audit history is not an independent approval.

The API rate limit is per-IP, with a default of 120 requests per minute. Its in-process counter is not shared across backend replicas. CSV handling neutralizes formula-leading text fields while preserving numeric report values.

## Verification

- Local frontend tests: `cd frontend && npm test` — 14 test files, 83 tests passed.
- Local production build: `cd frontend && npm run build` — passed. Vite emitted the existing `__dirname` config-loader warning and a bundle-size warning for a chunk above 500 kB.
- PR #16 current-head CI: run `43487585461`, all four jobs passed at `c826460f0cc70e16031db93f8c5b0ccb8e3606da`.
- PR #19 implementation-head CI: run `43488469839`, all four jobs passed at `05865dd538da3c1c7836253d43c42081b01da67f`.

The report-only commit is separate from the verified implementation head above; its follow-up CI status is not represented by run `43488469839`.

## Remaining gaps and limits

- No hard-delete or dedicated copy endpoint for templates.
- No separate actual-time approval workflow; recorded values are not independently approved payroll results.
- No user-facing planning notifications.
- Rule-profile scope is tenant-wide or site-only; employee-group and employment-type scopes are not implemented.
- Rate limiting uses an in-memory store and is not coordinated across replicas; a shared gateway limit is needed for multi-replica deployments.
- Device/browser coverage, deployment operations, operational recovery, and domain/legal review have not been established by these checks. Configured rules and report values do not prove compliance with law, contracts, or policy.
