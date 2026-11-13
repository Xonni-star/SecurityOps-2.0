# Service planning API (Phase 2, backend layer)

All endpoints are under `/api/v1`, require a bearer session, and use the exact permissions listed below. Requests and responses use JSON except the work-hours CSV option. Every database operation runs in a tenant-scoped transaction; no endpoint treats a locally queued mutation as published.

## Core contracts

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /planning/shifts` | `planning:read` | Paginated shifts; filters: `from`, `to`, `siteId`, `employeeId`, `planningStatus`, `page`, `pageSize` (max 200). |
| `POST /planning/shifts` | `planning:manage` | Create a server-validated draft shift. |
| `GET /planning/shifts/:id/assignments` | `planning:read` | Read staffing assignments. |
| `POST /planning/shifts/:id/assignments` | `planning:manage` | Assign an employee using `expectedVersion`. |
| `GET /planning/periods` | `planning:read` | Paginated schedule periods. |
| `POST /planning/periods` | `planning:manage` | Create a draft period. |
| `POST /planning/periods/:id/publish` | `planning:publish` | Revalidate every shift and publish atomically using `expectedVersion`. |
| `GET /planning/findings` | `planning:read` | Paginated stored findings; optional `shiftId`. |
| `GET /planning/rule-profiles` | `planning:read` | Paginated tenant profiles and their versions. |
| `POST /planning/rule-profiles` | `planning:rules:manage` | Create a profile and its first draft version. |
| `POST /planning/rule-profiles/:profileId/versions` | `planning:rules:manage` | Add a sourced, effective-dated draft version. |
| `POST /planning/rule-profiles/:profileId/versions/:versionId/approve` | `planning:rules:approve` | Approve a version; its creator cannot approve it. |
| `POST /planning/findings/:findingId/exceptions` | `planning:exceptions:manage` | Request an exception with a reason. |
| `POST /planning/exceptions/:exceptionId/decision` | `planning:exceptions:approve` | Approve/reject; requester cannot decide their own request. |
| `POST /planning/templates` | `planning:manage` | Create a daily or weekly local-time template. |
| `POST /planning/templates/:templateId/apply` | `planning:manage` | Generate draft occurrences; revalidation is still required before publish. |
| `GET /planning/reports/work-hours` | `planning:reports:read` | Planned hours/shift and weekend counts; accepts `from`, `to`, optional `format=csv`. |
| `GET /planning/reports/coverage` | `planning:reports:read` | Staffing coverage report. |
| `GET /planning/audit` | `planning:read` | Paginated audit events; optional `entityId`. |
| `POST /planning/shifts/:id/swaps` | `planning:swaps:manage` | Request a swap with `expectedShiftVersion`. |
| `GET /planning/swaps` | `planning:read` | Paginated swap requests. |
| `POST /planning/swaps/:requestId/decision` | `planning:swaps:approve` | Approve/reject with `expectedVersion`; approval revalidates the proposed employee. |

### Request shapes

Create a period with `{ "name", "dateFrom", "dateTo", "timeZone" }`, where dates are ISO local dates and `timeZone` is an IANA zone.

Create a shift with `{ "siteId", "schedulePeriodId?", "date", "endDate?", "startTime", "endTime", "startOffsetMinutes?", "endOffsetMinutes?", "breakMinutes?", "type?", "requiredQualification", "requiredStaffCount?", "employeeId?", "clientMutationId?" }`. Local times are interpreted in the site's configured IANA time zone. Offset values are minutes east of UTC (Berlin summer time is `120`). A nonexistent DST wall time is rejected; a repeated wall time requires its corresponding offset. Overnight shifts may omit `endDate`; an explicit `endDate` must result in a positive interval.

Assign an employee with `{ "employeeId", "expectedVersion", "breakMinutes?" }`. Publish a period with `{ "expectedVersion" }`. A stale revision returns `409` with `code: "REVISION_CONFLICT"`; a validation failure returns `422` with `code: "PLANNING_VALIDATION_FAILED"` and `data.findings`. Shift creation accepts `clientMutationId`: repeating the same payload returns the original shift with `200`; reusing the ID for different shift data returns `409` with `code: "IDEMPOTENCY_KEY_REUSED"`.

Rule profile creation requires `{ "name", "scope?", "effectiveFrom", "effectiveUntil?", "sourceName", "sourceReference", "rules" }`. Each rule is `{ "code", "value", "source", "severity?" }`. Supported configured rule codes are `minimum_rest_minutes`, `maximum_shift_minutes`, `maximum_weekly_minutes`, `minimum_break_minutes`, `break_after_minutes`, `disallowed_weekdays`, `sunday_work_allowed`, `holiday_dates`, `night_window_start_minute`, `night_window_end_minute`, and `night_work_allowed`. The server does not supply legal or tariff thresholds.

## Shift lifecycle and validation

All shift creation paths persist a draft. Sync mutations at `POST /sync/push` share the existing `clientUuid`/`baseVersion` idempotency and concurrency contract and must remain drafts; only the period publish endpoint can mark the period's shifts published. A shift linked to a period must fall wholly within its dates, and new shifts/templates cannot be added to a published period. Publication locks the period and shifts, checks assignments/required qualifications and current findings, and fails atomically on blocking findings. Published shifts reject direct edits/deletes (`409 SCHEDULE_PERIOD_PUBLISHED`); use the approved swap flow for a replacement. The legacy `POST/PATCH/DELETE /shifts` routes remain available; updates require a current `revisionVersion` and invoke the shared employee/availability validation, while deletes require the current revision and are blocked after publication.

Server checks reuse `employees`, `employee_qualifications`, `employee_absences`, `employee_site_assignments`, `sites`, and `clients`. They cover active employee status, site assignment, verified unexpired qualification, approved absence, overlaps, and configured rule-profile limits. Rule profile revisions carry a source name/reference, effective dates, and per-rule source tags; they must be explicitly approved before use. Exceptions are audited and only suppress an identical finding for the same shift/person, rather than waiving every future finding with the same rule code.

## Persistence and limitations

Migration `030_service_planning.sql` adds the planning schema, site IANA time zone, shift instants, tenant-aware foreign keys, `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY` on every new tenant table, and least-privilege app-role grants. A migration trigger preserves compatibility for legacy direct shift writes; API-created shifts use explicit DST-safe instant resolution.

Reports are JSON except for the work-hours CSV; no general-purpose export job or spreadsheet format is provided. Reports currently cover planned hours, weekend shifts, and staffing coverage, not payroll/overtime valuation, a legal-compliance determination, or every requested absence/holiday/night-work breakdown. Rule checking covers the configured codes above and cannot infer external laws, contracts, or tariffs. Template application creates drafts and reports nonexistent DST times per occurrence; full human review and publication remain mandatory. Offline sync remains supported by the existing shift mutation protocol, but this layer does not introduce a general idempotency-key mechanism for every planning endpoint or an offline workflow for approvals, swaps, and period publication.
