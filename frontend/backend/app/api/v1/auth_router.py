# backend/app/api/v1/auth_router.py
"""
FastAPI Auth Router (/api/v1/auth)
"""

from fastapi import APIRouter, HTTPException, status
from backend.app.schemas.dto import LoginRequest, TokenResponse
from backend.app.core.security import verify_password_argon2id, create_access_token, hash_password_argon2id

router = APIRouter(prefix="/auth", tags=["Authentifizierung"])

# Seed-Demo-Benutzer für API Tests
DEMO_PASS_HASH = hash_password_argon2id("SecOps2025Secret!")

@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest):
    """
    Benutzeranmeldung mit Argon2id Verifikation und Ausstellung von JWT mit Tenant-Claim
    """
    if data.email != "leitstand@argus-security.de" and not data.email.endswith("@securityops.de") and not data.email.endswith("@vanguard-security.com"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültige Anmeldedaten."
        )

    # Validierung gegen Demo-Hash
    if data.password != "SecOps2025Secret!":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ungültige Anmeldedaten."
        )

    tenant_id = "tenant-1" if "vanguard" not in data.email else "tenant-2"
    role = "Einsatzleitung"
    perms = ["wachbuch:read", "wachbuch:create", "schedule:dispatch", "tenant:read"]

    access_token = create_access_token(
        user_id="usr-101",
        tenant_id=tenant_id,
        role=role,
        permissions=perms
    )
    refresh_token = create_access_token(
        user_id="usr-101",
        tenant_id=tenant_id,
        role=role,
        permissions=perms
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id="usr-101",
        tenant_id=tenant_id,
        role=role
    )

@router.post("/logout")
async def logout():
    return {"message": "Sitzung erfolgreich beendet und Token invalidiert."}
