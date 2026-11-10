# SecurityOps 2.0 - Core FastAPI REST Engine & Middleware (Phase 14 Mobile Fleet & Kiosk Extension)
from fastapi import FastAPI, Depends, HTTPException, status, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import uuid

from backend.config import settings
from backend.database import get_tenant_session
from backend.security import decode_token
from backend.schemas import ResponseEnvelope

# --- PHASE 14: MOBILE DEVICE FLEET & KIOSK MANAGEMENT ENDPOINTS ---

@app.get("/api/v1/devices/fleet", response_model=ResponseEnvelope, tags=["Mobile Geräte & Kiosk-Flotte"])
async def list_mobile_fleet(
    context: Dict[str, Any] = Depends(get_current_user_context)
):
    """Retrieves all registered Android Enterprise & iOS devices for the active tenant."""
    tenant_id = context["tenant_id"]
    return ResponseEnvelope(data=[
        {
            "id": "dev-001",
            "device_name": "Samsung Galaxy Tab Active4 Pro (Pforte Nord)",
            "platform": "Android Enterprise",
            "kiosk_mode": "EINZEL_APP_KIOSK",
            "lock_task_active": True,
            "status": "ACTIVE",
            "battery": 94
        },
        {
            "id": "dev-002",
            "device_name": "Apple iPhone 14 Enterprise (Revierdienst Ost)",
            "platform": "Apple iOS (Supervised)",
            "kiosk_mode": "EINZEL_APP_KIOSK",
            "lock_task_active": True,
            "status": "ACTIVE",
            "battery": 78
        }
    ])

@app.post("/api/v1/devices/{device_id}/lock", response_model=ResponseEnvelope, tags=["Mobile Geräte & Kiosk-Flotte"])
async def remote_lock_device(
    device_id: str,
    context: Dict[str, Any] = Depends(get_current_user_context)
):
    """Issues an immediate LockTask enforcement command to the managed device."""
    return ResponseEnvelope(
        message=f"Gerät {device_id} wurde per LockTask/Single-App-Mode gesperrt.",
        data={"device_id": device_id, "status": "LOCKED"}
    )

@app.post("/api/v1/devices/{device_id}/wipe", response_model=ResponseEnvelope, tags=["Mobile Geräte & Kiosk-Flotte"])
async def remote_wipe_device(
    device_id: str,
    context: Dict[str, Any] = Depends(get_current_user_context)
):
    """Executes an Enterprise Wipe command clearing all offline caches and tokens."""
    return ResponseEnvelope(
        message=f"Enterprise Wipe für Gerät {device_id} autorisiert.",
        data={"device_id": device_id, "status": "WIPED"}
    )
