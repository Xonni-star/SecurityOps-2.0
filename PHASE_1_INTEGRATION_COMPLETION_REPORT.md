# Phase 1: Integration and technical status

**Status checked:** 2026-11-14
**Verified main commit:** `ed7f5f053849dc8e97b8ab79dfe2073f2974f73e`
**Project status:** In development; not approved for production.

This is a current implementation and evidence snapshot, not a compliance or production-readiness declaration. PRs #25–#29 are merged; #30–#33 remain open and are not part of `main`. Their exact CI and focused-test evidence is tracked in the [mainline integration report](./MAINLINE_INTEGRATION_STATUS.md).

## Current implementation snapshot

| Area | Verified implementation status | Boundary |
|---|---|---|
| Architecture and API | React/Vite frontend, TypeScript/Express API at `/api/v1`, PostgreSQL migrations, and a production Docker profile are present. | Builds and configuration checks do not prove a production rollout. |
| Authentication, tenant, and authorization | Session-based authentication, tenant-scoped API access, RLS for applicable tenant tables, backend permissions, and startup checks for the operational database role are implemented. | RLS is not asserted for every historical table; production configuration and operational acceptance are unverified. |
| Business modules | Customer, site, employee, shift, key/task, guardbook, DMS, SOP, alarm/emergency, handover, and patrol implementation exists in the repository. | Individual workflow, offline, audit, and operational limits remain; see the linked module documentation. |
| Service planning | Planning workflows, reports, and related backend/frontend functionality are in `main`. PR #33 adds a configurable daily work limit but remains open and unmerged. | No general claim of working-time, rest-period, tariff, or legal compliance is made. |
| Offline synchronization | IndexedDB outbox and domain-specific sync paths are implemented. PR #32 adds persisted bounded retry backoff but remains open and unmerged. | Not all actions or binary artifacts are available offline; cached planning data has bounded coverage. |
| DMS scanning | The DMS quarantine/scanning lifecycle and ClamAV adapter are implemented on `main`. PR #31's five-job CI, including a real INSTREAM adapter check, is passing but remains open and unmerged. | Adapter coverage is not production scanner availability or proof of the complete DMS upload flow. |
| Backup and restore | PR #29's isolated restore validation is merged; PR #30's secret/mount isolation changes are still open. Test-only PostgreSQL and S3-compatible snapshots were checked with hashes/metadata and disposable-resource cleanup. | Not a full installation, full-schema restore, or production/provider restore. |

## Automated and isolated validation

| Check | Result and scope |
|---|---|
| Main CI | Run [43600456464](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43600456464) passed all four standard jobs on the verified main commit. |
| PR CI | PRs #30, #32, and #33 each have all four standard jobs passing; PR #31 has all five jobs passing, including ClamAV adapter integration. These checks are on open PR revisions, not on `main`. |
| PR #32 local frontend checks | 111 frontend tests and production build passed on the PR revision. |
| PR #33 focused local checks | Backend/frontend builds, 26 roster tests, and focused PostgreSQL 16 daily-limit integration coverage passed on the PR revision. A fresh-main comparison found the same 21 failing assertions in `sync_and_roles.test.ts` on baseline and feature; these are pre-existing, not a PR #33 regression. |
| Restore tests | Isolated MinIO and SeaweedFS snapshot/restore checks compared a test database row and object hash/metadata and verified disposable-resource cleanup. They do not prove a production or external-provider restore. |
| ClamAV checks | A separate ClamAV runtime smoke recognized benign EICAR via `clamdscan --stream`; PR #31 separately checks the application's INSTREAM adapter against clean content and benign EICAR. Neither establishes production availability or full DMS-flow acceptance. |

Earlier Phase 1 test totals and CI run identifiers in the 2026-11-13 report were tied to an earlier commit. They are historical results, not current-main evidence, and are not repeated as current verification here.

## Known gaps and limits

- Production deployment, browser/device acceptance, operational recovery, and legal/domain review have not been established.
- External notification delivery, full offline binary support, and complete offline coverage across modules are not established.
- The isolated restore tests are not a full SecurityOps installation or production-provider restore.
- The development dependency tree retains a LOW `deepmerge@4.3.1` advisory. No safe patched version has been identified; it is an upstream development-dependency blocker, not a production dependency finding.

**Status:** Implementation and automated test coverage are progressing, but production/provider acceptance and the open PR changes remain outstanding.
