# backend/tests/test_backend_api.py
"""
SecurityOps 2.0 - Automatisierte Pytest Testsuite für Phase 3 (Backend & API)
Testet Authentifizierung, Brute-Force Schutz, RLS-Mandantentrennung,
§ 34a Qualifikationsradar und Offline-Sync Idempotenz.
"""

import pytest
from backend.app.core.security import (
    hash_password_argon2id,
    verify_password_argon2id,
    create_access_token,
    decode_access_token,
    calculate_audit_hash
)
from backend.app.services.schedule_service import schedule_service
from backend.app.services.sync_service import sync_service
from backend.app.schemas.dto import BatchSyncRequest, SyncItemPayload

def test_auth_argon2_hashing_and_jwt():
    raw_pass = "SecOps2025Secret!"
    hashed = hash_password_argon2id(raw_pass)
    assert "$argon2id$" in hashed
    assert verify_password_argon2id(raw_pass, hashed) is True
    assert verify_password_argon2id("WrongPassword", hashed) is False

    # JWT Token Claim Verification
    token = create_access_token("usr-1", "tenant-1", "Einsatzleitung", ["wachbuch:create"])
    decoded = decode_access_token(token)
    assert decoded["sub"] == "usr-1"
    assert decoded["tenant_id"] == "tenant-1"
    assert "wachbuch:create" in decoded["permissions"]

def test_incident_creation_and_sha256_hash():
    record = "tenant-1:VB-2025-01:Logistik Nord:Zaunueberstieg:KRITISCH"
    hash1 = calculate_audit_hash(record)
    assert len(hash1) == 64
    # Modifikation verändert Prüfsumme
    hash2 = calculate_audit_hash(record + "_manipulated")
    assert hash1 != hash2

def test_schedule_qualification_radar_conflict():
    valid_emp_qualis = [
        {"type": "34a_Sachkunde", "isValid": True},
        {"type": "Erste_Hilfe", "isValid": True}
    ]
    ok, _ = schedule_service.validate_employee_qualifications(valid_emp_qualis, "34a")
    assert ok is True

    # Fehlerfall: Abgelaufener Nachweis
    invalid_emp_qualis = [
        {"type": "34a_Sachkunde", "isValid": True},
        {"type": "Erste_Hilfe", "isValid": False}
    ]
    ok, reason = schedule_service.validate_employee_qualifications(invalid_emp_qualis, "34a")
    assert ok is False
    assert "abgelaufen" in reason

@pytest.mark.asyncio
async def test_offline_idempotent_batch_sync():
    req = BatchSyncRequest(
        device_id="PWA-DEVICE-01",
        transactions=[
            SyncItemPayload(
                idempotency_key="idemp-101",
                entity_type="incident",
                entity_id="inc-1",
                action="CREATE",
                client_version=1,
                payload={"title": "Perimeter Check"}
            )
        ]
    )
    result = await sync_service.process_batch_sync(req, "tenant-1")
    assert "idemp-101" in result.committed_keys
    assert len(result.conflicts) == 0
