# Mainline integration status: PRs #19–#24

**Status checked:** 2026-11-14

**Project status:** In development; not approved for production.

**Integration branch:** `xonni-star-phase3-pr-integration`, based on `main` at `b94e21d0aab727eadabedd69995956edaa39a44f`.

**Integration pull request:** [#25](https://github.com/Xonni-star/SecurityOps-2.0/pull/25), open against `main`; integration CI pending.

## What is already in `main`

The current `main` commit is the merge commit for PR #16. PR #17 and PR #18 merge commits are also ancestors of it, so their changes are already present. They are not reintroduced in this integration branch.

PRs #19–#24 report `MERGED`, but those merges went into feature branches rather than `main`. Their status alone does not establish mainline inclusion. The integration branch includes their missing changes in dependency order:

| Source PR | Change included | Source commit/merge | Integration commit |
|---|---|---|---|
| [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19) | Planning frontend workflows | `96c0678e3853256afc07c198155e376f0924aad0` | `14f72ed84fdc05bb696e81d3277c184052bba831` |
| [#20](https://github.com/Xonni-star/SecurityOps-2.0/pull/20) | Tenant-safe user and role administration; migration 033 | `581da4a909579498702d00b056f2c6394a87d447` | `f69bb0af2d1e41961b56b03b46608e2b6dd300b7` |
| [#22](https://github.com/Xonni-star/SecurityOps-2.0/pull/22) | Password-reset delivery provider seam | Feature commit `68e2d006d350723c583d62b4aa1c36e80dbaa718` (head `c6ee6937fea2fd3b87bf3868ceca776fe9bd3e4d`) | `2d2076b7ea673b6c00cc91491e75aeb248e1c18a` |
| [#24](https://github.com/Xonni-star/SecurityOps-2.0/pull/24) | Tenant/site authorization; migration 034 and its regression-test repair | `1a3abba505fdad275e82d8eb0acaa312d6b94994` | `d52fad3f8cde39f6f33a54631f86345b7653fd42` |
| [#21](https://github.com/Xonni-star/SecurityOps-2.0/pull/21) | Redis-backed shared API rate limiting | `769868e6ec5dd85ce811205630a539e7fcc473a1` | `af7de3e9155d43f5deb172b20bdd746c08e4c6c9` |
| [#23](https://github.com/Xonni-star/SecurityOps-2.0/pull/23) | Frontend offline synchronization lifecycle | `9cac11de45abbb9862aad298f8af906b0186642b` | `67caf96eb9916c947058367ef8273c998dbe930a` |

These are branch changes only until the integration pull request is reviewed and merged by the repository owner. No commit was made directly to `main`.

## Migration and CI status

The integrated migration sequence ends at `033_tenant_user_role_administration.sql` followed by `034_system_wide_data_scope.sql`. Migration 034 depends on the tenant-role schema from 033. Its synthetic migration fixtures either apply 033 before 034 or explicitly exclude both; no fixture applies 034 without its prerequisite. PR #24's repaired fixtures also supply the current required alarm/client columns. The DMS migration 035 is outside this integration scope and is not included.

PR #24's current [GitHub CI run `43584490453`](https://github.com/Xonni-star/SecurityOps-2.0/actions/runs/43584490453) passed all four jobs: root smoke checks, frontend tests/build, backend PostgreSQL/migration/build/Jest, and production Docker configuration/image builds.

## Local verification

| Check | Result |
|---|---|
| Backend TypeScript build | Passed |
| Migration regression suite, PostgreSQL 16 | 70 tests passed |
| Frontend Vitest | 16 files, 105 tests passed |
| Frontend production build | Passed; existing Vite config-loader and large-chunk warnings remain |
| Production Compose configuration | Passed |
| Production backend and frontend Docker image builds | Passed |
| Full backend Jest suite | 27 suites, 274 tests passed on rerun |

The first full backend run and an isolated default-timeout run each hit the patrol integration test's 5-second timeout; a second full run passed all 274 tests without changing the timeout. Jest still reports an existing open `TCPWRAP` handle from the patrol integration setup. The source PR #24 CI run is green; the integration branch still needs its own CI run.
