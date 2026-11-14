# Phase 1: Integration and technical status

**Status checked:** 2026-11-14

**Verified main commit:** `e2d57f6def5a5f48d1454f34d5935787fb2bb90b`

**Project status:** In development; not approved for production.

This is an implementation and evidence snapshot, not a compliance or production-readiness declaration. PRs #25–#38 are merged; no PRs were open when checked. PR #36 added a configured monthly work-limit rule, PR #37 added an isolated DMS API flow, and PR #38 added full-schema backup/restore validation with synthetic tenant/DMS records. The current PR and CI record is in the [mainline integration report](./MAINLINE_INTEGRATION_STATUS.md).

## Current implementation snapshot

| Area | Verified implementation status | Boundary |
|---|---|---|
| Architecture and API | React/Vite frontend, TypeScript/Express API at `/api/v1`, PostgreSQL migrations, and a production Docker profile are present. | Builds and configuration checks do not prove a production rollout. |
| Authentication, tenant, and authorization | Session-based authentication, tenant-scoped API access, RLS for applicable tenant tables, backend permissions, and startup checks for the operational database role are implemented. | RLS is not asserted for every historical table; production configuration and operational acceptance are unverified. |
| Business modules | Customer, site, employee, shift, key/task, guardbook, DMS, SOP, alarm/emergency, handover, and patrol implementation exists in the repository. | Individual workflow, offline, audit, and operational limits remain; see the linked module documentation. |
| Service planning | Planning workflows, reports, and configurable daily, weekly, and monthly work limits from merged PRs #33 and #36 are in `main`. | Rules apply only when configured in an active, approved profile revision. Focused tests cover Berlin DST boundaries; no general claim of working-time, rest-period, tariff, or legal compliance is made. |
| Offline synchronization | IndexedDB outbox and domain-specific sync paths, including the bounded persisted retry backoff from merged PR #32, are implemented. | Not all actions or binary artifacts are available offline; retry scheduling does not guarantee background execution after the browser closes. |
| DMS scanning | The DMS quarantine/scanning lifecycle and ClamAV adapter are implemented on `main`; current CI includes passing adapter and isolated DMS API integration jobs. | These tests use isolated services and do not establish production scanner/storage availability or production acceptance. |
| Backup and restore | PR #38 adds full-schema isolated restore validation over the current migration set, with synthetic tenant/user/DMS data, RLS checks, and object hash/metadata comparisons. | This is not a full production installation or production/provider restore. |

## Automated and isolated validation

| Check | Result and scope |
|---|---|
| Main CI | Run [43609474644](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43609474644) passed all seven jobs on the verified main commit, including frontend/backend, PostgreSQL, DMS API/scanner, full-schema restore, and Docker checks. |
| Release artifacts | Run [43609786489](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43609786489) successfully built the package from CI artifacts. This is not a deployment. |
| Isolated restore tests | The MinIO and SeaweedFS checks associated with PRs #29–#30 exercised test database/object snapshots, hash and metadata comparison, credential/mount isolation, and disposable-resource cleanup. They do not prove a full installation or production/provider restore. |
| ClamAV checks | Main CI passed the DMS INSTREAM adapter integration job. The isolated adapter/runtime checks cover clean content and benign EICAR, not production scanner availability or full DMS-flow acceptance. |
| Planning tests | Focused PostgreSQL 16 tests associated with merged PRs #33 and #36 cover configured daily/monthly work limits and Berlin spring-forward 00:00–04:00 as 180 elapsed minutes and fall-back 00:00–04:00 as 300 minutes; frontend/backend validation passed on those changes. These targeted results are not legal or production acceptance. |
| Offline retry tests | Merged PR #32 added tests for persisted retry timing, reuse of the same mutation ID, terminal/conflict exclusions, and a bounded attempt count. The current main CI passed its frontend test/build job. |

## Known gaps and limits

- No full production installation, full production restore, or external-provider acceptance has been established.
- Browser/device acceptance, operational acceptance, and legal/domain review have not been established.
- External notification delivery, full offline binary support, and complete offline coverage across modules are not established.
- The full-schema isolated restore test is not a full SecurityOps production installation or production-provider restore.
- The backend development dependency tree's last recorded audit identified a LOW `deepmerge@4.3.1` advisory in test/development dependencies. The production-only audit found no production findings at that snapshot.

**Status:** Implementation and automated test coverage are present on `main`; production/provider acceptance and the stated domain/device gaps remain outstanding.
