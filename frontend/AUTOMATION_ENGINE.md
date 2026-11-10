# SecurityOps 2.0 - Phase 8: Automatisierungsengine & Intelligente Arbeitsabläufe

## 1. Systemarchitektur der Automatisierungsengine
Die Automatisierungsengine in SecurityOps 2.0 arbeitet nach einem **deklarativen Event-Condition-Action (ECA)** Muster:
- **Ereignisauslöser (Triggers)**: `QUALIFICATION_EXPIRING`, `CONTRACT_EXPIRING`, `KEY_OVERDUE`, `INCIDENT_CREATED`, `SHIFT_CONFLICT_DETECTED`, `SOP_UNACKNOWLEDGED`.
- **Bedingungen (Conditions)**: Typsichere Operatoren (`LESS_THAN_DAYS`, `EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `IN_ARRAY`). Aus Sicherheitsgründen werden **keine beliebigen SQL-Fragmente oder roher Code** ausgeführt.
- **Aktionen (Actions)**: `CREATE_TASK`, `SEND_NOTIFICATION`, `ESCALATE_INCIDENT`, `SET_KEY_OVERDUE`.
- **Idempotenz & Schleifenschutz**: Jede Ausführung wird mit einer eindeutigen Prüfsumme/Auslöser-ID protokolliert. Rekursive Kaskaden sind auf maximal 2 Folgeebenen limitiert.

---

## 2. Multi-Channel Benachrichtigungssystem
1. **In-App Notifikationen**: Sofortige Anzeige in der Leitstellen-App mit Dringlichkeitsstufe (INFO, WARNUNG, ALARM, KRITISCH).
2. **E-Mail Dispatch**: Versand an autorisierte Dienst-E-Mails bei kritischen Ereignissen oder Eskalationen.
3. **Zustellverfolgung**: Jeder Vorgang besitzt Status `CREATED` -> `SENT` -> `DELIVERED` -> `FAILED`.
4. **Benutzerpräferenzen**: Anwender können nicht-kritische Benachrichtigungskanäle anpassen; Alarmmeldungen nach BMA/EMA bleiben unveränderlich aktiv.
