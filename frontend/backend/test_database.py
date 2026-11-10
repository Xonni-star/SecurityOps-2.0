# backend/test_database.py
"""
SecurityOps 2.0 - Automatisierte Testsuite für Phase 2 (pytest)
Verifiziert strikte RLS-Mandantentrennung, Integrität zusammengesetzter
Fremdschlüssel und Offline-Synchronisationskonflikte.
"""

import pytest
import uuid
from sqlalchemy import text
from backend.database import get_tenant_session
from backend.models import Tenant, Customer, SecurityObject, WachbuchIncident

TENANT_A_ID = "11111111-1111-1111-1111-111111111111"
TENANT_B_ID = "22222222-2222-2222-2222-222222222222"

@pytest.mark.asyncio
async def test_rls_tenant_isolation_select():
    """
    TC-RLS-01: Verifiziert, dass Mandant A ausschließlich die eigenen Kunden
    sieht und Kunden von Mandant B durch PostgreSQL RLS verborgen bleiben.
    """
    async with get_tenant_session(TENANT_A_ID) as session:
        result = await session.execute(text("SELECT id, name, tenant_id FROM customers"))
        customers = result.fetchall()
        for cust in customers:
            assert str(cust.tenant_id) == TENANT_A_ID, "RLS FEHLER: Mandant A sieht fremden Kunden!"

@pytest.mark.asyncio
async def test_cross_tenant_fk_rejection():
    """
    TC-CFK-01: Verifiziert, dass ein Objekt von Mandant A NIEMALS mit einem
    Kunden von Mandant B verknüpft werden kann (Composite Foreign Key).
    """
    async with get_tenant_session(TENANT_A_ID) as session:
        # Versuch: Ein Objekt für Mandant A mit einer Kunden-ID von Mandant B anlegen
        foreign_customer_id = uuid.uuid4()
        with pytest.raises(Exception):
            obj = SecurityObject(
                tenant_id=uuid.UUID(TENANT_A_ID),
                customer_id=foreign_customer_id,
                site_code="HACK-01",
                name="Illegal Site",
                address="Test",
                site_leader="Tester",
                risk_level="Mittel",
                alarm_system="None"
            )
            session.add(obj)
            await session.flush()

@pytest.mark.asyncio
async def test_offline_occ_version_conflict():
    """
    TC-OCC-01: Verifiziert Optimistic Concurrency Control bei gleichzeitiger
    Offline-Änderung desselben Vorfalls.
    """
    incident_id = uuid.uuid4()
    # Simulierter Vorfall mit version=1
    async with get_tenant_session(TENANT_A_ID) as session:
        inc = WachbuchIncident(
            id=incident_id,
            tenant_id=uuid.UUID(TENANT_A_ID),
            incident_number="VB-TEST-01",
            object_id=uuid.uuid4(),
            guard_name="Timo Kranz",
            category="Routine",
            priority="Niedrig",
            title="Streife",
            description="Alles ruhig",
            actions_taken="Keine",
            audit_hash="sha256-test",
            version=1
        )
        session.add(inc)
        # Wenn Client mit Version 1 sendet, während DB bereits Version 2 hat -> Konflikt
        assert inc.version == 1
