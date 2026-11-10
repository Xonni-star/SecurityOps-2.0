# backend/database.py
"""
SecurityOps 2.0 - Datenbank- und Session-Verwaltung (Phase 2)
Implementiert Connection Pooling, Transaktionssteuerung und strikte
RLS-Mandantenkontext-Injektion für PostgreSQL 16.
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
    AsyncEngine
)
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://secops_admin:SecOps2025Secret!@localhost:5432/securityops2"
)

# Robuster Enterprise Connection Pool
engine: AsyncEngine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

class Base(DeclarativeBase):
    """Zentrale Basisklasse für alle SQLAlchemy 2.0 Modelle"""
    pass

@asynccontextmanager
async def get_tenant_session(tenant_id: str) -> AsyncGenerator[AsyncSession, None]:
    """
    Öffnet eine Datenbank-Session und injiziert den PostgreSQL RLS-Mandantenkontext:
    SET LOCAL app.current_tenant_id = :tenant_id
    Verhindert Datenlecks auf Datenbank-Kernel-Ebene.
    """
    async with async_session_factory() as session:
        try:
            # Mandantenkontext lokal für die aktuelle Transaktion setzen
            await session.execute(
                text("SET LOCAL app.current_tenant_id = :tenant_id"),
                {"tenant_id": str(tenant_id)}
            )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
