# SecurityOps 2.0 - Core PostgreSQL Database Models (SQLAlchemy 2.0 Declarative)
# Covers Modules A through M with Phase 14 Kiosk Mode & Mobile Fleet Management

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
# PHASE 14: KIOSK MODE & MOBILE FLEET MANAGEMENT MODELS
# ==============================================================================

class KioskProfileModel(Base, TenantMixin, AuditMixin):
    __tablename__ = "kiosk_station_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    profile_type: Mapped[str] = mapped_column(String(50), nullable=False) # PFORTE, RUNDGANG, WACHBUCH
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    allowed_views_json: Mapped[List[str]] = mapped_column(JSONB, nullable=False)
    default_kiosk_mode: Mapped[str] = mapped_column(String(50), default="EINZEL_APP_KIOSK")
    auto_logout_minutes: Mapped[int] = mapped_column(Integer, default=15)
    prevent_screen_capture: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "profile_type", name="uq_kiosk_profile_tenant"),
    )

class MobileFleetDeviceModel(Base, TenantMixin):
    __tablename__ = "mobile_fleet_devices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    device_name: Mapped[str] = mapped_column(String(150), nullable=False)
    platform: Mapped[str] = mapped_column(String(50), default="Android Enterprise")
    app_version: Mapped[str] = mapped_column(String(50), default="2.0.4")
    os_version: Mapped[str] = mapped_column(String(50), default="Android 14")
    battery_level: Mapped[int] = mapped_column(Integer, default=100)
    assigned_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    assigned_station_profile: Mapped[str] = mapped_column(String(50), default="PFORTE")
    current_kiosk_mode: Mapped[str] = mapped_column(String(50), default="EINZEL_APP_KIOSK")
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE") # ACTIVE, LOCKED, REVOKED, WIPED
    lock_task_mode_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_contact_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("tenant_id", "device_id", name="uq_tenant_fleet_device"),
    )
