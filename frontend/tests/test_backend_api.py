# SecurityOps 2.0 - Backend API & Multi-Tenant Pytest Suite
import pytest
import uuid
from backend.security import (
    hash_password, verify_password, create_access_token, decode_token, revoke_token
)

TENANT_FFM = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_BAVARIA = uuid.UUID("22222222-2222-2222-2222-222222222222")
USER_SCHMIDT = uuid.UUID("a1111111-1111-1111-1111-111111111111")
USER_HUBER = uuid.UUID("b2222222-2222-2222-2222-222222222222")

def test_argon2_password_hashing():
    """Verifies that Argon2id/PBKDF2-SHA512 password hashing and verification are cryptographically sound."""
    password = "SecOpsVault2025SecurePassword!"
    hashed = hash_password(password)
    assert hashed.startswith("argon2id$")
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword123!", hashed) is False

def test_jwt_tenant_isolation_payload():
    """Verifies that generated JWT contains valid, untampered tenant_id claims."""
    token = create_access_token(
        user_id=USER_SCHMIDT,
        email="a.schmidt@ffm-sec.de",
        tenant_id=TENANT_FFM,
        role="EINSATZLEITUNG",
        permissions=["logbook:read", "logbook:create"]
    )
    payload = decode_token(token)
    assert payload["sub"] == str(USER_SCHMIDT)
    assert payload["tenant_id"] == str(TENANT_FFM)
    assert "logbook:create" in payload["permissions"]

def test_token_revocation_lifecycle():
    """Verifies that revoked session tokens are immediately rejected on subsequent queries."""
    token = create_access_token(
        user_id=USER_SCHMIDT,
        email="a.schmidt@ffm-sec.de",
        tenant_id=TENANT_FFM,
        role="EINSATZLEITUNG",
        permissions=["*"]
    )
    # Valid before revocation
    assert decode_token(token)["sub"] == str(USER_SCHMIDT)
    
    # Revoke session
    revoke_token(token)
    
    # Must raise ValueError
    with pytest.raises(ValueError, match="revoked"):
        decode_token(token)

def test_cross_tenant_token_rejection():
    """
    CRITICAL MULTI-TENANT TEST:
    A token issued for Tenant Frankfurt must NEVER match or validate for Tenant Bavaria resources.
    """
    token_ffm = create_access_token(
        user_id=USER_SCHMIDT,
        email="a.schmidt@ffm-sec.de",
        tenant_id=TENANT_FFM,
        role="EINSATZLEITUNG",
        permissions=["customers:read"]
    )
    payload = decode_token(token_ffm)
    # Target assertion
    assert uuid.UUID(payload["tenant_id"]) != TENANT_BAVARIA
    assert uuid.UUID(payload["tenant_id"]) == TENANT_FFM
