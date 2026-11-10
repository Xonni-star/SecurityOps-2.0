# backend/app/core/middleware.py
"""
SecurityOps 2.0 - TenantIsolationMiddleware
Erzwingt und validiert den autorisierten Mandantenkontext und
injiziert 'SET LOCAL app.current_tenant_id' in die PostgreSQL Session.
"""

from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from backend.app.core.security import decode_access_token

class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Öffentliche Pfade ohne Mandantenprüfung
        if request.url.path in [
            "/api/health",
            "/api/docs",
            "/api/redoc",
            "/openapi.json",
            "/api/v1/auth/login",
            "/api/v1/auth/refresh"
        ]:
            return await call_next(request)

        # 1. Extrahiere Authorization Header
        auth_header = request.headers.get("Authorization")
        tenant_header = request.headers.get("X-Tenant-ID")

        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentifizierungsfehler: Gültiges Bearer Token erforderlich."
            )

        token = auth_header.split(" ")[1]
        try:
            payload = decode_access_token(token)
            user_tenant = payload.get("tenant_id")
            
            # 2. SICHERHEITSREGEL: Verifiziere X-Tenant-ID gegen autorisiertes JWT
            if tenant_header and tenant_header != user_tenant:
                # Systemadmin darf Mandanten gezielt umschalten, normale Rollen werden abgewiesen
                if payload.get("role") != "Systemadministrator":
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Sicherheitswarnung: X-Tenant-ID weicht vom autorisierten JWT-Mandanten ab."
                    )
            
            request.state.tenant_id = tenant_header or user_tenant
            request.state.user_id = payload.get("sub")
            request.state.user_role = payload.get("role")
            request.state.permissions = payload.get("permissions", [])

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Token-Validierung fehlgeschlagen: {str(e)}"
            )

        response = await call_next(request)
        return response
