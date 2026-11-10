# SecurityOps 2.0 - Phase 3 Backend & API Specification

## 1. Architectural Overview
The SecurityOps 2.0 Backend is constructed as a decoupled, multi-tenant Python FastAPI service operating with SQLAlchemy 2.0 and PostgreSQL 16+ Row Level Security (RLS).

### Architectural Layers
1. **API Router Layer (`backend/api.py`)**: Request validation, HTTP status mapping, and OpenAPI contracts.
2. **Security & Cryptography (`backend/security.py`)**: Argon2id hashing, verified JWT claims, and brute-force tracking.
3. **Pydantic Validation Schemas (`backend/schemas.py`)**: Strict input/output sanitation.
4. **Service & Domain Layer (`backend/services.py`)**: Enforces multi-tenant business rules and conflict checks.
5. **Database ORM (`backend/models.py`)**: Declarative models with composite foreign keys `(id, tenant_id)`.

---

## 2. Strict Multi-Tenant Enforcement Contract
To prevent authorization bypasses, **the backend never trusts a tenant_id sent in request bodies or query headers**.
- The tenant context is extracted strictly from the cryptographically verified JWT token claims.
- The `tenant_context_middleware` injects `app.current_tenant` into the PostgreSQL session, causing Row Level Security (RLS) to physically filter queries.

---

## 3. Offline-First Sync Contract
The `/api/v1/sync/push` endpoint handles intermittent connectivity gracefully:
- Every client mutation carries a unique `client_uuid`.
- Re-transmissions of identical UUIDs are handled idempotently.
- If a client attempts to update a record whose server revision counter is ahead of the client's version, the system marks the mutation as `CONFLICT` and records it in `sync_conflicts` for review rather than overwriting data destructively.
