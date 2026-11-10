# SecurityOps 2.0 - Phase 8 Automated Testing Suite: Automation Engine & Notifications
import pytest
from backend.services import AutomationEngineService

def test_declarative_condition_evaluator_less_than():
    """Verifies that LESS_THAN_DAYS condition operator evaluates correctly."""
    entity = {"daysUntilExpiry": 22, "verified": True}
    cond = {"field": "daysUntilExpiry", "operator": "LESS_THAN_DAYS", "value": 30}
    assert AutomationEngineService.evaluate_condition(entity, cond) is True

    entity_safe = {"daysUntilExpiry": 45, "verified": True}
    assert AutomationEngineService.evaluate_condition(entity_safe, cond) is False

def test_declarative_condition_evaluator_in_array():
    """Verifies that IN_ARRAY condition operator works for priority filtering."""
    incident = {"priority": "Kritisch", "category": "Fehlalarm"}
    cond = {"field": "priority", "operator": "IN_ARRAY", "value": ["Kritisch", "Dringend"]}
    assert AutomationEngineService.evaluate_condition(incident, cond) is True

    normal_incident = {"priority": "Normal", "category": "Kontrollgang"}
    assert AutomationEngineService.evaluate_condition(normal_incident, cond) is False

def test_condition_evaluator_missing_field_safety():
    """Verifies that conditions against missing entity fields gracefully return False without exceptions."""
    entity = {"other_field": 123}
    cond = {"field": "non_existent_key", "operator": "EQUALS", "value": "test"}
    assert AutomationEngineService.evaluate_condition(entity, cond) is False
