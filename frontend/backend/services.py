# SecurityOps 2.0 - Central Business Service Layer & Automation Engine
import uuid
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, date

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, and_, func, or_
from sqlalchemy.exc import IntegrityError

from backend.models import (
    Tenant, Customer, SecurityObject, Employee, Shift, LogbookEntry,
    LogbookRevisionEntry, Task, AuditLog, SyncConflict, SyncDevice,
    SyncSession, DeviceStatus, AutomationRuleModel, AutomationExecutionModel,
    NotificationDeliveryModel
)

class AutomationEngineService:
    @staticmethod
    def evaluate_condition(entity_data: Dict[str, Any], condition: Dict[str, Any]) -> bool:
        """
        Safely evaluates condition against entity dictionary.
        Prevents arbitrary code or SQL execution.
        """
        field = condition.get("field")
        op = condition.get("operator")
        expected = condition.get("value")

        actual = entity_data.get(field)
        if actual is None:
            return False

        if op == "EQUALS":
            return actual == expected
        elif op == "NOT_EQUALS":
            return actual != expected
        elif op == "LESS_THAN_DAYS":
            try:
                return float(actual) <= float(expected)
            except (ValueError, TypeError):
                return False
        elif op == "GREATER_THAN":
            try:
                return float(actual) > float(expected)
            except (ValueError, TypeError):
                return False
        elif op == "IN_ARRAY":
            return actual in expected if isinstance(expected, list) else False

        return False

    @staticmethod
    async def execute_rule_actions(
        session: AsyncSession,
        tenant_id: uuid.UUID,
        rule: AutomationRuleModel,
        entity_id: str,
        entity_context: Dict[str, Any],
        user_id: uuid.UUID
    ) -> List[str]:
        executed_actions: List[str] = []

        for action_cfg in rule.actions_json:
            act_type = action_cfg.get("type")

            if act_type == "CREATE_TASK":
                title_template = action_cfg.get("taskTitleTemplate", "Aufgabe: {title}")
                # Safe template format
                formatted_title = title_template
                for k, v in entity_context.items():
                    formatted_title = formatted_title.replace(f"{{{k}}}", str(v))

                new_task = Task(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    title=formatted_title[:255],
                    assigned_to_name=action_cfg.get("targetRole", "Einsatzleiter"),
                    due_date=date.today(),
                    priority=action_cfg.get("taskPriority", "Hoch"),
                    status="Offen",
                    category="Audit",
                    created_by_id=user_id
                )
                session.add(new_task)
                executed_actions.append(f"CREATE_TASK:{new_task.id}")

            elif act_type == "SEND_NOTIFICATION":
                notif = NotificationDeliveryModel(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    title=action_cfg.get("notificationTitle", rule.name),
                    message=action_cfg.get("notificationMessage", "Automatisierte Benachrichtigung"),
                    channel="IN_APP",
                    severity=action_cfg.get("notificationSeverity", "WARNUNG"),
                    status="DELIVERED",
                    source_module=rule.category
                )
                session.add(notif)
                executed_actions.append(f"SEND_NOTIFICATION:{notif.id}")

        await session.commit()
        return executed_actions
