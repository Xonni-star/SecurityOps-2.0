# Mainline integration and validation status

**Status checked:** 2026-11-14
**Main:** `ed7f5f053849dc8e97b8ab79dfe2073f2974f73e`
**Project status:** In development; not approved for production.

This report distinguishes code present on `main`, automated CI, isolated local checks, and production/provider evidence. Passing tests or image builds do not establish deployment, operational acceptance, legal compliance, or production-provider behavior.

## Mainline and CI

PRs [#25](https://github.com/Xonni-star/SecurityOps-2.0/pull/25) through [#29](https://github.com/Xonni-star/SecurityOps-2.0/pull/29) are merged. Main CI run [43600456464](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43600456464), for the current main commit, passed all four jobs: root checks, frontend tests/build, backend PostgreSQL/migration/build/Jest, and production Docker configuration/image builds.

The following PRs remain **open and unmerged**. Their passing CI is evidence for the PR revisions only, not for features already present on `main`.

| PR | State and verified evidence |
|---|---|
| [#30](https://github.com/Xonni-star/SecurityOps-2.0/pull/30) — restore-test secret isolation | Open; all four standard CI jobs passed. The isolated MinIO and SeaweedFS restore checks passed with the documented image overrides, including database/object snapshot checks, hash/metadata checks, and disposable-resource cleanup. |
| [#31](https://github.com/Xonni-star/SecurityOps-2.0/pull/31) — ClamAV adapter CI | Open; all five jobs passed, including a real ClamAV 1.4.3 INSTREAM adapter check that recognized clean content and benign EICAR. It tests the scanner adapter protocol, not the complete DMS upload flow or production ClamAV availability. |
| [#32](https://github.com/Xonni-star/SecurityOps-2.0/pull/32) — persisted offline retry backoff | Open; all four standard CI jobs passed. Local frontend tests (111) and production build passed. |
| [#33](https://github.com/Xonni-star/SecurityOps-2.0/pull/33) — configurable daily work limit | Open at head `7ec3fb694bbc2e741c69d19ea8a05c311b284c41`; all four standard CI jobs passed. Local builds, 26 roster tests, and two focused PostgreSQL 16 DST integration tests passed: Berlin spring-forward 00:00–04:00 counted as 180 elapsed minutes and was accepted at the limit; fall-back 00:00–04:00 counted as 300 minutes and was rejected. The test restores the site's IANA time zone in `finally`. |

For PR #33, a fresh-PostgreSQL-16 comparison against the same `main` baseline found the same 21 failing assertions in `sync_and_roles.test.ts` on both revisions (feature: 21 failed/10 passed; baseline: 21 failed/9 passed). The new daily-limit test passes. These failures are present on the baseline and are not evidence of a regression introduced by PR #33.

## Restore and malware-scanning evidence

PR #29 (merged) introduced isolated backup/restore validation; PR #30 (open) hardens its credential/mount isolation. The checks exercise PostgreSQL test metadata and S3-compatible MinIO/SeaweedFS object snapshots, with hash and metadata comparisons and disposable-resource cleanup. They are **not** a full SecurityOps installation, full migrated-schema restore, or production/external-provider restore.

The ClamAV runtime smoke in the restore-test work recognized benign EICAR using `clamdscan --stream`; that is separate from PR #31's CI test of the application's `ClamAvDocumentScanner` INSTREAM adapter. Neither proves production scanner availability or a complete DMS upload-to-release workflow.

## Evidence categories and limits

| Evidence type | What is established | What is not established |
|---|---|---|
| Implementation | Merged code is on the listed main commit; open PR code remains isolated from `main`. | End-user acceptance or production readiness. |
| Automated CI | The identified jobs passed on the exact main or PR revisions described above. | Behavior outside those jobs, deployed configuration, or real production traffic. |
| Isolated local tests | Focused PostgreSQL, frontend, scanner, and test-only object-store checks passed as listed. | Full-stack installation or a real customer/provider environment. |
| Production/provider acceptance | None established by this report. | Browser/device acceptance, legal/domain review, production rollout, external-provider availability, and production restore remain outstanding. |

The backend development dependency tree still has a LOW `deepmerge@4.3.1` advisory. It is an upstream dependency blocker with no safe patched version identified; it is not a production dependency finding.
