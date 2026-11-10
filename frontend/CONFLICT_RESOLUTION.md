# SecurityOps 2.0 - Phase 6: Konfliktmanagement & Differenzierte Regeln

## 1. Differenzierte Auflösungsregeln
| Entität | Konfliktstrategie | Begründung |
|---|---|---|
| **Wachbuch & Vorfälle** | **Append-Only (Kein Overwrite)** | DIN 77200 verbietet das unbemerkte Überschreiben von Wachbucheinträgen. Korrekturen werden als neue Revisionen angehängt. |
| **Aufgaben & Termine** | **Three-Way Merge / Side-by-Side** | Parallele Bearbeitungen zweier Wachleiter werden im Dialog verglichen (Lokale Version vs. Server Version). |
| **Schlüssel** | **Server-Autoritativ (Depot-Status)** | Der physische Schlüsselverbleib im Tresor hat Vorrang vor Offline-Status. |
