# SecurityOps 2.0 - Core PostgreSQL Database Models (SQLAlchemy 2.0 Declarative)
# Covers Modules A through M with Phase 9 Reporting, Controlling & KPI Definitions

from __future__ import annotations
import uuid
from datetime import datetime, date
from enum import Enum
from typing import List, Optional, Dict, Any

from sqlalchemy import (
    String, Text, Boolean, Integer, Float, DateTime, Date, ForeignKey,
    ForeignKeyConstraint, UniqueConstraint, Index, CheckConstraint, JSON,
    Enum as SAEnum, func
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship
)
from sqlalchemy.dialects.postgresql import UUID, JSONB

class Base(DeclarativeBase):
    pass

class TenantMixin:
    """Enforces tenant ownership and composite cross-tenant foreign-key isolation."""
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )

class AuditMixin:
    """Tracks creation, update, and soft-deletion metadata."""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False
    )
    created_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

class OfflineSyncMixin:
    """Idempotency, client timestamps and change tracking for offline clients."""
    client_mutation_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, nullable=True)
    device_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    revision_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    sync_status: Mapped[str] = mapped_column(String(20), default="SYNCED", nullable=False)
    occurred_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    server_sequence: Mapped[int] = mapped_column(Integer, server_default="0", nullable=False, index=True)

# ==============================================================================
# PHASE 9: REPORTING & CONTROLLING MODELS
# ==============================================================================

class ReportDefinitionModel(Base, TenantMixin, AuditMixin):
    __tablename__ = "report_definitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False) # GESCHAEFTSFUEHRUNG, EINSATZLEITUNG, etc.
    data_source: Mapped[str] = mapped_column(String(50), nullable=False) # shifts, guardbook, employees
    selected_columns_json: Mapped[List[str]] = mapped_column(JSONB, nullable=False)
    filter_config_json: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    group_by: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    schedule_interval: Mapped[str] = mapped_column(String(20), default="NONE") # DAILY, WEEKLY, MONTHLY, NONE
    last_generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_report_def_tenant"),
    )
