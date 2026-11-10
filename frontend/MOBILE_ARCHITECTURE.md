# SecurityOps 2.0 - Phase 11: Mobile Anwendung & Mitarbeiter-App

## 1. Mobile Architektur & PWA-Plattform
SecurityOps 2.0 setzt auf eine vereinheitlichte, reaktionsschnelle Mobile-First Codebasis:
- **Responsive PWA Shell (`components/MobileAppShell.tsx`)**: Touch-optimiertes Layout (WCAG 2.2 AA konform) mit Daumen-orientierter Navigation.
- **Geteilte Geschäftslogik**: Die mobile App greift transparent auf dieselben Zustand-Stores, REST-APIs (`/api/v1/mobile/*`), PostgreSQL RLS-Mandantenfilter und IndexedDB Outbox/Inbox Caches zu wie die Desktop-Leitstelle.
- **Rollenbasiertes UI-Scoping**: Wachdienstmitarbeiter sehen fokussierte Ansichten ("Mein Dienst", "Wachbuch", "Kontrollgang-Scan", "Schichtwechsel").

---

## 2. Kernfunktionen der Mitarbeiter-App
1. **Mein Dienst (`components/MobileMyDuty.tsx`)**:
   - Zeigt heutige und kommende Schichten, Dienstort und Notfallkontakt zum Objektleiter.
   - Diensttausch-Anfragen (`ShiftSwapRequest`) direkt vom Smartphone einreichen.
2. **Kontrollgang & QR-/NFC-Scanner (`components/MobilePatrolScanner.tsx`)**:
   - WebCam Scanner mit Anti-Duplikat-Schutz (Verhindert doppeltes Scannen desselben Punkts innerhalb von 2 Minuten).
   - Unterstützung für NFC-Wandtransponder und manuelle Quittierung.
3. **Digitale Schichtübergabe (`components/MobileShiftHandover.tsx`)**:
   - Übergabe offener Vorkommnisse und Bestätigung des Schlüsseldepot-Bestands bei Schichtwechsel.
4. **Offline-Resilienz**:
   - Alle mobilen Aktionen (Wachbucheinträge, Scans, Übergaben) können offline in der IndexedDB Outbox erfasst werden und synchronisieren sich bei Netzempfang automatisch.
