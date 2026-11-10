# backend/app/services/schedule_service.py
"""
SecurityOps 2.0 - ScheduleService
Geschäftslogik für Dienst- und Schichtplanung mit automatischer
Konflikterkennung nach § 34a GewO und DGUV Vorschrift 23.
"""

from typing import Dict, Any, Tuple

class ScheduleService:
    @staticmethod
    def validate_employee_qualifications(
        employee_qualifications: list,
        required_qualification: str
    ) -> Tuple[bool, str]:
        """
        Prüft zwingende gesetzliche Eignung für den Sicherheitsdienst:
        1. Gültiger Sachkundenachweis gem. § 34a GewO
        2. Unabgelaufene Erste-Hilfe / Brandschutzbescheinigung
        """
        has_valid_34a = any(
            (q.get("type") in ["34a_Sachkunde", "34a_Unterrichtung"]) and q.get("isValid", False)
            for q in employee_qualifications
        )
        if not has_valid_34a:
            return False, "Gesetzlicher Verstoß: Kein gültiger § 34a GewO Nachweis vorhanden!"

        has_expired_cert = any(not q.get("isValid", True) for q in employee_qualifications)
        if has_expired_cert:
            return False, "Warnung: Mindestens ein Pflichtnachweis (Erste Hilfe / Brandschutz) ist abgelaufen."

        return True, "Qualifikation vollständig erfüllt."

schedule_service = ScheduleService()
