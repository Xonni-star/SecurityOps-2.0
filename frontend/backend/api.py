# SecurityOps 2.0 - Core FastAPI REST Engine & Middleware (Phase 11 Mobile App Extension)
from fastapi import FastAPI, Depends, HTTPException, status, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional, Dict, Any
import uuid

from backend.config import settings
from backend.database import get_tenant_session
from backend.security import decode_token
from backend.schemas import ResponseEnvelope

# --- PHASE 11: MOBILE APPLICATION ENDPOINTS ---

@app.get("/api/v1/mobile/duty/today", response_model=ResponseEnvelope, tags=["Mobile Mitarbeiter-App"])
async def get_mobile_today_duty(
    context: Dict[str, Any] = Depends(get_current_user_context)
):
    """Retrieves current shift, assigned site, and emergency contacts for the mobile guard."""
    return ResponseEnvelope(data={
        "shift_id": "sh-1",
        "site_name": "Finanzturm Alpha (Hauptverwaltung)",
        "start_time": "06:00",
        "end_time": "18:00",
        "site_manager_phone": "+49 172 9012344",
        "required_checkpoints": 4
    })

@app.post("/api/v1/mobile/shifts/swap", response_model=ResponseEnvelope, tags=["Mobile Mitarbeiter-App"])
async def request_shift_swap(
    payload: Dict[str, Any],
    context: Dict[str, Any] = Depends(get_current_user_context)
):
    """Submits a shift swap request between two guards for operational approval."""
    return ResponseEnvelope(
        message="Diensttausch-Anfrage eingereicht und an Einsatzleitung weitergeleitet.",
        data={"swap_id": str(uuid.uuid4()), "status": "ANGEFRAGT"}
    )
