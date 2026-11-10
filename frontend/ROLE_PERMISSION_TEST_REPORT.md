# SecurityOps 2.0 - Phase 13: Rollen- & Berechtigungs-Prüfbericht

## 1. Getestete Rollen
1. **Systemadministrator**: Volle Plattformberechtigungen, System-Audit und Deployment-Monitoring.
2. **Geschäftsführung**: Unternehmenscontrolling, Freigabe von Verträgen und Dienstplänen.
3. **Einsatzleitung**: Operative Leitung, Dienstplandisposition, Vorfallbearbeitung und Schlüsselaufsicht.
4. **Objektleitung**: Standortbezogenes Controlling, Kontrollgangprüfungen und Anweisungsstatus.
5. **Personalverwaltung (HR)**: Mitarbeiterakten, § 34a Qualifikationsüberwachung und Urlaubsfreigaben.
6. **Qualitätsmanagement (QM)**: Erstellung und Audit von Dienstanweisungen nach DIN 77200.
7. **Wachdienstmitarbeiter**: Mobiler Zugriff ("Mein Dienst", QR/NFC Scanner, Wachbuch, Schichtübergabe).
8. **Lesender Zugriff (Auditor)**: Revisionssichere Einsicht in Berichte und Prüfprotokolle ohne Änderungsrechte.

**Ergebnis**: Alle 8 Rollen werden serverseitig in `backend/api.py` via `require_permission` forciert. Direkte API-Aufrufe ohne erforderliche Berechtigung werden mit HTTP 403 abgewiesen.
