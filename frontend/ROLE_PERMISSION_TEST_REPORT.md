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

## 2. SOP-Berechtigungen und Funktionstrennung

Die produktiven SOP-Routen sind in `backend/src/app.ts` registriert und erzwingen serverseitig die jeweiligen `sop:*`-Berechtigungen über `requirePermission`. `backend/src/seeds/seed.ts` weist alle SOP-Rechte Systemadministrator, Geschäftsführung, Einsatzleitung und Qualitätsmanagement zu; Personalverwaltung erhält Lesen, Erstellen, Aktualisieren, Einreichen, Zuweisen und Verwalten; Objektleitung und Wachdienstmitarbeiter erhalten Lesen und Bestätigen; Auditoren erhalten Lesen.

Zusätzliche Controller-Prüfungen setzen Funktionstrennung pro konkreter Version durch: weder Ersteller noch Einreicher dürfen prüfen oder freigeben, und ein Prüfer darf die geprüfte Version nicht freigeben. API-Integrationstests und Controller-Regressionstests decken die Ablehnung unzulässiger Aktionen ab.
