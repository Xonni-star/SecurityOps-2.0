# SecurityOps 2.0 - Phase 13: Modulübergreifender Integrationsbericht

## 1. Verifizierte Modulverbindungen

1. **Kunden ➔ Verträge ➔ Schutzobjekte**:
   - Objekte verweisen über einen zusammengesetzten Fremdschlüssel `(customer_id, tenant_id)` auf den Kunden.
   - Manipulationen der Mandanten-ID werden durch PostgreSQL physisch mit einem `IntegrityError` abgewehrt.
2. **Objekte ➔ Wachbuch ➔ Vorfälle**:
   - Wachbucheinträge referenzieren das Schutzobjekt.
   - Bei Priorität *Kritisch* erzeugt der Controller automatisch eine Fristaufgabe für den Objektleiter.
3. **Mitarbeiter ➔ Dienstplanung ➔ ArbZG-Wächter**:
   - Vor Schichtzuteilung werden Qualifikationen (§ 34a Sachkunde, Brandschutzhelfer) und Abwesenheitsstatus (Krank/Urlaub) validiert.
   - Unzulässige Besetzungen werden mit Status `Konflikt` markiert und blockiert.
4. **Schlüssel ➔ Aufgaben-Pipeline**:
   - Nach Ablauf des Rückgabezeitpunkts markiert die Automatisierungsengine den Schlüssel als `Überfällig` und legt eine Eskalationsaufgabe an.
5. **DMS ➔ Polymorphe Bindung**:
   - Dokumente verweisen typisiert auf Kunden, Objekte, Mitarbeiter oder Vorfälle ohne Redundanz.
