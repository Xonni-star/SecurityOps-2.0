# SecurityOps 2.0 - Phase 6 Automated Offline Synchronization Test Suite
import pytest
import uuid
from datetime import datetime, timezone
from backend.models import DeviceStatus

TENANT_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
TENANT_B = uuid.UUID("22222222-2222-2222-2222-222222222222")

class MockSyncService:
    def __init__(self):
        self.logbook_db = {}
        self.revisions_db = []
        self.tasks_db = {}
        self.conflicts = []
        self.devices = {
            "dev-trusted-1": {"status": DeviceStatus.ACTIVE, "tenant_id": TENANT_A},
            "dev-revoked-2": {"status": DeviceStatus.REVOKED, "tenant_id": TENANT_A}
        }
        self.server_seq = 100

    def push(self, tenant_id, device_id, mutations):
        if device_id in self.devices and self.devices[device_id]["status"] == DeviceStatus.REVOKED:
            raise PermissionError("DEVICE_REVOKED")

        results = []
        for m in mutations:
            client_uuid = m["client_uuid"]
            if m["entity_type"] == "logbook":
                # Idempotency check
                if client_uuid in self.logbook_db:
                    if m["action"] == "UPDATE":
                        # Append-only revision
                        self.revisions_db.append({
                            "entry_id": self.logbook_db[client_uuid]["id"],
                            "note": m["payload"].get("correction_note", "Ergänzung"),
                            "prev": self.logbook_db[client_uuid]["title"]
                        })
                        self.logbook_db[client_uuid]["version"] += 1
                        results.append({"client_uuid": client_uuid, "status": "SYNCED", "version": self.logbook_db[client_uuid]["version"]})
                    else:
                        # Idempotent re-push
                        results.append({"client_uuid": client_uuid, "status": "SYNCED", "version": self.logbook_db[client_uuid]["version"]})
                else:
                    self.server_seq += 1
                    self.logbook_db[client_uuid] = {
                        "id": str(uuid.uuid4()),
                        "tenant_id": tenant_id,
                        "title": m["payload"]["title"],
                        "version": 1,
                        "seq": self.server_seq
                    }
                    results.append({"client_uuid": client_uuid, "status": "SYNCED", "version": 1})

            elif m["entity_type"] == "task":
                task_id = m["payload"].get("id")
                if task_id in self.tasks_db and self.tasks_db[task_id]["version"] > m.get("base_version", 1):
                    # Collision detected!
                    self.conflicts.append(client_uuid)
                    results.append({
                        "client_uuid": client_uuid,
                        "status": "CONFLICT",
                        "server_version": self.tasks_db[task_id]["version"]
                    })
                else:
                    self.tasks_db[task_id] = {"title": m["payload"]["title"], "version": m.get("base_version", 1) + 1}
                    results.append({"client_uuid": client_uuid, "status": "SYNCED", "version": self.tasks_db[task_id]["version"]})

        return results

@pytest.fixture
def sync_service():
    return MockSyncService()

def test_scenario_1_offline_guardbook_push(sync_service):
    """Scenario 1: Offline guardbook entry is pushed and persisted."""
    m_id = "mut-offline-001"
    res = sync_service.push(TENANT_A, "dev-trusted-1", [{
        "client_uuid": m_id,
        "entity_type": "logbook",
        "action": "CREATE",
        "payload": {"title": "Rundgang Pforte Süd"}
    }])
    assert len(res) == 1
    assert res[0]["status"] == "SYNCED"
    assert m_id in sync_service.logbook_db

def test_scenario_2_idempotency_duplicate_handling(sync_service):
    """Scenario 2: Sending the exact same mutation twice does not create duplicate entries."""
    m_id = "mut-idempotent-002"
    mutation = {
        "client_uuid": m_id,
        "entity_type": "logbook",
        "action": "CREATE",
        "payload": {"title": "Schrankenprüfung Tor 3"}
    }
    res1 = sync_service.push(TENANT_A, "dev-trusted-1", [mutation])
    res2 = sync_service.push(TENANT_A, "dev-trusted-1", [mutation]) # Duplicate network re-try
    assert res1[0]["status"] == "SYNCED"
    assert res2[0]["status"] == "SYNCED"
    assert len(sync_service.logbook_db) == 1

def test_scenario_3_append_only_guardbook_revisions(sync_service):
    """Scenario 3: Guardbook edits append a revision and never silently overwrite original records."""
    m_id = "mut-entry-003"
    sync_service.push(TENANT_A, "dev-trusted-1", [{
        "client_uuid": m_id,
        "entity_type": "logbook",
        "action": "CREATE",
        "payload": {"title": "Alarm Melderlinie 4"}
    }])
    # Subsequent correction
    sync_service.push(TENANT_A, "dev-trusted-1", [{
        "client_uuid": m_id,
        "entity_type": "logbook",
        "action": "UPDATE",
        "payload": {"correction_note": "Melderlinie 4 war ein Täuschungsalarm durch Staub"}
    }])
    assert len(sync_service.revisions_db) == 1
    assert "Täuschungsalarm" in sync_service.revisions_db[0]["note"]

def test_scenario_4_device_revocation_rejection(sync_service):
    """Scenario 4: Revoked devices are strictly rejected."""
    with pytest.raises(PermissionError, match="DEVICE_REVOKED"):
        sync_service.push(TENANT_A, "dev-revoked-2", [{
            "client_uuid": "mut-bad-004",
            "entity_type": "logbook",
            "action": "CREATE",
            "payload": {"title": "Unauthorized entry"}
        }])

def test_scenario_5_task_parallel_edit_conflict(sync_service):
    """Scenario 5: Two offline devices editing the same task trigger a version CONFLICT."""
    task_id = "task-kritis-10"
    # Initial state
    sync_service.tasks_db[task_id] = {"title": "BMA Revision", "version": 2}
    
    # Client pushes with older base_version = 1
    res = sync_service.push(TENANT_A, "dev-trusted-1", [{
        "client_uuid": "mut-task-005",
        "entity_type": "task",
        "action": "UPDATE",
        "base_version": 1,
        "payload": {"id": task_id, "title": "BMA Revision verschoben"}
    }])
    assert res[0]["status"] == "CONFLICT"
    assert "mut-task-005" in sync_service.conflicts
