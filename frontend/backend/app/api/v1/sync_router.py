# backend/app/api/v1/sync_router.py
"""
FastAPI Offline Sync Engine Router (/api/v1/sync)
"""

from fastapi import APIRouter, Request
from backend.app.schemas.dto import BatchSyncRequest, BatchSyncResult
from backend.app.services.sync_service import sync_service

router = APIRouter(prefix="/sync", tags=["Offline-First Sync Engine"])

@router.post("/batch", response_model=BatchSyncResult)
async def process_sync_batch(data: BatchSyncRequest, request: Request):
    """
    Nimmt Offline-Transaktionspakete idempotent entgegen und löst OCC-Konflikte.
    """
    tenant_id = getattr(request.state, "tenant_id", "tenant-1")
    return await sync_service.process_batch_sync(data, tenant_id)
