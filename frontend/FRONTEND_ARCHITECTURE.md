# SecurityOps 2.0 - Phase 4 Frontend Architecture & UI/UX Specification

## 1. Architectural Stack
- **Framework**: React 18+ with TypeScript in strict mode
- **Styling**: Tailwind CSS (Dark/Light mode support with WCAG AA compliance)
- **State Management**: Zustand with persistent stores and localized tenant filtering
- **Offline Data Storage**: Native IndexedDB (`SecurityOps2_OfflineVault`) for offline guardbooks, queues and scans
- **REST Client**: Centralized `apiClient` supporting JWT Bearer claims and multi-tenant isolation headers

---

## 2. Multi-Tenant UI Isolation Contract
- The frontend extracts data purely via tenant-partitioned selectors (`getTenantSites`, `getTenantGuardBook`, etc.).
- When switching tenants using the Navbar dropdown, the active view and all module lists immediately synchronize to the selected company partition without page reloads.

---

## 3. Offline-First Resilience
- Network simulation allows switching to offline mode on demand.
- In offline mode, all guardbook entries, task completions and shift edits are persisted to IndexedDB and staged in `syncQueue`.
- When connectivity is restored, the queue is synced idempotently with the backend.
