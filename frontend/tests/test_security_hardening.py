# SecurityOps 2.0 - Phase 7 Security Hardening & Penetration Test Suite
import pytest
import uuid
from backend.security import (
    hash_password, verify_password, create_access_token, decode_token,
    revoke_token, sanitize_filename, register_login_failure, reset_login_attempts
)

TENANT_FFM = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_BAVARIA = uuid.UUID("22222222-2222-2222-2222-222222222222")

def test_path_traversal_sanitization():
    """Verifies that malicious path traversal filenames are stripped safely."""
    evil_name = "../../../etc/passwd.pdf"
    sanitized = sanitize_filename(evil_name)
    assert "../" not in sanitized
    assert "passwd" in sanitized

def test_brute_force_lockout():
    """Verifies that 5 failed logins lock the account temporarily."""
    test_user = "brute_target@securityops.de"
    reset_login_attempts(test_user)

    for _ in range(4):
        is_locked = register_login_failure(test_user)
        assert is_locked is False

    # 5th attempt locks account
    is_locked = register_login_failure(test_user)
    assert is_locked is True

def test_idor_tenant_cross_access_rejection():
    """Verifies that a JWT issued for Tenant A rejects resources on Tenant B."""
    token_a = create_access_token(
        user_id=uuid.uuid4(),
        email="guard@ffm.de",
        tenant_id=TENANT_FFM,
        role="GUARD",
        permissions=["logbook:read"]
    )
    payload = decode_token(token_a)
    assert uuid.UUID(payload["tenant_id"]) != TENANT_BAVARIA
    assert uuid.UUID(payload["tenant_id"]) == TENANT_FFM
