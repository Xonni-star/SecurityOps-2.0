# Patrol management: implementation and acceptance audit

**Status:** incomplete; PR #14 remains open for independent review. This report evaluates the full 641-line brief supplied in the parent workspace. It does not claim production readiness, operational availability, or that all acceptance requirements are met.

## Scope currently implemented

- Tenant-scoped checkpoints with high-entropy QR tokens, rotation, lifecycle metadata, and route-version management.
- Round start, checkpoint scans, completion, deviation records, and append-only round events.
- IndexedDB persistence of offline start/scan/completion events, recovery after reload, ordered outbox replay, reconnect-triggered synchronization, shared idempotency keys, and preserved retry/conflict states.
- Tenant-scoped dashboard filters for customer/site, employee, route, round status, dates, and exception category.
- Immutable route versions capture fixed/flexible checkpoint order, target duration, late tolerance, time windows, daily/weekly recurrence, and individual employee assignments. Server-side validation checks assignment/site membership before a round starts.
- Optional GPS coordinates are captured per scan; completion remarks and route execution metadata are persisted.
- Scan processing creates idempotent `late_checkpoint` and `missed_checkpoint` deviations when observed route steps exceed configured offsets/tolerance or are skipped. Completion can also create a target-duration deviation.
- Permission-gated scan-attempt audit records for invalid, rejected, and duplicate scans. Tokens are not stored in the audit records.
- Migrations 023–025 extend route execution/location, scheduling/individual assignments and fine-grained permissions, and scan-attempt auditing. Tenant-owned tables use RLS and FORCE RLS; the application role has only the required table privileges.
- Route planning, filters, and permission-gated scan-attempt review are exposed in the existing UI. Direct and synchronized writes use server-side authorization.
- Related README, database, backend, offline, and module documentation has been updated. Dienst-/Schichtplanung has not been started.

## Acceptance status and remaining gaps

**Implemented, with local automated coverage:** tenant-scoped checkpoint and route APIs; immutable route versions; fixed/flexible order; target duration/tolerance and time-window/recurrence configuration; individual employee assignment enforcement; offline start/scan/completion and durable replay; optional per-scan GPS; completion remarks; scan-based late/missed deviations; dashboard filtering; and token-free scan-attempt auditing.

**Partially implemented:** recurrence is configurable but there is no scheduler that creates planned round occurrences. The system detects late/missed checkpoints during an active round, but does not detect a missed scheduled round, stale/abandoned round, or automatically escalate it. Assignment supports individual employees, not employee groups. Offline conflict/retry states are persisted, but there is no Patrol-specific resolution workflow for a manager.

**Not implemented or not verified:** photo/file attachments; automatic detection/escalation of scheduled, abandoned, or unusually timed rounds; configured Patrol notifications; actual delivery through email, push, or dispatch; hardware/browser end-to-end verification for camera/NFC fallbacks, permission denial, network loss and restart. These are not represented as complete.

The full acceptance brief therefore remains only partially satisfied. The passing tests below do not establish completeness for criteria they do not exercise.

## Database, tenant isolation, and authorization

- Migration 023 adds route-version order/duration/tolerance settings, scan location, and completion notes.
- Migration 024 adds route-version time-window and recurrence fields plus `patrol_route_version_assignments`. Assignment foreign keys bind tenant, route/site, employee, and employee-site assignment; RLS and FORCE RLS are enabled. The application role receives SELECT/INSERT only on the assignment table.
- Migration 025 adds `patrol_scan_attempts`, with a tenant/mutation uniqueness constraint, no raw scan token column, RLS/FORCE RLS, and SELECT/INSERT-only application privileges.
- Route start authorization is enforced server-side and checks the caller's assignment against the requested route/site. Patrol endpoints use fine-grained permissions while preserving legacy permission compatibility.
- The migration/RLS and API test results below are local test results; they are not a production database deployment or independent security certification.

## Verification

### Local worktree

The local changes are currently uncommitted on branch `xonni-star-feature-patrol-management`. The local `HEAD` is `52e7ab05e04476d06e92547753dd759b24fd8a37`; GitHub CI listed below is for that pushed commit, not for the additional uncommitted changes.

- Backend TypeScript build: passed.
- Backend Jest: 20 suites, 219 tests passed.
- PostgreSQL migration/RLS suite: 65 tests passed.
- Patrol API integration: 1 test passed, including route scheduling/assignment, filters, scan-attempt auditing, and offline/idempotency behavior.
- Frontend Vitest: 11 files, 56 tests passed.
- Frontend production build: passed. Existing Vite `__dirname` and large-chunk warnings remain.
- Focused Python Mobile API tests: 2 passed. The broader Python suite was not run successfully in the prior work because its environment had missing `greenlet` and stale imports (`Tenant`, `DeviceStatus`); this is not reported as passing.
- `docker compose -f frontend/deploy/docker-compose.production.yml config --quiet`: passed using local-only test values.
- Production Compose backend and frontend/proxy image builds: passed. These are build checks only; no production deployment or runtime readiness was established.
- `git diff --check`: passed.

### GitHub CI (pushed head at time of check)

PR #14 was open against `main`. All checks passed for the then-pushed `52e7ab05e04476d06e92547753dd759b24fd8a37`:

- [Backend – PostgreSQL 16, Migration, Build, Jest](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43415507503/job/131852257837)
- [Frontend – npm ci, Vitest, production build](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43415507503/job/131852257762)
- [Production Docker – configuration and image builds](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43415507503/job/131852257370)
- [Root – npm ci, structure check, overall start](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43415507503/job/131852257875)

These are not CI results for the current uncommitted worktree. CI must be refreshed after the changes are committed and pushed.

## Required follow-up

Implement the outstanding scheduler/occurrence and escalation lifecycle, employee groups, attachment workflow, and Patrol-specific conflict resolution; add realistic device/network coverage where feasible; rerun the full checks; then update this report and the PR description with results for the actual pushed head. The PR must remain open for the user's independent review and must not be merged by this agent.
