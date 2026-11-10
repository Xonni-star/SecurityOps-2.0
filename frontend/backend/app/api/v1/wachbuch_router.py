# backend/app/api/v1/wachbuch_router.py
"""
FastAPI Digitales Wachbuch Router (/api/v1/wachbuch)
"""

from fastapi import APIRouter, Request, status
from backend.app.schemas.dto import IncidentCreate, IncidentResponse
from backend.app.services.incident_service import incident_service

router = APIRouter(prefix="/wachbuch", tags=["Digitales Wachbuch"])

@router.post("/incidents", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(data: IncidentCreate, request: Request):
    """
    Erstellt einen revisionssicheren Wachbucheintrag nach DIN 77200
    mit kryptografischer SHA-256 Prüfsumme.
    """
    tenant_id = getattr(request.state, "tenant_id", "tenant-1")
    user_name = getattr(request.state, "user_id", "Timo Kranz")
    return await incident_service.create_incident(data, tenant_id, user_name)

@router.get("/health")
async def wachbuch_health():
    return {"status": "ONLINE", "module": "mod-wachbuch", "din77200_audit": "ACTIVE"}
