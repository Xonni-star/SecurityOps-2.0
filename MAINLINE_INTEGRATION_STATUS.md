# Mainline integration and validation status

**Status checked:** 2026-11-14

**Main:** `7ee8ce62d7c706cdd400304f256ce8e7c6426a05`

**Project status:** In development; not approved for production.

This report distinguishes implementation in merged code, automated CI, isolated tests, and production/provider acceptance. Passing tests or release-artifact builds do not establish deployment, operational acceptance, legal compliance, or production-provider behavior.

## Pull requests and current main CI

PRs [#25](https://github.com/Xonni-star/SecurityOps-2.0/pull/25) through [#34](https://github.com/Xonni-star/SecurityOps-2.0/pull/34) are merged. There are no open pull requests. The verified merge commits for PRs #25–#34 are:

| PR | Merged commit |
|---|---|
| #25 | `3337d8c` |
| #26 | `5c8fed8` |
| #27 | `d3291f0` |
| #28 | `8948dc3` |
| #29 | `ed7f5f0` |
| #30 | `639f3a1` |
| #31 | `a16e5df` |
| #32 | `1bf310b` |
| #33 | `fe8c7c1` |
| #34 | `7ee8ce6` |

Main CI run [43604825009](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43604825009) passed all five jobs on the verified main commit: root checks, frontend tests/build, backend PostgreSQL/migration/build/Jest, ClamAV DMS INSTREAM adapter integration, and production Docker configuration/image builds. The latest release-artifacts run [43605173522](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43605173522) also succeeded, building the release package from CI artifacts. This is artifact generation, not a production deployment.

The merged changes include:

- PRs #29–#30: isolated backup/restore validation and credential/mount isolation.
- PR #31: ClamAV INSTREAM adapter integration coverage in CI.
- PR #32: persisted, bounded retry backoff for eligible generic offline-outbox failures.
- PR #33: optional configurable daily work limit and focused PostgreSQL DST-boundary tests.
- PR #34: documentation snapshot; its former PR/main/CI status has been superseded by the current status above.

## Restore and malware-scanning evidence

The isolated MinIO and SeaweedFS checks associated with PRs #29–#30 passed with documented image overrides. They exercise selected test database metadata and S3-compatible object snapshots, hash/metadata comparisons, credential and mount isolation, and disposable-resource cleanup. They are **not** a full SecurityOps installation, full migrated-schema restore, or production/external-provider restore.

The ClamAV adapter check exercises the application INSTREAM protocol against clean content and benign EICAR. It is not a full DMS upload-to-release acceptance test and does not establish that a production scanner is configured or reachable. A separate isolated `clamdscan --stream` smoke check also recognized benign EICAR; that result is limited to the test runtime.

## Evidence categories and limits

| Evidence type | What is established | What is not established |
|---|---|---|
| Implementation | PRs #25–#34 are merged into the listed mainline; the current main contains their changes. | End-user acceptance or production readiness. |
| Automated CI | The identified five-job CI run passed on the exact current main commit; the latest release-artifacts job succeeded. | Deployed configuration, production traffic, or successful operation in a customer environment. |
| Isolated tests | Restore/object-store checks, ClamAV adapter checks, and focused planning/offline tests exercise their stated test scopes. | Full production installation or restore, external-provider acceptance, or all-device/browser behavior. |
| Production/provider acceptance | None established by this report. | Production rollout and restore, external-provider acceptance, browser/device acceptance, and legal/domain review remain outstanding. |

No full production installation or restore, external-provider acceptance, legal review, or browser/device acceptance has been established. The backend development dependency tree's last recorded audit identified a LOW `deepmerge@4.3.1` advisory in Jest/`ts-jest` development dependencies; the production-only audit found no production findings at that snapshot. This is not a production dependency finding.
