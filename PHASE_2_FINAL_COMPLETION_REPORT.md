# Phase 2 service planning — implementation and evidence status

**Status checked:** 2026-11-14

**Verified main commit:** `e2d57f6def5a5f48d1454f34d5935787fb2bb90b`

**Project status:** In development; not approved for production.

The Phase 2 planning backend and frontend workflow PRs (#16–#19) are merged. Configurable daily, weekly, and monthly work limits from PRs #33 and #36 are present in current `main`; no PRs were open when checked. This confirms implementation in the repository, not production readiness or legal compliance.

## Implementation in `main`

The planning module includes revisioned shifts and periods, templates, staffing requirements and suggestions, rule profiles and findings, cover/swap workflows, actual-time records and approvals, tenant/user-scoped notifications, audit history, and planning reports. Server-side permissions, tenant-aware data access, revisions, and validation are authoritative; UI controls alone do not authorize actions.

The frontend consumes the planning API for roster, templates, suggestions, actual-time review, notifications, reports, and eligible offline shift draft/create/update workflows. Offline planning data is limited to the most recently cached date range per tenant/user. Assignment and approval, template operations, reporting, rule-profile changes, notification reads, and other unsupported actions remain online-only. Planning notifications are in-app; external email/push delivery is not established.

Merged PRs #33 and #36 add optional `maximum_daily_minutes`, `maximum_weekly_minutes`, and `maximum_monthly_minutes` rules for active, approved profiles. These configured rules do not provide a general working-time, rest-period, tariff, or legal-compliance determination. Actual-time approval is a workflow control, not a payroll result or legal determination.

## Automated and focused validation

| Evidence | Result | Scope limit |
|---|---|---|
| Main automated CI | Run [43609474644](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43609474644) passed all seven jobs on current `main`, including backend PostgreSQL/Jest, frontend tests/build, DMS API/scanner integration, full-schema restore, and Docker checks. | Does not establish deployment, browser/device acceptance, or production workload behavior. |
| Release artifacts | Run [43609786489](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43609786489) successfully built the package from CI artifacts. | Artifact generation is not a production deployment or acceptance. |
| Focused PR #33 checks | Previously recorded local backend/frontend builds, 26 roster tests, and two focused PostgreSQL 16 DST tests passed on the change later merged as PR #33. Berlin spring-forward 00:00–04:00 counted as 180 elapsed minutes and fall-back 00:00–04:00 as 300 minutes. | These are targeted implementation tests, not browser/device acceptance or legal/domain review. |

## Evidence and remaining limits

- Implementation of the merged planning workflows and configured daily, weekly, and monthly limits is established by code on `main`.
- Current automated main CI passed; the release-artifact workflow built a package, but neither result establishes a production rollout.
- No production installation, external-provider acceptance, operational acceptance, or browser/device acceptance has been established.
- Legal/domain review remains outstanding; no claim of working-time, rest-period, tariff, or other legal compliance is made.

The backend development dependency tree's last recorded audit identified a LOW `deepmerge@4.3.1` advisory in Jest/`ts-jest` development dependencies. The production-only audit found no production findings at that snapshot.
