# Service planning API (Phase 2, backend layer)

This document is the stable backend contract for the Phase 2 frontend integration. Paths below are relative to `/api/v1`. Every route requires an authenticated bearer session and the exact permission shown; requests/responses are JSON unless noted. Data is tenant-scoped server-side. Dates are `YYYY-MM-DD`; times are local `HH:mm[:ss]` unless an API explicitly requires an offset timestamp.

## Routes and permissions

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /planning/shifts` | `planning:read` | Paginated shifts; filters: `from`, `to`, `siteId`, `employeeId`, `planningStatus`, `page`, `pageSize` (1–200, default 50). |
| `POST /planning/shifts` | `planning:manage` | Create a server-validated draft shift, optionally linked to a draft period. |
| `GET /planning/shifts/:id/assignments` | `planning:read` | List current and released staffing assignments. |
| `POST /planning/shifts/:id/assignments` | `planning:manage` | Assign an employee after full server-side revalidation. |
| `GET /planning/shifts/:id/staffing-suggestions` | `planning:read` | Explainable, non-binding qualified candidate suggestions; supports `page`, `pageSize` (1–50, default 20). |
| `GET /planning/periods` | `planning:read` | Paginated schedule periods. |
| `POST /planning/periods` | `planning:manage` | Create a draft schedule period. |
| `POST /planning/periods/:id/publish` | `planning:publish` | Revalidate and publish a period atomically. |
| `GET /planning/findings` | `planning:read` | Paginated stored findings; optional `shiftId`. |
| `GET /planning/templates` | `planning:read` | Paginated recurring templates; optional `siteId`, `includeInactive=true`. |
| `POST /planning/templates` | `planning:manage` | Create a daily or weekly local-time template. |
| `PATCH /planning/templates/:templateId` | `planning:manage` | Revision-checked template edit or activation/deactivation. |
| `POST /planning/templates/:templateId/apply` | `planning:manage` | Generate draft occurrences across a bounded date range. |
| `GET /planning/rule-profiles` | `planning:read` | Paginated profiles with version summaries. |
| `GET /planning/rule-profiles/:profileId/versions` | `planning:read` | Paginated profile revisions. |
| `POST /planning/rule-profiles` | `planning:rules:manage` | Create a profile and its first draft version. |
| `POST /planning/rule-profiles/:profileId/versions` | `planning:rules:manage` | Add a sourced, effective-dated draft version. |
| `PATCH /planning/rule-profiles/:profileId` | `planning:rules:manage` | Activate/deactivate a profile with `{ "active": boolean }`. |
| `POST /planning/rule-profiles/:profileId/versions/:versionId/approve` | `planning:rules:approve` | Approve a draft version; its creator cannot approve it. |
| `POST /planning/findings/:findingId/exceptions` | `planning:exceptions:manage` | Request an exception with a reason. |
| `POST /planning/exceptions/:exceptionId/decision` | `planning:exceptions:approve` | Approve/reject an exception; requester cannot decide it. |
| `POST /planning/shifts/:id/swaps` | `planning:swaps:manage` | Request a shift swap. |
| `GET /planning/swaps` | `planning:read` | Paginated swaps; optional `status`. |
| `POST /planning/swaps/:requestId/decision` | `planning:swaps:approve` | Approve/reject a swap; approval revalidates the proposed employee. |
| `POST /planning/shifts/:id/cover-requests` | `planning:covers:manage` | Request coverage for an unfilled shift. |
| `GET /planning/cover-requests` | `planning:read` | Paginated cover requests; optional `status`, `shiftId`. |
| `POST /planning/cover-requests/:requestId/decision` | `planning:covers:approve` | Approve/reject coverage; approval validates and assigns the employee. |
| `GET /planning/shifts/:id/actual-time` | `planning:read` | Read the current actual-time record/version and its audit history for `employeeId`. |
| `POST /planning/shifts/:id/actual-time` | `planning:actuals:manage` | Record or correct an assigned employee's actual time, with audit and optimistic versioning. |
| `POST /planning/shifts/:id/actual-time/approve` | `planning:actuals:approve` | Approve the current actual-time revision; the recorder cannot approve their own entry. |
| `GET /planning/notifications` | `planning:read` | Read the authenticated user's tenant-scoped planning inbox. |
| `POST /planning/notifications/:notificationId/read` | `planning:read` | Mark only the authenticated user's notification as read. |
| `GET /planning/reports/work-hours` | `planning:reports:read` | Planned/actual work hours and configured calendar/overtime summaries; optional `format=csv`. |
| `GET /planning/reports/coverage` | `planning:reports:read` | Shift staffing demand and qualified coverage. |
| `GET /planning/reports/qualifications` | `planning:reports:read` | Qualification supply and demand within a date range. |
| `GET /planning/reports/absences` | `planning:reports:read` | Absence records and affected employees within a date range. |
| `GET /planning/audit` | `planning:read` | Paginated planning audit events; optional `entityId`. |

## Shift and period contracts

Create a period:

```json
{ "name": "January plan", "dateFrom": "2027-01-01", "dateTo": "2027-01-31", "timeZone": "Europe/Berlin" }
```

The response is `{ "success": true, "data": { "id", "name", "date_from", "date_to", "time_zone", "status", "revision_version", ... } }`. `GET /planning/periods` returns the same row shape in `data[]` plus `{ "page", "pageSize", "total", "pages" }`.

Create a shift:

```json
{
  "siteId": "uuid",
  "schedulePeriodId": "uuid",
  "employeeId": "uuid",
  "clientMutationId": "client-generated-key",
  "date": "2027-01-10",
  "endDate": "2027-01-12",
  "startTime": "08:00",
  "endTime": "08:00",
  "startOffsetMinutes": 60,
  "endOffsetMinutes": 60,
  "breakMinutes": 30,
  "type": "Tagdienst",
  "requiredQualification": "Sachkunde",
  "requiredStaffCount": 2
}
```

`employeeId`, `schedulePeriodId`, `clientMutationId`, `endDate`, offsets, `breakMinutes`, `type`, and `requiredStaffCount` are optional; required staffing defaults to 1, break to 0, and type to `Tagdienst`. `date` and `endDate` are local dates. If `endDate` is omitted, an end time earlier than or equal to the start time means the following local date; otherwise the same date. An explicitly supplied end date is persisted and honored during every later revalidation. The site’s IANA zone is authoritative. A DST-gap local time is rejected; an ambiguous local time requires the corresponding offset in minutes east of UTC. `startOffsetMinutes`/`endOffsetMinutes` are optional when the local time is unambiguous.

Success response: `{ "success": true, "data": { "replayed": false, "shift": { "id", "site_id", "shift_date", "end_date", "start_time", "end_time", "starts_at", "ends_at", "time_zone", "break_minutes", "type", "status", "planning_status", "required_qualification", "schedule_period_id", "revision_version" }, "validationRunId": "uuid", "findings": [] } }`. A matching idempotent retry returns HTTP 200 and `replayed: true`; a create returns HTTP 201. Reusing the mutation ID for different shift data returns HTTP 409 `IDEMPOTENCY_KEY_REUSED`.

`GET /planning/shifts` returns `{ "success": true, "data": [shift, ...], "pagination": { "page", "pageSize", "total", "pages" } }`. Each row includes site name/time zone, shift start/end dates and instants, revision/status, `assigned_count`, and `required_count` for the primary required qualification. `required_count` defaults to 1 for legacy shifts. Assignment listing returns `data[]` rows with assignment/employee IDs, names, status, revision and assignment/release timestamps.

Assign with `{ "employeeId": "uuid", "expectedVersion": 1, "breakMinutes": 30 }`. A success response has `data.assignmentId` and the incremented `data.revisionVersion`. A stale version returns 409 `REVISION_CONFLICT`; a blocking validation result returns 409 `PLANNING_VALIDATION_FAILED` with `data.findings[]` and `data.validationRunId`.

Get non-binding staffing suggestions with:

```http
GET /planning/shifts/:id/staffing-suggestions?page=1&pageSize=20
```

The response is `{ "success": true, "data": { "shiftId": "uuid", "requirements": [{ "qualificationType", "requiredCount", "assignedCount", "shortfall", "candidates": [{ "employeeId", "firstName", "lastName", "eligible", "scheduledMinutesThisWeek", "reasons": [], "findings": [] }], "excludedCandidates": [{ "employeeId", "reasons": ["inactive_or_archived" | "site_not_assigned" | "qualification_missing" | "qualification_unverified" | "qualification_invalid" | "qualification_expired"] }], "excludedCandidateCount", "excludedCandidatesTruncated", "pagination": { "page", "pageSize", "total", "pages" } }], "finalAssignmentRequiresConfirmation": true } }`. Exclusion details contain IDs/reason codes only (not employee names), are capped at 50 per requirement, and are limited to the main active/site/qualification filters. Candidates are active, site-assigned employees with the required verified qualification valid through the shift's end date. Each is rechecked for approved absences, overlapping work, configured work/rest rules, and current availability. Eligible candidates are ordered by scheduled minutes in their local Monday–Sunday week, then name and ID; this is a deterministic workload ordering, not a legal or fairness guarantee. Blocking findings make a candidate ineligible. Suggestions do not assign staff; use the assignment endpoint to revalidate and commit a selection.

Publish with `{ "expectedVersion": 1 }`. It returns `{ "success": true, "data": { "period": { "id", "status", "revision_version", "published_at" }, "runIds": [] } }`. It locks and revalidates all non-cancelled shifts and assignments, including the complete persisted interval and period boundaries; any blocking finding leaves the period unpublished and returns 422. Successful publication increments period and shift revisions. Published schedules cannot be directly changed or deleted.

## Templates

Create:

```json
{
  "siteId": "uuid",
  "name": "Night coverage",
  "timeZone": "Europe/Berlin",
  "startTime": "22:00",
  "endTime": "06:00",
  "breakMinutes": 30,
  "requiredStaffCount": 2,
  "requiredQualification": "Sachkunde",
  "effectiveFrom": "2027-01-01",
  "effectiveUntil": "2027-12-31",
  "frequency": "DAILY",
  "interval": 1,
  "weekdays": [1, 2, 3, 4, 5]
}
```

`timeZone`, `interval`, `weekdays`, `breakMinutes`, `requiredStaffCount`, `effectiveFrom` and `effectiveUntil` are optional; defaults are the site's zone, interval 1, no break and one staff member. Frequency is `DAILY` or `WEEKLY`; weekly templates require weekday integers 0–6 (Sunday=0). Effective dates are inclusive. Create returns 201 and a row with template ID, site, local times, break, staffing demand, effective dates, recurrence, active flag, and revision. Listing returns the same rows plus pagination.

Apply with `{ "dateFrom": "2027-01-01", "dateTo": "2027-01-31", "schedulePeriodId?": "uuid", "clientMutationId": "key" }`; the period ID is optional. The range is at most 366 days. Response: `{ "success": true, "data": { "occurrences": [{ "date", "status", "shiftId?", "findings?" }], "finalValidationRequired": true, "replayed?": true } }`. Valid occurrences are `draft`, carry the template break and qualification staffing demand, and must be within the inclusive effective dates. Out-of-validity occurrences, nonexistent/ambiguous local times, and occurrences whose end date exceeds the selected period are `REJECTED` with blocking findings and are not inserted. An out-of-range request or non-draft period is rejected at request level. An identical mutation retry returns 200 with `replayed: true`; reusing the key with a different template/range/period returns 409 `IDEMPOTENCY_KEY_REUSED`.

Edit, activate, or deactivate using a partial template body and the current `expectedVersion`:

```json
{ "expectedVersion": 2, "active": false }
```

Editable fields are `siteId`, `name`, `timeZone`, `startTime`, `endTime`, `breakMinutes`, `requiredStaffCount`, `requiredQualification`, `effectiveFrom`, `effectiveUntil`, `frequency`, `interval`, and `weekdays`; `active` toggles future use and provides archive/deactivation semantics. `effectiveFrom`/`effectiveUntil` may be cleared with `null`. The response is `{ "success": true, "data": <template row with revision_version> }`. A stale version returns 409 `REVISION_CONFLICT` with `currentVersion`; malformed, empty, or incomplete weekly recurrence updates are rejected. Applying an inactive template returns 404. Template edits affect future applications only; shifts already generated remain unchanged. Apply locks the template for the duration of generation, while edits lock the template row, preventing mixed-revision occurrences. There is no hard-delete or dedicated copy endpoint; copy by creating a new template with the desired fields.

## Rule profiles and exceptions

Create a profile (creates version 1 in `draft`):

```json
{
  "name": "Site rules",
  "scope": { "siteId": "uuid" },
  "effectiveFrom": "2027-01-01",
  "effectiveUntil": "2027-12-31",
  "sourceName": "Published source",
  "sourceReference": "https://example.invalid/reference",
  "rules": [{ "code": "maximum_shift_minutes", "value": 600, "source": "section or dataset" }]
}
```

Each rule is `{ "code", "value", "source", "severity?" }`; severity is `blocking` by default or `warning`. Supported codes: `minimum_rest_minutes`, `maximum_shift_minutes`, `maximum_daily_minutes`, `maximum_weekly_minutes`, `maximum_monthly_minutes`, `overtime_threshold_weekly_minutes`, `minimum_break_minutes`, `break_after_minutes`, `disallowed_weekdays`, `weekend_weekdays`, `sunday_work_allowed`, `holiday_dates`, `night_window_start_minute`, `night_window_end_minute`, and `night_work_allowed`. Values are numbers, booleans, or arrays appropriate to the code (weekday numbers are 0–6; holiday dates are ISO local dates). `maximum_daily_minutes` sums assigned work with the candidate by local calendar date, and `maximum_monthly_minutes` by local calendar month, in the candidate site's resolved IANA time zone. Shifts crossing a respective boundary are split at local midnight or the first of the month; each shift's configured break is apportioned proportionally across its segments and deducted once in total. Findings use the configured severity/source and approved profile version; no daily, weekly, or monthly limit is applied unless its rule is present in the selected active, approved version. Rule codes cannot be repeated within a version. The currently supported profile scope is tenant-wide `{}` or one site `{ "siteId": "uuid" }`; employee-group and employment-type scopes from the broader target specification are not implemented. Site-scoped profiles take precedence over tenant-wide profiles as a whole (rules are not merged). If multiple approved versions at the selected scope apply to the same date, scheduling validation blocks with `RULE_PROFILE_AMBIGUOUS` instead of silently selecting one. The tenant supplies every threshold/calendar value and its source; the application does not assert legal or tariff compliance.

Create returns `{ "success": true, "data": { "profile": { "id", "name", "scope" }, "version": { "id", "profile_id", "version_number", "effective_from", "effective_until", "source_name", "source_reference", "rules", "status" } } }`. Profile listing includes `version_id`, `version_number`, source/effective dates, rules, draft/approved status, and approval metadata. Version listing returns those version fields in `data[]` plus pagination. Activate/deactivate with `{ "active": true }`. Approve with an empty JSON object; creator self-approval is forbidden (403), and only draft versions can be approved (409). Only active, approved, effective versions apply.

Request an exception with `{ "reason": "..." }` (minimum 5 characters); response `data` contains the finding ID, reason, pending status, and requester/time. Decide with `{ "decision": "approved" | "rejected", "note?": "..." }`; requester self-approval is forbidden. Exceptions are audited and suppress only the matching finding for the same shift/person, not future findings with the same rule code.

## Cover, swaps, and actual time

Create a cover request with `{ "requestedEmployeeId?": "uuid", "expectedShiftVersion": 1, "clientMutationId": "key", "reason": "..." }`. It returns 201 with the request row: ID, shift, requested employee, reason, pending status, revision, request version, requester and timestamp. Identical retries return 200; reusing the key with a different payload returns 409. Listing returns request rows with optional employee names and pagination.

Decide with `{ "decision": "approved" | "rejected", "expectedVersion": 1, "employeeId?": "uuid", "clientMutationId": "key", "decisionNote?": "..." }`. Approval requires an employee ID, either on the request or in the decision, and revalidates the current shift version, employee availability, qualifications, period and configured rules before assigning. A validation failure is 422; stale shift/request revisions are 409. Requesters cannot decide their own request.

Create a swap request with `{ "requesterEmployeeId": "uuid", "proposedEmployeeId": "uuid", "expectedShiftVersion": 1, "reason": "..." }`; requester must already be assigned. Response `data` includes request ID, shift/requester/proposed employee, pending status, revision and request time. Decide with `{ "decision": "approved" | "rejected", "expectedVersion": 1, "decisionNote?": "..." }`. Approval revalidates the proposed employee against the complete shift interval before swapping assignments. Swap and cover decisions are audited.

Record/correct actual time with:

```json
{
  "employeeId": "uuid",
  "actualStartAt": "2027-01-10T08:03:00+01:00",
  "actualEndAt": "2027-01-10T16:05:00+01:00",
  "breakMinutes": 30,
  "expectedVersion": 0,
  "clientMutationId": "key",
  "notes": "optional"
}
```

Timestamps must include an explicit offset and actual end must be after start; break cannot exceed elapsed duration. The employee must have an active assignment. Use version `0` to create the first record and the current `revision_version` to correct it. First save returns 201; a correction returns 200 with `data` containing actual ID, shift/employee IDs, timestamps, break, revision, recorder/time and notes. Identical retries return the saved response; key reuse with different content returns 409 `IDEMPOTENCY_KEY_REUSED`. Every create/correction writes an audit event.

Captured and corrected actual time remains `approval_status: "pending"` and is not included in approved `actual_hours`, overtime, or planned-versus-actual variance. Approve the current revision with `{ "employeeId": "uuid", "expectedVersion": 2 }` using `POST /planning/shifts/:id/actual-time/approve`; the recorder cannot self-approve (403 `ACTUAL_TIME_SELF_APPROVAL_FORBIDDEN`), stale revisions return 409, and success returns the current record with `approval_status: "approved"`, `approved_by`, `approved_at`, and `approved_revision_version`. A correction increments `revision_version` and resets approval to pending. The database trigger snapshots the prior row for every update and rejects unversioned actual-value changes; the API additionally writes actor/action audit events. This is a workflow control, not a claim of payroll/legal compliance.

Read the current record after reload with `GET /planning/shifts/:id/actual-time?employeeId=<uuid>`. It returns `{ "success": true, "data": { "current": actualTime|null, "history": [{ "id", "actor_user_id", "event_type", "details", "created_at" }], "revisions": [{ "id", "revision_version", "previous_values", "created_at" }] } }`. `current` contains the persisted `revision_version` needed as the next `expectedVersion`; when no record exists it is `null` and both arrays are empty. `history` contains immutable API audit events; `revisions` is the DB-triggered prior-row snapshot history. A foreign or missing shift returns 404.

## Reports and audit

All reports require `from` and `to` ISO dates and allow at most 367 inclusive calendar days. Work-hours JSON is `{ "success": true, "data": [employeeSummary, ...], "range": { "from", "to" } }`. Each employee summary includes assigned shift count, `planned_hours`, nullable `captured_actual_hours`/`captured_actual_status`, nullable approved `actual_hours`/`actual_status`, `actual_approval_status`, nullable `hours_variance` (approved actual minus planned), nullable nonnegative `minus_hours`, `hours_variance_status` (`unavailable`, `partial`, `pending_approval`, `available`) and `hours_variance_source: "approved_actual_hours_minus_planned_hours"`. These fields are only available once approved actuals exist for every assigned shift in the report range; they are source/availability metadata, not configured overtime or a legal account. `overtime_hours` and `overtime_status` (`unavailable`, `partial`, `unconfigured`, `ambiguous`, `available`) are separate, derived from configured weekly thresholds. `overtime_sources` and planned/actual weekend, holiday, and night shift summaries are also included. The nested `calendar` object has per metric `{ "plannedShifts": number|null, "plannedStatus", "actualShifts": number|null, "actualStatus", "sources": [] }`. Missing actual records are never treated as zero. Overtime is calculated only with a unique, approved, effective source-tagged `overtime_threshold_weekly_minutes` profile and complete approved actuals; no configured value yields `null` and `unconfigured`. Weekend, holiday, and night values likewise require the relevant configured tenant calendar/window and report their sources/status. `format=csv` produces a downloadable CSV; untrusted text columns are formula-neutralized before CSV quoting, while numeric fields (including negative variance) remain numeric.

Coverage response contains `data[]` shift rows with required qualification/count, assigned qualified count, and shortfall; `summary` gives shift count, required/assigned slots, shortfall and a `byQualification[]` breakdown. Qualification report `data[]` rows include active qualified employees, employees with a qualification record, required slots, assigned qualified slots and shortfall; it includes `range` and a note that qualification counts require verified, valid records. Absence report `data[]` rows group by `absence_type` and status and include record count, distinct affected employees within that group, and overlapping calendar days; `summary` provides total records and globally distinct affected employees (not a sum of grouped counts).

Findings return paginated `data[]` rows with `id`, validation run, shift/person, rule code, severity, message, source, profile version, details and timestamp. Audit returns `data[]` rows with event ID, actor, event/entity type and ID, details, timestamp, and `{ "page", "pageSize" }`.

## Validation, concurrency, and persistence

Blocking validation returns HTTP 422:

```json
{ "success": false, "code": "PLANNING_VALIDATION_FAILED", "data": { "validationRunId": "uuid", "findings": [{ "code", "severity", "message", "sourceName?", "details?" }] } }
```

Revision mismatches return HTTP 409 `REVISION_CONFLICT`. All mutations use exact endpoint permissions, not role names or frontend guards. Shift assignment, update, conflict resolution, swaps, cover approval and publication revalidate with stored canonical instants and persisted `end_date`; multi-day intervals are not reconstructed from start/end clock times. A shift linked to a period must lie wholly inside its dates.

`POST /sync/push` supports the existing `{ "deviceId", "mutations": [{ "clientUuid", "entityType": "shift", "action": "CREATE" | "UPDATE" | "DELETE", "clientTimestamp", "baseVersion", "payload" }] }` protocol. Shift create/update payloads support `endDate`, local-time offsets, qualification, break, type/status, and employee assignment fields as applicable. Updates require `payload.id`; the strict update schema accepts that ID. A stale shift update returns `status: "CONFLICT"`, `serverVersion`, and `conflictData.serverSnapshot` with `{ "id", "siteId", "employeeId", "date", "endDate", "startTime", "endTime", "startsAt", "endsAt", "timeZone", "breakMinutes", "type", "status", "planningStatus", "requiredQualification", "conflictReason", "schedulePeriodId", "revisionVersion", "staffingRequirements": [{ "qualificationType", "requiredCount" }] }`. Legacy shifts without an explicit demand row report the default requirement count of 1. The snapshot is tenant-scoped and contains IDs only; it does not include employee names or unrelated personnel data. `POST /sync/conflicts/resolve` also returns this canonical `serverState` on stale expected-version responses and on `USE_SERVER`. A missing or foreign-tenant shift is rejected without a snapshot. A malformed payload, invalid/foreign ID, permission failure, or server validation failure is rejected/conflicted rather than accepted as a final schedule. Sync-created/updated shifts remain drafts; offline mutation success is not publication.

Legacy `/shifts` CRUD remains available under `shifts:read` / `shifts:manage`; updates require `revisionVersion` and use the same validation, full interval, and period-boundary checks. The backend reuses existing employee, qualification, absence, site-assignment, site, and client masters. It does not create duplicate personnel/site/customer records.

Migrations `030_service_planning.sql`, `031_planning_cover_actuals.sql`, and `032_planning_approvals_templates_notifications.sql` add the planning schema, actual/cover storage and approval/history, template break/staffing/effective-date fields, and tenant-scoped notifications. Tenant tables have RLS and FORCE RLS, tenant-aware composite foreign keys where applicable, and least-privilege app-role grants. Local queued edits, drafts, validation findings and reports are not proof of legal compliance; values missing from tenant configuration or approved actual-time records remain explicitly unavailable/unconfigured.

Planning cover/swap requests and decisions, employee assignments, and actual-time events create tenant/user-scoped in-app notifications in `planning_notifications`; `GET /planning/notifications?page=1&pageSize=50&unreadOnly=true` returns only the authenticated user's inbox and `POST /planning/notifications/:notificationId/read` updates only that user's row. Employee-targeted notifications require a linked `account_user_id`; applicable approvers/requesters still receive role/user-targeted inbox events. This is a database-backed in-app inbox, not email/push delivery. The API applies a global per-IP limit from `RATE_LIMIT_MAX` requests per minute (default 120), using Express `req.ip`. Production requires `RATE_LIMIT_REDIS_URL`; all backend instances must use the same protected Redis service. Production Compose provisions a private Redis service without a published host port. The backend does not begin listening until Redis is connected; request-time store failures are returned as server errors rather than falling back to per-process counters. `TRUST_PROXY` defaults to empty (trust no forwarded headers); configure it only with exact proxy IPs/CIDRs whose `X-Forwarded-For` header is overwritten. Production Compose sets Caddy to `172.30.0.2` and trusts only that address (`172.30.0.2/32`); the backend port is not published and Caddy replaces `X-Forwarded-For` with the connecting client IP. Keep the two settings aligned if network addresses are overridden. Do not trust arbitrary client-provided forwarding headers or a broader network than required. The CSV export prefixes formula-leading text fields (employee identifiers, names, and status values, including values with leading whitespace/control characters) with an apostrophe before quoting. Numeric report metrics are quoted normally but are not formula-prefixed, preserving signed numeric values in spreadsheet consumers.

## Frontend integration boundaries

`RosterModule.tsx` uses the existing tenant-scoped roster cache and IndexedDB outbox only for supported shift create/update drafts. Shift deletion, template listing/creation/editing/activation/application, staffing suggestions, cover requests and decisions, actual-time reads/records/corrections/approval, planning notifications, report reads, rule-profile changes and schedule publication call the online API directly and are not queued offline.

Template create/edit includes the documented break duration, staffing demand, and inclusive effective dates. Staffing suggestions show returned candidates and the capped, ID-only exclusion reason codes from the endpoint; no employee names are inferred for excluded people. Choosing a candidate still requires explicit assignment, which the server revalidates. Current actual-time records and audit history load from `GET /planning/shifts/:id/actual-time?employeeId=...`; pending records may be approved by a different user with `planning:actuals:approve` using the current revision. Corrections reset approval server-side, and the UI presents recorded/pending values separately from approved actuals. This approval workflow is not a claim of payroll/legal compliance.

Work-hours reporting renders server-provided `hours_variance` and `minus_hours` only when available, with their availability status and source metadata. These approval-dependent metrics are kept distinct from configured overtime and nullable captured/approved actual-hours values. Missing data remains unavailable rather than being replaced with zero.

The planning inbox loads the authenticated user's tenant-scoped notifications from `GET /planning/notifications` and marks individual rows read through the documented read endpoint. It is an in-app inbox only; no email/push delivery is implied. The planning cache remains a single most-recently-loaded date range per tenant/user, not a multi-range offline replica; the roster visibly discloses this limitation and warns when an offline request falls outside the cached range.

Shift sync conflicts display the tenant-validated current shift snapshot returned by the sync receipt before enabling a resolution. The API rate limit is per-IP, with a default of 120 requests per minute and a shared Redis store in production. All backend instances must point to the same protected Redis service. The CSV export prefixes formula-leading text fields (employee identifiers, names, and status values, including values with leading whitespace/control characters) with an apostrophe before quoting. Numeric report metrics are quoted normally but are not formula-prefixed, preserving signed numeric values in spreadsheet consumers.
