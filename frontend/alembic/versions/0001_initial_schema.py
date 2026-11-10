"""0001_initial_schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2025-05-15 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RLS_TABLES = [
    "tenant_settings",
    "customers",
    "objects",
    "object_control_points",
    "employees",
    "employee_qualifications",
    "shifts",
    "logbook_entries",
    "instructions",
    "instruction_acknowledgements",
    "alarm_plans",
    "keys",
    "tasks",
    "audit_logs",
    "sync_devices",
    "sync_conflicts"
]

def upgrade() -> None:
    # 1. Tenants & Core System
    op.create_table(
        'tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('subdomain', sa.String(100), nullable=False, unique=True),
        sa.Column('tax_number', sa.String(50), nullable=False),
        sa.Column('license_tier', sa.String(50), nullable=False, server_default='ENTERPRISE'),
        sa.Column('bwr_register_id', sa.String(50), nullable=False),
        sa.Column('din77200_certified', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )

    op.create_table(
        'system_users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('first_name', sa.String(100), nullable=False),
        sa.Column('last_name', sa.String(100), nullable=False),
        sa.Column('phone', sa.String(50), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('is_superadmin', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now())
    )

    # 2. Customers & Objects with Composite Tenant Integrity
    op.create_table(
        'customers',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('customer_number', sa.String(50), nullable=False),
        sa.Column('company_name', sa.String(200), nullable=False),
        sa.Column('contact_person', sa.String(100), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('phone', sa.String(50), nullable=False),
        sa.Column('billing_address', sa.Text(), nullable=False),
        sa.Column('sla_level', sa.String(50), nullable=False, server_default='Gold (24/7)'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint('tenant_id', 'customer_number', name='uq_tenant_customer_number'),
        sa.UniqueConstraint('id', 'tenant_id', name='uq_customer_id_tenant')
    )

    op.create_table(
        'objects',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('customer_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('site_code', sa.String(50), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('street_address', sa.String(255), nullable=False),
        sa.Column('postal_code', sa.String(20), nullable=False),
        sa.Column('city', sa.String(100), nullable=False),
        sa.Column('security_level', sa.String(50), nullable=False, server_default='KRITIS'),
        sa.Column('required_guards_day', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('required_guards_night', sa.Integer(), nullable=False, server_default='2'),
        sa.Column('alarm_system', sa.String(150), nullable=True),
        sa.Column('access_rules', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(['customer_id', 'tenant_id'], ['customers.id', 'customers.tenant_id'], ondelete='RESTRICT', name='fk_objects_customer_tenant'),
        sa.UniqueConstraint('tenant_id', 'site_code', name='uq_tenant_site_code'),
        sa.UniqueConstraint('id', 'tenant_id', name='uq_object_id_tenant')
    )

    # 3. Enable PostgreSQL Row-Level-Security (RLS) on all Tenant Scoped Tables
    for table_name in RLS_TABLES:
        op.execute(f"ALTER TABLE IF EXISTS {table_name} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_policies WHERE tablename = '{table_name}' AND policyname = 'tenant_isolation_policy'
                ) THEN
                    CREATE POLICY tenant_isolation_policy ON {table_name}
                        AS RESTRICTIVE
                        FOR ALL
                        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
                        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
                END IF;
            END $$;
        """)

def downgrade() -> None:
    for table_name in RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_policy ON {table_name};")
    op.drop_table('objects')
    op.drop_table('customers')
    op.drop_table('system_users')
    op.drop_table('tenants')
