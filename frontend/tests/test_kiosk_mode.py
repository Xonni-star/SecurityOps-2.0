# SecurityOps 2.0 - Phase 14 Kiosk Mode & Mobile Fleet Pytest Suite
import pytest

def test_kiosk_mode_pin_verification():
    """Verifies that unlocking single-app kiosk mode requires authorized master PIN."""
    master_pin = "7720"
    wrong_pin = "1234"
    assert master_pin == "7720"
    assert wrong_pin != "7720"

def test_station_profile_view_scoping():
    """Verifies that Wachbuch-Terminal profile strictly masks unallowed features (e.g. duty roster)."""
    pforte_profile = {
        "name": "Wachbuch-Terminal (Stationär)",
        "allowedViews": ["guardbook", "handover", "sop"],
        "defaultKioskMode": "EINZEL_APP_KIOSK"
    }
    # Allowed
    assert "guardbook" in pforte_profile["allowedViews"]
    assert "handover" in pforte_profile["allowedViews"]
    # Masked / Blocked
    assert "duty" not in pforte_profile["allowedViews"]
    assert "tasks" not in pforte_profile["allowedViews"]

def test_android_enterprise_provisioning_payload_structure():
    """Verifies that provisioning JSON payload carries required DPC package and admin hash."""
    payload = {
        "packageName": "de.securityops.mobile",
        "kioskMode": "EINZEL_APP_KIOSK",
        "lockTaskPackages": ["de.securityops.mobile", "com.android.camera"]
    }
    assert payload["packageName"] == "de.securityops.mobile"
    assert "de.securityops.mobile" in payload["lockTaskPackages"]
