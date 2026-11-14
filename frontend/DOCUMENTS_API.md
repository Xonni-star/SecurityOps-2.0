# DMS REST API

Base path: `/api/v1/documents`. All endpoints require an authenticated cookie session. Tenant context always comes from the authenticated `user_sessions` row; a request cannot select a tenant. The exact permission for each route is listed below.

Uploads use `Content-Type: application/octet-stream`, `X-File-Name` (URL-encoded UTF-8 basename), and the cookie/CSRF requirements used by other mutation routes. Metadata is sent as URL query parameters for the initial upload. The server validates the maximum size, safe filename, extension, signature and supported format, then writes the generated object key to a private S3-compatible bucket under `quarantine/`. Binary downloads return the raw file; errors retain the standard JSON response envelope.

## Storage and scan status

Configure `DMS_S3_ENDPOINT`, `DMS_S3_REGION`, `DMS_S3_BUCKET`, and dedicated `DMS_S3_ACCESS_KEY` / `DMS_S3_SECRET_KEY` credentials. Production requires HTTPS and refuses local/example credentials. Objects are private; the API is the only supported access path. Local MinIO and ClamAV services are defined in `deploy/docker-compose.minio.yml` with example settings in `deploy/.env.minio.example`.

`DMS_SCAN_REQUIRED=true` is the production default. Set `DMS_SCANNER_PROVIDER=clamav` and configure the reachable `DMS_CLAMAV_HOST`, port, and timeout. Production Compose does not run ClamAV: it requires an externally operated service. Setting the provider and host only configures the client; it does not prove that the service is reachable or healthy. The backend does not claim scanner protection until a scan succeeds, and failures leave the object quarantined and non-downloadable. The ClamAV `zINSTREAM` connection has no transport encryption or authentication, so expose it only on a private, isolated network reachable by the backend. Local Compose provides ClamAV for development. If scanning is explicitly optional, an absent provider is recorded as `not_scanned`, never as `clean`. Scan outcomes, retry attempts, and file-deletion lifecycle events are append-only audit events. New document versions return the current scan status and release flag; clients must use the server's `file_released` / `released` value, not infer availability from the document's approval status.

CI keeps the ClamAV INSTREAM adapter check and also runs `npm run test:dms-api-integration` in a separate, isolated job. That job uses ephemeral PostgreSQL, a private MinIO test bucket, and `clamav/clamav:1.4.3` with no published service ports, production endpoints, or production credentials. It waits up to five minutes for ClamAV and MinIO, migrates/seeds its own database, then exercises the real API upload path with a clean PDF and the benign EICAR text fixture. It verifies type and size rejection, persisted clean/released and infected/quarantined states, authorized clean download bytes, blocked unauthenticated/cross-tenant/quarantined downloads, private object access, and upload/scan/download audit events. The runner removes its test objects and metadata and closes its database connections on exit. This is CI evidence for the configured test services, not evidence that production endpoints or scanner services are available.

Migration `035_document_quarantine_and_scan_lifecycle.sql` adds the scan/release state and rejects document approval/publication while the current version is unreleased. Existing versions are marked `not_scanned` and require re-upload or a separately operated migration/re-scan before they can be released. The DMS file objects are not included in PostgreSQL backups; configure versioning/replication/backup and retention on the selected S3-compatible provider.

## Documents

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /` | `documents:read` | Search/filter/sort documents (`search`, `categoryId`, `folderId`, `root`, `status`, `archived`, `sort`, `direction`, `limit`, `offset`) |
| `POST /` | `documents:create` | Create document and version 1; raw file plus `title`, `categoryId`, optional `folderId`, `description`, `documentNumber`, `validFrom`, `validUntil`, `responsibleUserId`, `relationshipType`, `relationshipId` query fields |
| `GET /:id` | `documents:read` | Read details |
| `PATCH /:id` | `documents:update` | Update title/category/folder/status/description/number/validity/responsible user/tags/relationship; changing to approval/publication status also requires `documents:approve` |
| `GET /:id/download` | `documents:download` | Download the active version; optional `version=<number>` selects history and `inline=true` enables allowlisted preview formats |
| `POST /:id/versions` | `documents:update` | Add a new raw file version |
| `GET /:id/versions` | `documents:read` | List immutable version metadata |
| `POST /:id/versions/:version/rescan` | `documents:update` | Retry malware scanning for an unreleased quarantined version; stored bytes are integrity-checked, and only a committed clean result releases it |
| `POST /:id/versions/:version/restore` | `documents:update` | Restore an older version as a new version |
| `POST /:id/archive` | `documents:archive` | Soft-archive; no file/version is deleted |
| `DELETE /:id/files` | `documents:archive` | Permanently delete all object versions of an already archived document; retain metadata and audit history, return `202` while durable storage-deletion jobs remain pending |
| `POST /:id/restore` | `documents:restore` | Restore an archived document |
| `POST /:id/move` | `documents:update` | Move to a tenant folder or root (`folderId: null`) |
| `PATCH /:id/relationship` | `documents:update` | Change/remove the tenant-validated relationship |
| `GET /:id/audit` | `documents:read` | Read append-only DMS audit history |

Supported relationship types are `customer`, `site`, `employee`, `shift`, and `incident` (a persisted `guardbook_entries` row). Relationship IDs are validated against a same-tenant PostgreSQL row and composite foreign key. SOPs are not a polymorphic DMS relationship type; a SOP version can instead reference an existing DMS document through its tenant-validated document foreign key. Alarm/incident-management module records do not yet have backend persistence and are not accepted as fake links.

## Folders, categories, and tags

| Method and path | Permission | Purpose |
|---|---|---|
| `GET /categories` | `documents:read` | List tenant categories (default set is provisioned on first read) |
| `POST /categories` | `documents:manage` | Create category |
| `PATCH /categories/:id` | `documents:manage` | Rename/update category description |
| `GET /folders` | `documents:read` | List tenant folder hierarchy |
| `POST /folders` | `documents:create` | Create root folder or child (`name`, optional `parentId`) |
| `PATCH /folders/:id` | `documents:update` | Rename folder |
| `POST /folders/:id/archive` | `documents:archive` | Archive an empty folder; folders with active contents/children are rejected |
| `GET /tags` | `documents:read` | List tags in the tenant |

Tags are created and assigned through `PATCH /:id` using `tags: string[]`. The file-delete endpoint commits unreleased tombstones and durable deletion jobs before calling object storage. Failed storage deletions stay blocked and pending; repeat the same authorized `DELETE /:id/files` request to retry incomplete jobs. There is no background deletion worker yet, so retries are request-driven. A storage success followed by a database failure also remains blocked and retryable; object deletion is safe to repeat. The endpoint removes binary objects only; document/version metadata, relationships, and append-only audit events remain. Folders, categories, tags, and audit history have no physical-delete endpoint.

## Permission definitions

`documents:read`, `documents:create`, `documents:update`, `documents:download`, `documents:archive`, `documents:restore`, `documents:manage`, and `documents:approve` are seeded as database permissions and enforced server-side. The migration maps these permissions to the existing roles; organizations can adapt role grants through their normal RBAC administration process.
