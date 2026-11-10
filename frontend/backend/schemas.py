# SecurityOps 2.0 - Enterprise Pydantic v2 Request & Response Schemas
from typing import List, Optional, Dict, Any
from datetime import datetime, date
import uuid
from pydantic import BaseModel, Field, EmailStr

# Standard Envelope for Unified Responses
class ResponseEnvelope(BaseModel):
    success: bool = True
    message: str = "Operation successful"
    data: Optional[Any] = None
    errors: Optional[List[str]] = None

class PaginationParams(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    search: Optional[str] = None
    sort_by: Optional[str] = "created_at"
    sort_desc: bool = True

# --- AUTH SCHEMAS ---
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    tenant_id: Optional[uuid.UUID] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in_seconds: int
    tenant_id: uuid.UUID
    tenant_name: str
    user_id: uuid.UUID
    full_name: str
    role: str
    permissions: List[str]

class UserProfile(BaseModel):
    id: uuid.UUID
    email: EmailStr
    first_name: str
    last_name: str
    phone: Optional[str] = None
    role: str
    tenant_id: uuid.UUID
    tenant_name: str
    is_superadmin: bool

# --- TENANT SCHEMAS ---
class TenantCreate(BaseModel):
    name: str = Field(min_length=3, max_length=200)
    subdomain: str = Field(min_length=3, max_length=100)
    tax_number: str = Field(min_length=5, max_length=50)
    bwr_register_id: str = Field(min_length=5, max_length=50)
    license_tier: str = "ENTERPRISE"
    din77200_certified: bool = True

class TenantResponse(TenantCreate):
    id: uuid.UUID
    is_active: bool
    created_at: datetime

# --- CUSTOMER & OBJECT SCHEMAS ---
class CustomerCreate(BaseModel):
    customer_number: str = Field(min_length=2, max_length=50)
    company_name: str = Field(min_length=2, max_length=200)
    contact_person: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str
    billing_address: str
    sla_level: str = "Gold (24/7)"

class CustomerResponse(CustomerCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

class SecurityObjectCreate(BaseModel):
    customer_id: uuid.UUID
    site_code: str = Field(min_length=2, max_length=50)
    name: str = Field(min_length=2, max_length=200)
    street_address: str
    postal_code: str
    city: str
    security_level: str = "KRITIS"
    required_guards_day: int = Field(default=2, ge=0)
    required_guards_night: int = Field(default=2, ge=0)
    alarm_system: Optional[str] = None
    access_rules: Optional[str] = None

class SecurityObjectResponse(SecurityObjectCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

# --- EMPLOYEE SCHEMAS ---
class EmployeeCreate(BaseModel):
    personnel_number: str = Field(min_length=2, max_length=50)
    first_name: str = Field(min_length=2, max_length=100)
    last_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str
    role_designation: str = "Wachdienst"
    status: str = "Aktiv"
    weekly_hours: float = 40.0
    hourly_rate: float = 18.50
    date_of_joining: date

class EmployeeResponse(EmployeeCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

# --- LOGBOOK & INCIDENT SCHEMAS ---
class LogbookEntryCreate(BaseModel):
    object_id: uuid.UUID
    guard_id: uuid.UUID
    entry_timestamp: datetime = Field(default_factory=datetime.utcnow)
    category: str = Field(min_length=2, max_length=50)
    priority: str = "Normal"
    stage: str = "Erfasst"
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=5)
    police_involved: bool = False
    checkpoint_code: Optional[str] = None
    client_mutation_id: Optional[str] = None
    occurred_at: Optional[datetime] = None

class LogbookEntryResponse(LogbookEntryCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    is_resolved: bool
    resolution_note: Optional[str] = None
    created_at: datetime

# --- SHIFT & ROSTER SCHEMAS ---
class ShiftCreate(BaseModel):
    object_id: uuid.UUID
    assigned_employee_id: Optional[uuid.UUID] = None
    shift_date: date
    start_time: str = "06:00"
    end_time: str = "18:00"
    shift_type: str = "Tagdienst"
    status: str = "Besetzt"
    required_qualification: str = "Sachkundeprüfung § 34a GewO"
    conflict_reason: Optional[str] = None

class ShiftResponse(ShiftCreate):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

# --- OFFLINE SYNC SCHEMAS (PHASE 6) ---

class SyncMutationItem(BaseModel):
    client_uuid: str
    entity_type: str # 'logbook', 'shift', 'task', 'key', 'attachment'
    action: str      # 'CREATE', 'UPDATE', 'DELETE'
    client_timestamp: datetime
    base_version: int = 1
    version: int = 1
    payload: Dict[str, Any]

class SyncBatchRequest(BaseModel):
    device_id: str
    mutations: List[SyncMutationItem]

class SyncMutationResult(BaseModel):
    client_uuid: str
    server_id: str
    status: str # 'SYNCED', 'CONFLICT', 'REJECTED'
    server_version: int
    conflict_data: Optional[Dict[str, Any]] = None
    message: Optional[str] = None

class SyncPullRequest(BaseModel):
    device_id: str
    since_sequence: int = 0
    limit: int = Field(default=100, le=500)

class SyncPullResponse(BaseModel):
    latest_sequence: int
    has_more: bool
    changes: List[Dict[str, Any]]

class DeviceRegisterRequest(BaseModel):
    device_fingerprint: str
    device_name: str

class DeviceRevokeRequest(BaseModel):
    device_id: str
    reason: str

class ConflictResolveRequest(BaseModel):
    conflict_id: str
    strategy: str # 'USE_LOCAL', 'USE_SERVER', 'MERGE'
    merged_data: Optional[Dict[str, Any]] = None
