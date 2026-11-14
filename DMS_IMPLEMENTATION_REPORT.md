# DMS implementation report

## Summary

The document-management module now uses the existing Express, PostgreSQL, tenant-RLS, and server-side RBAC architecture. It replaces the simulated local document list with persisted document metadata and private file storage. This report describes implementation and local verification only; the DMS was not deployed and is not certified production-ready.

## Delivered

- Uses the existing migration `012_document_management.sql` for tenant-scoped categories, nested folders, documents, immutable versions, tags, relationships, and append-only audit events. Migration `035_document_quarantine_and_scan_lifecycle.sql` adds the quarantine, scan/release, deletion, and site-scope changes described below.
- Added authenticated `/api/v1/documents` endpoints for listing, filtering, details, upload, download/preview, version history and restore, metadata, relationships, folder/category/tag management, archive/restore, and audit history. The server derives tenant identity from the authenticated session and enforces DMS RBAC permissions.
- Replaced the mock document UI with server-backed search/filtering, folder navigation, upload progress, preview, version history, archive/restore, and relationship controls. Document files are not placed in the browser's offline cache or mutation queue.
- Migration `035_document_quarantine_and_scan_lifecycle.sql` adds quarantine/release timestamps, scan states, failure codes, and object-deletion tracking; database rules reject approval/publication while the current version is unreleased.
- Replaced local filesystem blobs with a private S3-compatible object-store abstraction. Uploads use generated quarantine keys, a 10 MiB default limit (configurable up to 100 MiB), SHA-256 metadata, filename sanitization, and extension/content checks for PDF, OOXML, text/CSV, and supported image formats. Office files can be downloaded but are not previewed.
- Added a ClamAV provider for the scanner interface and explicit `pending`, `clean`, `infected`, `unavailable`, `error`, and `not_scanned` states. Production requires scanning by default; only clean scans release files. Optional unscanned uploads remain labeled as such. Scan outcomes and permanent deletion of archived file objects are audit events.
- Added local MinIO/ClamAV Compose services and production S3/ClamAV configuration. PostgreSQL backups no longer claim to include object data; S3 backup/versioning/retention must be configured at the provider.
- Updated the root and frontend documentation, API reference, security/architecture, offline, database, and backup documentation.

## Verification

- Backend TypeScript build passed.
- Focused backend DMS tests: **2 suites, 7 tests passed**, covering generated S3 keys/fake storage and clean, infected, and unavailable scanner outcomes.
- Frontend Vitest: **16 files, 97 tests passed**.
- MinIO and production Docker Compose configuration validation passed; no S3/MinIO service was contacted.
- `git diff --check` passed.

Final PostgreSQL migration/RLS and API integration validation is pending a rebase onto the corrected PR #24 head. At the time of this report, PR #24's latest backend/PostgreSQL CI check is still failing; its frontend, Docker, and root checks pass. No production services were deployed.

The previously recorded migration counts and test totals referred to earlier validation and are not evidence for the current migration 035 change. The frontend build reports Vite warnings about `__dirname` in the Vite config and a minified JavaScript chunk over 500 kB. Dependency installation reported 9 backend dependency audit findings (7 low, 1 moderate, 1 high); the production dependency stage reported 2 (1 moderate, 1 high). These findings were not remediated as part of this DMS change.

## Limitations and follow-up

- Production requires an operator-provided HTTPS S3-compatible endpoint, private bucket and dedicated credentials plus a reachable ClamAV service. Provider availability and policy have not been production-verified.
- DMS polymorphic relationships are limited to persisted customers, sites, employees, shifts, and guardbook incidents. SOP versions can reference an existing DMS document through their tenant-scoped foreign key; alarm/alert relationships remain unavailable.
- Authorization is based on tenant RLS and DMS role permissions. Per-document and per-folder ACLs are not implemented.
- Offline mode does not cache file blobs or support offline DMS edits/uploads.
- File objects for archived documents can be permanently deleted through the API, while metadata and audit history remain. Automatic retention is not implemented.
- Existing filesystem-backed blobs are not automatically copied to S3; migration 035 marks old versions unscanned and unreleased. Operators must migrate/re-upload them and validate backups before upgrading production.
- S3 object encryption and backup/restore remain provider/operator responsibilities; a full restore drill was not performed.
- Production deployment, operational acceptance, and production-readiness certification were not performed.
