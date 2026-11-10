# SECURITYOPS 2.0 – ROLLEN- & BERECHTIGUNGSSYSTEM (RBAC) (PHASE 3)

## 1. Granulare Berechtigungsschlüssel

| Modul | Berechtigung | Beschreibung |
| :--- | :--- | :--- |
| **Wachbuch** | `wachbuch:read` | Wachbucheinträge einsehen |
| | `wachbuch:create` | Vorfälle und Kontrollgänge erfassen |
| | `wachbuch:escalate` | Vorfälle eskalieren und Polizei alarmieren |
| | `wachbuch:resolve` | Vorfälle offiziell abschließen |
| **Dienstplan** | `schedule:read` | Schichtpläne einsehen |
| | `schedule:dispatch` | Mitarbeiter Schichten zuweisen |
| | `schedule:manage` | Schichtmodelle erstellen & ändern |
| **Personal** | `employees:read` | Personalstammdaten einsehen |
| | `employees:write` | Mitarbeiter anlegen & Verträge verwalten |
| | `employees:34a_audit` | § 34a GewO Qualifikationen prüfen |
| **Mandant** | `tenant:admin` | Mandanteneinstellungen ändern |
| | `system:admin` | Vollzugriff über alle Mandanten (nur Systembetreiber) |

---

## 2. Server-Side Enforcement (Dependency Injection)

```python
# Verwendung in FastAPI Endpunkten:
@router.post("/wachbuch/incidents", response_model=IncidentResponse)
async def create_incident(
    payload: IncidentCreate,
    current_user: SystemUser = Depends(require_permission("wachbuch:create")),
    tenant_context: str = Depends(get_tenant_context)
):
    return await incident_service.create_incident(payload, current_user, tenant_context)
```
