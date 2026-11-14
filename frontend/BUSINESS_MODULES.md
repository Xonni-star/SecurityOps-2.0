# SecurityOps 2.0 - Fachmodule und aktueller Status

> **Projektstatus: In Entwicklung; nicht für Produktion freigegeben.** Frühere Aussagen wie „Vollständig“ waren keine belastbare Produktreife-Aussage. Status und Grenzen beziehen sich auf den dokumentierten Code-/PR-Stand; siehe auch die [zentrale Statusübersicht](../README.md).

| Modul | Status | Verifizierter Umfang / Grenze |
|---|---|---|
| Kunden | API integriert | Tenant-scoped Liste, Anlage, Änderung, Archivierung und Offline-Mutationen |
| Objekte | API integriert | Tenant-scoped CRUD, Archivierung, Wiederherstellung und Sync |
| Mitarbeiter | API integriert | Stammdaten, Site-Zuordnungen, Qualifikationen, Abwesenheiten und Kontoverknüpfung |
| Schichten | API integriert, Planung fachlich unvollständig | CRUD/Synchronisierung vorhanden; Überschneidungs-, Ruhezeit-, Arbeitszeit- und Tarifprüfungen fehlen |
| Wachbuch, Schlüssel und Aufgaben | API integriert, Abnahme begrenzt | API-/Sync-Pfade vorhanden; nicht alle Offline-/Auditfälle sind abgenommen |
| Dokumente, SOP, Alarmmanagement | Implementiert, nicht deployed | Tenant-scoped APIs und Workflows; externe Malware-/E-Mail-/Push-Dienste fehlen |
| Übergaben und Kontrollgänge | In `main` integriert, nicht deployed | APIs und begrenzte Offline-Sync-Pfade; Offline-Binäranhänge und externe Benachrichtigungen fehlen |
| Benutzer und Rechte | Tenant-scoped Administration im aktuellen PR-Arbeitsstand | Benutzerlebenszyklus, tenant-eigene Rollen, Site-Grants, Audit und Passwort-Reset-Vorbereitung; noch nicht in `main` |
| Offline-Sync | Teilweise integriert | Workflow-spezifische Outbox-/Sync-Pfade; nicht jede Funktion oder Datei ist offline verfügbar |
| Dienstplanung | Phase-2-Backend/UI in offenen PRs [#16](https://github.com/Xonni-star/SecurityOps-2.0/pull/16) und [#19](https://github.com/Xonni-star/SecurityOps-2.0/pull/19), nicht deployed | API-gestützte Kalender- und Planungsabläufe; keine Rechtskonformitätsaussage |

Die hier genannten Integrationen dokumentieren implementierte Quellcodepfade, keine vollständige Abnahme, Zertifizierung oder Produktivbereitstellung. Für detaillierte Einschränkungen gelten die jeweiligen Modul-API-Dokumente und der [aktuelle Entwicklungsbericht](../docs/development/NEXT_DEVELOPMENT_REPORT.md).
