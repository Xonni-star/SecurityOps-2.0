# Phase 2 service planning — implementation and evidence status

**Status checked:** 2026-11-14
**Verified main commit:** `ed7f5f053849dc8e97b8ab79dfe2073f2974f73e`
**Project status:** In development; not approved for production.

The Phase 2 planning backend and frontend workflow PRs (#16–#19) are merged. This confirms implementation in the repository, not production readiness or legal compliance. Main CI run [43600456464](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43600456464) passed the four standard jobs at the verified main commit.

## Implementation in `main`

The planning module includes revisioned shifts and periods, templates, staffing requirements and suggestions, rule profiles and findings, cover/swap workflows, actual-time records and approvals, tenant/user-scoped notifications, audit history, and planning reports. Server-side permissions, tenant-aware data access, revisions, and validation are authoritative; UI controls alone do not authorize actions.

The frontend consumes the planning API for roster, templates, suggestions, actual-time review, notifications, reports, and eligible offline shift draft/create/update workflows. Offline planning data is limited to the most recently cached date range per tenant/user. Assignment and approval, template operations, reporting, rule-profile changes, notification reads, and other unsupported actions remain online-only. Planning notifications are in-app; external email/push delivery is not established.

There is no general claim that the planning module enforces working-time, rest-period, tariff, or other legal requirements. Actual-time approval is a workflow control, not a payroll result or legal determination.

## Open planning change: PR #33

[PR #33](https://github.com/Xonni-star/SecurityOps-2.0/pull/33), which adds an optional `maximum_daily_minutes` rule for active, approved profiles, remains **open and unmerged**. Its four standard CI jobs passed. On the PR revision, local backend/frontend builds, 26 roster tests, and focused PostgreSQL 16 integration checks for over-limit rejection and an exact-limit overnight assignment with breaks passed.

A separate clean-main comparison on fresh PostgreSQL 16 databases found the same 21 failing assertions in `sync_and_roles.test.ts` on baseline and feature (feature: 21 failed/10 passed; baseline: 21 failed/9 passed). The new daily-limit test passes. These are pre-existing baseline failures, not evidence that PR #33 introduced them.

## Evidence and remaining limits

| Evidence | Result | Scope limit |
|---|---|---|
| Main automated CI | Run 43600456464 passed root, frontend, backend/PostgreSQL, and Docker jobs on main. | Does not establish deployment, browser/device acceptance, or production workload behavior. |
| Merged planning PR CI | PRs #16–#19 are merged; their recorded four-job CI checks passed. | CI verifies the tested revisions, not operational acceptance. |
| PR #33 CI and focused local tests | All four standard CI jobs and the focused local checks listed above passed. | PR #33 remains unmerged; these changes are not in main. |
| Production and domain acceptance | Not established. | Deployment, operator recovery, browser/device coverage, and legal/domain review remain outstanding. |

The full backend development dependency tree retains a LOW `deepmerge@4.3.1` advisory with no safe patched version identified. It is an upstream development-dependency blocker, not a production dependency finding.

Earlier PR states, test totals, and run identifiers elsewhere in this historical report referred to 2026-11-13 and have been replaced by the current status above.
