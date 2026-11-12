# DMS implementation report

## Summary

The document-management module now uses the existing Express, PostgreSQL, tenant-RLS, and server-side RBAC architecture. It replaces the simulated local document list with persisted document metadata and private file storage. This report describes implementation and local verification only; the DMS was not deployed and is not certified production-ready.

## Delivered

- Added migration `012_document_management.sql` for tenant-scoped categories, nested folders, documents, immutable versions, tags, relationships, and append-only audit events. Tenant RLS is enabled and forced; same-tenant composite foreign keys protect document/category/folder and supported entity relationships.
- Added authenticated `/api/v1/documents` endpoints for listing, filtering, details, upload, download/preview, version history and restore, metadata, relationships, folder/category/tag management, archive/restore, and audit history. The server derives tenant identity from the authenticated session and enforces DMS RBAC permissions.
- Replaced the mock document UI with server-backed search/filtering, folder navigation, upload progress, preview, version history, archive/restore, and relationship controls. Document files are not placed in the browser's offline cache or mutation queue.
- Added private UUID-keyed filesystem storage, a 10 MiB default upload limit (configurable up to 100 MiB), SHA-256 metadata, filename sanitization, and extension/content-signature checks for PDF, OOXML, text/CSV, and supported image formats. Office files can be downloaded but are not previewed.
- Added a scanner interface without configuring an antivirus service. Until one is integrated, files are explicitly marked `not_scanned`; the UI does not report them as clean.
- Added a private persistent `secops_documents` volume and combined database/file backup and restore handling. Backup archives stream through encryption rather than creating a plaintext tar staging archive.
- Updated the root and frontend documentation, API reference, security/architecture, offline, database, and backup documentation.

## Verification

- Applied all 10 repository migrations, including migration 012, to an isolated local PostgreSQL 16 database.
- Backend Jest: **12 suites, 162 tests passed**, including migration/RLS checks and DMS upload, signature rejection, tenant/RBAC isolation, download, version restore, archive, and audit API coverage.
- Frontend Vitest: **6 files, 29 tests passed**, including the archive-view regression test.
- Backend TypeScript build and frontend Vite production build passed.
- Docker Compose configuration validation and backend/frontend production image builds passed. No containers or application services were deployed.
- `bash -n` passed for the backup and restore scripts; `git diff --check` passed.

The frontend build reports Vite warnings about `__dirname` in the Vite config and a minified JavaScript chunk over 500 kB. Dependency installation reported 9 backend dependency audit findings (7 low, 1 moderate, 1 high); the production dependency stage reported 2 (1 moderate, 1 high). These findings were not remediated as part of this DMS change.

## Limitations and follow-up

- No antivirus engine is configured; `not_scanned` is the only supported scan result in this deployment.
- DMS polymorphic relationships are limited to persisted customers, sites, employees, shifts, and guardbook incidents. SOP versions can reference an existing DMS document through their tenant-scoped foreign key; alarm/alert relationships remain unavailable.
- Authorization is based on tenant RLS and DMS role permissions. Per-document and per-folder ACLs are not implemented.
- Offline mode does not cache file blobs or support offline DMS edits/uploads.
- Archived documents and old versions are retained. Automatic retention and physical deletion policies are not implemented.
- The private Docker volume is not encrypted at rest by this change; host/volume encryption remains an operator responsibility. Backup/restore scripts were syntax-checked and Compose-validated, but a full restore drill was not performed.
- Production deployment, operational acceptance, and production-readiness certification were not performed.
