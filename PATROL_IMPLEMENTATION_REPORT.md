# Patrol management: implementation and acceptance audit

**Status:** PR #14 is open and unmerged. This report reflects the complete 641-line brief and implementation in the current worktree. It does not claim production readiness, operational availability, or that device-level requirements have been verified.

## Implemented scope

- Tenant/site-bound checkpoints with random 256-bit QR credentials (only SHA-256 hashes persisted), token rotation, lifecycle controls, and camera/NFC/manual fallbacks based on available browser APIs.
- Immutable route versions, fixed/flexible checkpoint ordering, target duration/tolerance, timezone-aware daily/weekly recurrence, employee assignments, and object-scoped employee groups snapshotted into route-version assignments.
- Round start, scans, completion, deviation records, immutable events, server-side RBAC, and dashboard/history filters.
- IndexedDB outbox for offline start/scan/completion/exception mutations; cached route/checkpoint/round state; reload/restart recovery; dependency-ordered replay; reconnect-triggered sync; idempotency; and preserved conflict states.
- A 30-second backend schedule worker materializes occurrences with a unique tenant/route/version/time key. Conditional state updates and `FOR UPDATE ... SKIP LOCKED` make missed/abandoned processing safe across worker instances. System deviations and append-only occurrence events are recorded idempotently and appear in the Patrol views.
- Non-manager scan/exception history is restricted server-side to the caller's own rounds/records or currently assigned sites; filters only narrow that base scope. Manager, audit, and analytics permissions retain their tenant-wide scope.
- Start/scan/completion capture times are limited to a 24-hour offline age and five-minute future drift. Scans are checked against accepted round start, client-captured and server-received times remain separate, and the two-minute duplicate rule uses trusted `server_received_at`. The schedule worker waits 24 hours plus five minutes beyond a deadline before missed/abandoned terminalization, allowing timely offline mutations to reconcile.
- `GET /patrol/events` includes immutable schedule-occurrence events under its existing permission, tenant, and site filters. Planned-occurrence status has its own UI control and is sent only to that endpoint.
- Patrol sync conflicts can be resolved by accepting the server state or, with exception permission, recording a new token-free immutable exception containing the useful local note. Conflict receipts are separate and idempotent; unresolved authorization/data failures keep the outbox entry.
- Existing, active, same-site DMS documents can be linked online to a round. This uses the private DMS blob/document workflow; it does not capture photos or buffer binary files offline.
- Optional scan GPS, completion remarks, scan-attempt audit without raw tokens, and tests for group authorization, schedule de-duplication/grace reconciliation, missed/abandoned rounds, event-history visibility, scan/exception read scoping, timestamp limits, manipulated duplicate times, occurrence status filtering, attachment idempotency, and Patrol conflict resolution.
- Migrations 026–029 add schedule occurrences/events, employee groups and route snapshots, DMS attachment links, and the DMS relationship delete permission required by its existing setter. Tenant-owned tables use RLS and FORCE RLS.

## Acceptance status and limitations

The backend and frontend implementations cover the required offline start/scan/outbox/sync/restart path, recurrence materialization, automatic overdue/missed/abandoned detection, group assignments, and actionable conflict handling. The full set of implementation details and route permissions is documented in [PATROL_MANAGEMENT.md](./frontend/PATROL_MANAGEMENT.md).

Still not implemented or verified: direct photo capture and offline binary attachment upload; physical iOS/Android camera/NFC/geolocation testing, browser-process termination/restart on real devices, and deployment runtime testing. Existing same-site DMS documents can be linked online, but this is not a substitute for offline photo support. Missed/abandoned items are escalated as persistent high-severity deviations and occurrence statuses in the app; no Patrol-specific NotificationCenter delivery, email, push, or dispatch provider is configured. External delivery is not claimed. Dienst-/Schichtplanung has not been started.

## Database, tenant isolation, and authorization

- Migrations 020–025 create Patrol entities, offline completion receipts, route execution metadata, schedule and individual assignments, granular permissions, and token-free scan-attempt audit.
- Migration 026 adds schedule timezone/anchor, unique planned occurrences, immutable occurrence events, system actor support, missed/abandoned exception categories, RLS/FORCE RLS, and least-privilege grants.
- Migration 027 adds tenant/site-bound groups, members, immutable route-version group assignments, and the group event entity. Route-start authorization uses the immutable individual assignment snapshot.
- Migration 028 adds immutable tenant/site-bound links from rounds to existing DMS documents, with RLS/FORCE RLS. Migration 029 grants the application role the existing DMS relationship setter's required DELETE permission; API authorization remains required.
- Schedule insertion is conflict-safe by unique key; missed processing is conditional on `scheduled`, and abandoned processing locks eligible rows with `SKIP LOCKED`. System exception IDs are deterministic per occurrence/category.
- Direct and offline writes validate server-side RBAC and authenticated employee/site relationships. Migration/RLS and API results below are local verification, not a production database deployment or independent security certification.

## Verification

### Local worktree

Changes are on `xonni-star-feature-patrol-management`. PR [#14](https://github.com/Xonni-star/SecurityOps-2.0/pull/14) remains open against `main`. The verified project base is `5608b9010096ebac06a000ed2a2870dadd66ab60`; the latest implementation head is `d61057ee3a29a4c40586ff05de080bd0193855bb`. No merge was performed.

- Backend TypeScript build: passed.
- Full Backend Jest: 20 suites, 219 tests passed. The Patrol integration suite passed with security, grace-window, event-history, occurrence-filter, and stale/future/out-of-round completion timestamp regressions. Jest still reports an open `TCPWRAP` handle from the existing migration-pool test setup after successful completion.
- PostgreSQL migration/RLS suite: 65 tests passed.
- Patrol API integration: passed, including parallel schedule materialization/processing, missed and abandoned handling, employee-group authorization, DMS attachment linking, and both idempotent conflict-resolution choices.
- Frontend Vitest: 11 files, 56 tests passed, including IndexedDB reopen/restart recovery and automatic sync on reconnect.
- Frontend production build: passed. Existing Vite `__dirname` and large-chunk warnings remain.
- Focused frontend TypeScript check of `store.ts` and `components/PatrolModule.tsx`: passed with `tsc --noEmit`; React declaration dev-dependencies were added to the frontend package to make the check possible.
- Production Compose configuration validation: passed.
- Backend and frontend/proxy production Docker image builds: passed. These are build checks only; no deployment or runtime readiness was established.
- `git diff --check`: passed.
- No real-device camera/NFC/offline E2E or production database deployment was run.

### GitHub CI

All four required jobs passed for current code head `d61057ee3a29a4c40586ff05de080bd0193855bb`:

- [Backend – PostgreSQL 16, Migration, Build, Jest](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43437507879/job/131926310353) — passed
- [Frontend – npm ci, Vitest, production build](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43437507879/job/131926310031) — passed
- [Production Docker – configuration and image builds](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43437507879/job/131926309728) — passed
- [Root – npm ci, structure check, overall start](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43437507879/job/131926310190) — passed

This report correction is documentation-only; the PR Checks tab is authoritative for the latest branch head.

PR #14 stays open for independent review and will not be merged by this agent.
