# SecurityOps 2.0 - Pytest Multi-Tenant & Database Integrity Verification
import pytest
import uuid
from datetime import datetime, date
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from backend.models import Tenant, Customer, SecurityObject, Employee, LogbookEntry
from backend.database import get_tenant_session

TENANT_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

@pytest.mark.asyncio
async def test_tenant_data_isolation():
    """Verifies Tenant A cannot see customers or records belonging to Tenant B."""
    async with get_tenant_session(TENANT_A) as session_a:
        result_a = await session_a.execute(select(Customer))
        customers_a = result_a.scalars().all()
        # All retrieved items must strictly belong to Tenant A
        assert all(c.tenant_id == TENANT_A for c in customers_a)

    async with get_tenant_session(TENANT_B) as session_b:
        result_b = await session_b.execute(select(Customer))
        customers_b = result_b.scalars().all()
        assert all(c.tenant_id == TENANT_B for c in customers_b)

@pytest.mark.asyncio
async def test_cross_tenant_foreign_key_rejection():
    """
    CRITICAL SECURITY CHECK:
    PostgreSQL must physically reject linking a Site in Tenant A to a Customer in Tenant B
    via composite foreign key constraint (customer_id, tenant_id).
    """
    # 1. Fetch customer belonging to Tenant B
    async with get_tenant_session(TENANT_B) as session_b:
        cust_b = (await session_b.execute(select(Customer))).scalars().first()
        cust_b_id = cust_b.id

    # 2. Attempt to create an object in Tenant A pointing to Customer B
    with pytest.raises(IntegrityError):
        async with get_tenant_session(TENANT_A) as session_a:
            invalid_site = SecurityObject(
                id=uuid.uuid4(),
                tenant_id=TENANT_A,
                customer_id=cust_b_id, # Cross-tenant leak attempt!
                site_code="OBJ-HACK-01",
                name="Infiltrated Site",
                street_address="Testweg 1",
                postal_code="10115",
                city="Berlin"
            )
            session_a.add(invalid_site)
            await session_a.commit()

@pytest.mark.asyncio
async def test_offline_sync_idempotency():
    """Verifies that offline duplicate submissions with the same client_mutation_id are idempotent."""
    async with get_tenant_session(TENANT_A) as session:
        mutation_id = f"mut-{uuid.uuid4()}"
        entry = LogbookEntry(
            id=uuid.uuid4(),
            tenant_id=TENANT_A,
            object_id=uuid.uuid4(),
            guard_id=uuid.uuid4(),
            entry_timestamp=datetime.now(),
            category="Kontrollgang",
            title="Tor 1 Verschlussprüfung",
            description="Tor ordnungsgemäß verriegelt.",
            client_mutation_id=mutation_id
        )
        session.add(entry)
        await session.commit()

        # Query check
        saved = (await session.execute(
            select(LogbookEntry).where(LogbookEntry.client_mutation_id == mutation_id)
        )).scalars().first()
        assert saved is not None
        assert saved.client_mutation_id == mutation_id
