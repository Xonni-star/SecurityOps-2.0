# backend/app/schemas/dto.py
"""
Pydantic v2 DTO Schemas für SecurityOps 2.0 API Endpunkte (Phase 3)
"""

from datetime import datetime, date
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, EmailStr, Field

# --- Auth ---
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    device_id: Optional[str] = "PWA-CLIENT-WEB"

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: str
    tenant_id: str
    role: str

# --- Incidents (Digitales Wachbuch) ---
class IncidentCreate(BaseModel):
    site_id: str
    site_name: str
    guard_name: str
    category: str
    priority: str
    title: str = Field(..., max_length=255)
    description: str
    actions_taken: str
    police_involved: bool = False
    resolved: bool = False
    images_count: int = 0
    idempotency_key: Optional[str] = None

class IncidentResponse(BaseModel):
    id: str
    tenant_id: str
    incident_number: str
    incident_timestamp: str
    site_id: str
    site_name: str
    guard_name: str
    category: str
    priority: str
    title: str
    description: str
    actions_taken: str
    police_involved: bool
    resolved: bool
    audit_hash: str
    version: int

# --- Schedule (Dienstplanung) ---
class ShiftAssignRequest(BaseModel):
    shift_id: str
    employee_id: str
    shift_date: date

class ShiftResponse(BaseModel):
    id: str
    tenant_id: str
    date: str
    shift_type: str
    site_id: str
    site_name: str
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    status: str
    has_conflict: bool
    conflict_reason: Optional[str] = None
    hours: float
    version: int

# --- Offline Batch Sync ---
class SyncItemPayload(BaseModel):
    idempotency_key: str
    entity_type: str
    entity_id: str
    action: str  # CREATE, UPDATE, DELETE
    client_version: int
    payload: Dict[str, Any]

class BatchSyncRequest(BaseModel):
    device_id: str
    transactions: List[SyncItemPayload]

class BatchSyncResult(BaseModel):
    committed_keys: List[str]
    conflicts: List[Dict[str, Any]]
    server_sync_timestamp: str
