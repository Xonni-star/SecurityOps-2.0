# DMS REST API

Base path: `/api/v1/documents`. All endpoints require an authenticated cookie session. Tenant context always comes from the authenticated `user_sessions` row; a request cannot select a tenant. The exact permission for each route is listed below.

Uploads use `Content-Type: application/octet-stream`, `X-File-Name` (URL-encoded UTF-8 basename), and the cookie/CSRF requirements used by other mutation routes. Metadata is sent as URL query parameters for the initial upload. The server validates the maximum size, extension, signature and supported format before writing to private storage. Binary downloads return the raw file; errors retain the standard JSON response envelope.

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
| `POST /:id/versions/:version/restore` | `documents:update` | Restore an older version as a new version |
| `POST /:id/archive` | `documents:archive` | Soft-archive; no file/version is deleted |
| `POST /:id/restore` | `documents:restore` | Restore an archived document |
| `POST /:id/move` | `documents:update` | Move to a tenant folder or root (`folderId: null`) |
| `PATCH /:id/relationship` | `documents:update` | Change/remove the tenant-validated relationship |
| `GET /:id/audit` | `documents:read` | Read append-only DMS audit history |

Supported relationship types are `customer`, `site`, `employee`, `shift`, and `incident` (a persisted `guardbook_entries` row). Relationship IDs are validated against a same-tenant PostgreSQL row and composite foreign key. SOP and alarm/incident-management module records do not yet have backend persistence and are not accepted as fake links.

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

Tags are created and assigned through `PATCH /:id` using `tags: string[]`. There is deliberately no physical delete endpoint for documents, versions, folders, categories, tags, or audit events.

## Permission definitions

`documents:read`, `documents:create`, `documents:update`, `documents:download`, `documents:archive`, `documents:restore`, `documents:manage`, and `documents:approve` are seeded as database permissions and enforced server-side. The migration maps these permissions to the existing roles; organizations can adapt role grants through their normal RBAC administration process.
