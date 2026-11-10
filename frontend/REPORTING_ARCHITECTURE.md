# SecurityOps 2.0 - Phase 9: Berichtswesen, Controlling & Management-Dashboard

## 1. Architektur des Berichtswesens
Das Berichtswesen in SecurityOps 2.0 berechnet alle Kennzahlen reproduzierbar aus echten Datenbanktabellen (`shifts`, `logbook_entries`, `employees`, `objects`, `customers`, `keys`).

### Kernmodule des Controllings:
1. **Executive Cockpit (Geschäftsführung)**:
   - Soll-/Ist-Stundenbilanzen
   - Planerfüllungsquote (in %)
   - Kritische Vorkommnisse und anhängige Schadensersatzrisiken
   - DIN 77200 Konformitätsindex
2. **Operatives Lagebild (Einsatzleitung)**:
   - Schichtbesetzungsquote und kurzfristige Ausfälle
   - BMA/EMA Alarminzidenzen
   - Offene Übergaben und Kontrollgang-Scanquoten
3. **Personal-Controlling (HR)**:
   - § 34a GewO und Ersthelfer-Gültigkeiten
   - Arbeitszeitkonten und Urlaubsquoten
4. **Berichtsgenerator & Export**:
   - Strukturierte CSV- und druckfertige PDF-Exporte
   - Keine ungesicherten SQL-Injektionen; typsichere Abfragekataloge
