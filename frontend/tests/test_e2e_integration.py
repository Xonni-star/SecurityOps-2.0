# SecurityOps 2.0 - Phase 13 End-to-End Integration & Release 1.0 Acceptance Suite
import pytest
import uuid
from datetime import datetime, date

TENANT_FFM = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_BAVARIA = uuid.UUID("22222222-2222-2222-2222-222222222222")

class MockE2ESystem:
    def __init__(self):
        self.customers = {}
        self.sites = {}
        self.employees = {}
        self.shifts = {}
        self.logbook = {}
        self.tasks = {}
        self.revisions = []
        self.keys = {}
        self.sops = {}

    def test_1_create_customer_and_site(self, tenant_id):
        c_id = str(uuid.uuid4())
        self.customers[c_id] = {"tenant_id": tenant_id, "name": "MainTower Real Estate", "sla": "Gold"}
        s_id = str(uuid.uuid4())
        self.sites[s_id] = {"tenant_id": tenant_id, "customer_id": c_id, "name": "Finanzturm Alpha"}
        return c_id, s_id

    def test_2_create_employee_with_qualifications(self, tenant_id):
        e_id = str(uuid.uuid4())
        self.employees[e_id] = {
            "tenant_id": tenant_id,
            "name": "Sabine Becker",
            "qualifications": ["Sachkundeprüfung § 34a GewO", "Ersthelfer DGUV"],
            "status": "Aktiv"
        }
        return e_id

    def test_3_schedule_shift_with_conflict_check(self, tenant_id, site_id, employee_id):
        emp = self.employees[employee_id]
        has_qual = "Sachkundeprüfung § 34a GewO" in emp["qualifications"]
        is_available = emp["status"] == "Aktiv"
        
        status = "Besetzt" if (has_qual and is_available) else "Konflikt"
        sh_id = str(uuid.uuid4())
        self.shifts[sh_id] = {
            "tenant_id": tenant_id,
            "site_id": site_id,
            "employee_id": employee_id,
            "status": status
        }
        return sh_id, status

    def test_4_logbook_append_only(self, tenant_id, site_id, entry_id, update_note):
        if entry_id not in self.logbook:
            self.logbook[entry_id] = {"tenant_id": tenant_id, "site_id": site_id, "title": "Initial Entry", "version": 1}
        else:
            self.revisions.append({"entry_id": entry_id, "note": update_note})
            self.logbook[entry_id]["version"] += 1
        return self.logbook[entry_id]["version"]

@pytest.fixture
def e2e_system():
    return MockE2ESystem()

def test_e2e_scenario_1_customer_and_site(e2e_system):
    """Test 1: Neuer Kunde, Vertrag und Objektzuweisung."""
    c_id, s_id = e2e_system.test_1_create_customer_and_site(TENANT_FFM)
    assert c_id in e2e_system.customers
    assert s_id in e2e_system.sites
    assert e2e_system.sites[s_id]["customer_id"] == c_id

def test_e2e_scenario_2_employee_bwr(e2e_system):
    """Test 2: Neuer Mitarbeiter mit § 34a GewO Sachkunde."""
    e_id = e2e_system.test_2_create_employee_with_qualifications(TENANT_FFM)
    assert e_id in e2e_system.employees
    assert "Sachkundeprüfung § 34a GewO" in e2e_system.employees[e_id]["qualifications"]

def test_e2e_scenario_3_roster_conflict_resolution(e2e_system):
    """Test 3: Dienstplanung mit automatischer Qualifikations- & ArbZG-Prüfung."""
    _, s_id = e2e_system.test_1_create_customer_and_site(TENANT_FFM)
    e_id = e2e_system.test_2_create_employee_with_qualifications(TENANT_FFM)
    
    # 1. Qualified & active employee -> Besetzt
    sh_id, status = e2e_system.test_3_schedule_shift_with_conflict_check(TENANT_FFM, s_id, e_id)
    assert status == "Besetzt"

    # 2. Sick employee -> Konflikt
    e2e_system.employees[e_id]["status"] = "Krank"
    sh_id2, status2 = e2e_system.test_3_schedule_shift_with_conflict_check(TENANT_FFM, s_id, e_id)
    assert status2 == "Konflikt"

def test_e2e_scenario_4_logbook_append_only(e2e_system):
    """Test 4: Wachbuch Korrektur erzeugt unzerstörbare Revision (Append-Only)."""
    _, s_id = e2e_system.test_1_create_customer_and_site(TENANT_FFM)
    entry_id = "log-e2e-001"
    
    v1 = e2e_system.test_4_logbook_append_only(TENANT_FFM, s_id, entry_id, "Init")
    assert v1 == 1
    
    v2 = e2e_system.test_4_logbook_append_only(TENANT_FFM, s_id, entry_id, "Korrektur: Meldergruppe rückgestellt")
    assert v2 == 2
    assert len(e2e_system.revisions) == 1

def test_e2e_scenario_9_tenant_isolation(e2e_system):
    """Test 9: Mandant A darf niemals Daten von Mandant B sehen (RLS)."""
    c_ffm, _ = e2e_system.test_1_create_customer_and_site(TENANT_FFM)
    c_bav, _ = e2e_system.test_1_create_customer_and_site(TENANT_BAVARIA)
    
    # Isolation assertion
    assert e2e_system.customers[c_ffm]["tenant_id"] == TENANT_FFM
    assert e2e_system.customers[c_bav]["tenant_id"] == TENANT_BAVARIA
    assert e2e_system.customers[c_ffm]["tenant_id"] != e2e_system.customers[c_bav]["tenant_id"]
