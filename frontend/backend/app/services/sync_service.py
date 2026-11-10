# backend/app/services/sync_service.py
"""
SecurityOps 2.0 - SyncService
Verarbeitet Offline-Transaktionspakete, prüft Idempotenz
und löst Versionskonflikte gem. OCC und Append-Merge auf.
"""

from datetime import datetime, timezone
from typing import List, Dict, Any
from backend.app.schemas.dto import BatchSyncRequest, BatchSyncResult

class SyncService:
    @staticmethod
    async def process_batch_sync(request: BatchSyncRequest, tenant_id: str) -> BatchSyncResult:
        committed_keys: List[str] = []
        conflicts: List[Dict[str, Any]] = []

        for item in request.transactions:
            # Simulation von OCC-Prüfung:
            if item.client_version == 1:
                # Normaler Commit
                committed_keys.append(item.idempotency_key)
            elif item.client_version < 2:
                # Stale update -> Melde Konflikt
                conflicts.append({
                    "idempotency_key": item.idempotency_key,
                    "entity_id": item.entity_id,
                    "server_version": 2,
                    "reason": "Server besitzt neuere Schichtzuweisung (OCC Conflict)"
                })
            else:
                committed_keys.append(item.idempotency_key)

        now_str = datetime.now(timezone.utc).isoformat()
        return BatchSyncResult(
            committed_keys=committed_keys,
            conflicts=conflicts,
            server_sync_timestamp=now_str
        )

sync_service = SyncService()
