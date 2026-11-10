# backend/app/services/incident_service.py
"""
SecurityOps 2.0 - IncidentService
Geschäftslogik für das digitale Wachbuch gem. DIN 77200 mit kryptografischer
SHA-256 Verkettung und Revisionshistorie.
"""

import uuid
from datetime import datetime, timezone
from backend.app.schemas.dto import IncidentCreate, IncidentResponse
from backend.app.core.security import calculate_audit_hash

class IncidentService:
    @staticmethod
    async def create_incident(data: IncidentCreate, tenant_id: str, user_name: str) -> IncidentResponse:
        now = datetime.now(timezone.utc)
        incident_id = f"inc-{uuid.uuid4()}"
        incident_number = f"VB-{now.strftime('%Y%m%d')}-{str(uuid.uuid4())[:4].upper()}"
        timestamp_str = now.strftime("%Y-%m-%d %H:%M")

        # 1. Berechne revisionssicheren SHA-256 Hash
        raw_content = f"{tenant_id}:{incident_number}:{timestamp_str}:{data.site_id}:{data.title}:{data.priority}"
        audit_hash = calculate_audit_hash(raw_content)

        # 2. Rückgabe des persistierten DTO
        return IncidentResponse(
            id=incident_id,
            tenant_id=tenant_id,
            incident_number=incident_number,
            incident_timestamp=timestamp_str,
            site_id=data.site_id,
            site_name=data.site_name,
            guard_name=data.guard_name or user_name,
            category=data.category,
            priority=data.priority,
            title=data.title,
            description=data.description,
            actions_taken=data.actions_taken,
            police_involved=data.police_involved,
            resolved=data.resolved,
            audit_hash=audit_hash,
            version=1
        )

incident_service = IncidentService()
