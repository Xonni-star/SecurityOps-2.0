# SecurityOps 2.0 - Phase 5 Business Modules & System Integration Specification

## 1. Modulübersicht und Status
| Modul | Status | Beschreibung | Verknüpfte Module |
|---|---|---|---|
| **Kunden & Verträge** | Vollständig | Stammdaten, Adressen, SLA-Level, automatische Kündigungsfristen-Überwachung | Objekte, Dokumente, Aufgaben |
| **Objektverwaltung** | Vollständig | Zentraler Detail-Tab-Workspace (Overview, Kontrollpunkte, Wachbuch, Roster, Schlüssel, Alarmpläne) | Kunden, Mitarbeiter, Dienstplan, Wachbuch |
| **Personal & § 34a GewO** | Vollständig | Bewacherregister-Profile, Qualifikationsüberwachung, Urlaubs- und Krankenverwaltung | Dienstplan, Aufgaben, DMS |
| **Dienstplanung** | Vollständig | Soll/Ist-Vergleich, Qualifikationsprüfung, ArbZG-Konflikterkennung | Mitarbeiter, Objekte, Wachbuch |
| **Digitales Wachbuch** | Vollständig | Revisionssichere Protokollierung, Rundgänge, Schichtwechsel, lückenlose Historie | Vorfälle, Aufgaben, Objekte |
| **Vorfallmanagement** | Vollständig | Workflow: Erfassung -> Bewertung -> Zuweisung -> Maßnahme -> Eskalation -> Abschluss | Aufgaben, DMS, Benachrichtigungen |
| **Qualitätsmanagement & SOP** | Implementiert, nicht deployed | Versionierte Dienstanweisungen mit Prüfung/Freigabe, Zuweisungen und digitaler Kenntnisnahme; Erinnerungen und JSON-Berichte. Offline-Vormerkungen werden erst nach Serverbestätigung abgeschlossen; kein Hintergrundscheduler/CSV-/PDF-Export. | Mitarbeiter, Objekte, DMS |
| **Alarmmanagement** | Vollständig | BMA/EMA Eskalationsketten, Notfall-Ansprechpartner, Evakuierungspläne | Objekte, Notfall-SOPs |
| **Schlüsselverwaltung** | Vollständig | Generalschlüssel-Depot, Ausgabe-/Rücknahmeprotokolle, automatische Verzugserkennung | Mitarbeiter, Objekte, Aufgaben |
| **Aufgaben & Maßnahmen** | Vollständig | Modulübergreifende Aufgaben-Pipeline (generiert aus Vorfällen, Schlüsselverzug, Audit-Mängeln) | Vorfälle, Schlüssel, QM |
| **Dokumentenmanagement (DMS)** | Vollständig | Polymorphe Zuordnung zu Kunden, Objekten, Personalakten und Vorfällen | Alle Fachmodule |
| **Automatisierung & Watchdog** | Vollständig | Hintergrundprüfer für Nachweise, Verträge, Schlüsselrückgaben und Eskalationen | Benachrichtigungen, Aufgaben |
| **Globale Suche (Ctrl+K)** | Vollständig | Mandantensichere Volltextsuche über alle 7 Hauptentitäten | Alle Fachmodule |

---

## 2. Schlüssel-Integrationen (Cross-Module Workflows)
1. **Wachbuch & Aufgaben**: Bei Vorkommnissen mit Priorität *Kritisch* oder *Dringend* generiert das System automatisch eine Bearbeitungsaufgabe mit Frist für den Objektleiter.
2. **Schlüssel & Aufgaben**: Wenn ein ausgegebener Schlüssel den vereinbarten Rückgabezeitpunkt überschreitet, setzt die Watchdog-Engine den Status auf *Überfällig* und erzeugt eine Eskalationsaufgabe.
3. **Mitarbeiter & Dienstplan**: Bei der Schichtdisposition werden sowohl die Arbeitsunfähigkeit/Urlaub als auch die geforderte Qualifikation (§ 34a Sachkunde, Brandschutzhelfer) geprüft und bei Nichteignung als Konflikt markiert.
4. **Polymorphe Dokumentenablage**: Dokumente werden in einer zentralen DMS-Tabelle gespeichert und können flexibel mit Kunden, Objekten, Mitarbeitern oder Vorfällen verknüpft werden, ohne Dateiduplikate zu erzeugen.
