# SecurityOps 2.0 - Controlled Test Data Seeder
import asyncio
import uuid
from datetime import datetime, date
from backend.database import AsyncSessionLocal, set_tenant_context
from backend.models import Tenant, Customer, SecurityObject, Employee, LicenseTier

TENANT_A_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_B_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")

async def seed_database():
    async with AsyncSessionLocal() as session:
        # Create Tenants
        tenant_a = Tenant(
            id=TENANT_A_ID,
            name="Securitas & Wache Frankfurt GmbH",
            subdomain="ffm-sec.securityops.de",
            tax_number="DE301928374",
            license_tier=LicenseTier.ENTERPRISE,
            bwr_register_id="BWR-HE-99201",
            din77200_certified=True
        )
        tenant_b = Tenant(
            id=TENANT_B_ID,
            name="Bavaria Schutz & Werkschutz AG",
            subdomain="bavaria.securityops.de",
            tax_number="DE819203948",
            license_tier=LicenseTier.PROFESSIONAL,
            bwr_register_id="BWR-BY-11029",
            din77200_certified=True
        )
        session.add_all([tenant_a, tenant_b])
        await session.commit()

        # Seed Customers for Tenant A
        cust_a = Customer(
            id=uuid.uuid4(),
            tenant_id=TENANT_A_ID,
            customer_number="KUN-FFM-01",
            company_name="MainTower Real Estate GmbH",
            contact_person="Dr. Michael von Berg",
            email="m.vonberg@maintower.de",
            phone="+49 69 9820-110",
            billing_address="Neue Mainzer Str. 52, 60311 Frankfurt"
        )
        session.add(cust_a)

        # Seed Customers for Tenant B
        cust_b = Customer(
            id=uuid.uuid4(),
            tenant_id=TENANT_B_ID,
            customer_number="KUN-BAV-01",
            company_name="BioPharm Innovations AG (KRITIS)",
            contact_person="Christian Lindner-Sachs",
            email="security@biopharm.eu",
            phone="+49 89 4522-890",
            billing_address="Am Klopferspitz 19, 82152 Planegg"
        )
        session.add(cust_b)
        await session.commit()

if __name__ == "__main__":
    asyncio.run(seed_database())
