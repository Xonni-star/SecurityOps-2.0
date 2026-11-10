# backend/app/main.py
"""
SecurityOps 2.0 - Zentraler FastAPI Enterprise Application Entrypoint (Phase 3)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.core.config import settings
from backend.app.core.middleware import TenantContextMiddleware
from backend.app.api.v1.auth_router import router as auth_router
from backend.app.api.v1.wachbuch_router import router as wachbuch_router
from backend.app.api.v1.sync_router import router as sync_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="DIN 77200 & § 34a GewO zertifizierte Sicherheitsdienstverwaltung • Multi-Tenant RLS • Offline First",
    version=settings.VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json"
)

# 1. CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Mandanten-Isolierungs- und RLS-Injektions-Middleware
app.add_middleware(TenantContextMiddleware)

# 3. Router-Registrierung (/api/v1/*)
app.include_router(auth_router, prefix=settings.API_V1_STR)
app.include_router(wachbuch_router, prefix=settings.API_V1_STR)
app.include_router(sync_router, prefix=settings.API_V1_STR)

@app.get("/api/health")
async def health_check():
    return {
        "status": "ONLINE",
        "version": settings.VERSION,
        "engine": "FastAPI + SQLAlchemy 2.0 Async + PostgreSQL 16 RLS",
        "multi_tenancy": "ACTIVE",
        "offline_sync_engine": "ACTIVE"
    }
