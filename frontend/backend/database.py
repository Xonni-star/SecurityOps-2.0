# SecurityOps 2.0 - Async Database Engine & Tenant Context Manager
from contextlib import asynccontextmanager
import os
import uuid
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession
)
from sqlalchemy import text, event
from sqlalchemy.pool import NullPool, AsyncAdaptedQueuePool

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://secops_admin:SecOpsVault2025Secure@localhost:5432/securityops_v2"
)

# Enterprise connection pool configured for 24/7 Leitstellenbetrieb
engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=False
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

async def set_tenant_context(session: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Sets PostgreSQL session variable used by Row Level Security (RLS) policies."""
    await session.execute(
        text("SELECT set_config('app.current_tenant', :tenant_id, true)"),
        {"tenant_id": str(tenant_id)}
    )

@asynccontextmanager
async def get_tenant_session(tenant_id: uuid.UUID) -> AsyncGenerator[AsyncSession, None]:
    """Dependency / context manager injecting tenant isolation into the database transaction."""
    async with AsyncSessionLocal() as session:
        try:
            await set_tenant_context(session, tenant_id)
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
