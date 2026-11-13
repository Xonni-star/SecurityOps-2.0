# Kontrollgangsmanagement – Implementierungsbericht

## Umfang und Status

Dieses Feature ergänzt Kontrollpunkte, versionierte Routen, Rundgänge, Scans, Abweichungen, Auditereignisse, QR-/NFC-/manuelle Erfassung sowie eine persistente Offline-Outbox. Die 641-zeilige Spezifikation aus dem ursprünglichen Auftrag war in diesem Worktree und der Session-Bibliothek nicht auffindbar. Die Implementierung kann daher nur gegen den übermittelten Auftragsauszug ausgewertet werden; sie wird nicht als vollständige Erfüllung der fehlenden Spezifikation behauptet.

Der Branch basiert auf dem live verifizierten `main` mit Merge-Commit `5608b9010096ebac06a000ed2a2870dadd66ab60`. Die App zeigt den Status **nicht deployed / nicht für Produktion freigegeben**. Dieser lokale Bericht ist kein Produktions-, Bereitschafts- oder Compliance-Nachweis.

## Implementierte Bereiche

- Migration 020 ergänzt tenant-/site-gebundene Kontrollpunkte, Routen und unveränderliche Routenversionen, Rundgänge, Scan-Metadaten, Abweichungen und Auditereignisse. Neue Tabellen erzwingen RLS. Historische Tabellen/Events sind für die Anwendungsrolle append-only.
- Express-Endpunkte `/api/v1/patrol/...` authentifizieren Nutzer, prüfen serverseitige RBAC-Rechte und arbeiten mit Tenant-Transaktionen. Wachpersonal wird anhand verknüpftem Mitarbeiterkonto und aktiver Objektzuordnung abgeleitet.
- QR-Token haben 256 Bit Zufall, gespeichert wird nur SHA-256. Rotation invalidiert den vorherigen Token. Scanner unterstützen Browser-QR-Detection, Web NFC bei Browser-/Geräteverfügbarkeit und manuelle Erfassung.
- Offline-Mutationen verbleiben persistent in IndexedDB bis zur Bestätigung. Sync prüft Token, Mitarbeiter-/Site-Zuordnung, Payload-Hash, Idempotenz und ein serverseitiges Zwei-Minuten-Duplikatfenster. Queue-Vorschauen geben Tokens nicht aus.
- Rundgänge können online gestartet und abgeschlossen werden; eigene offene Rundgänge werden nach erneutem Laden wiederhergestellt und zugeordnete Scans synchronisiert. Offline gestartete/abgeschlossene Rundgänge werden noch nicht unterstützt.
- UI und Dokumentation beschreiben Dashboard, Filter, Verwaltung und Einschränkungen. Der zuvor vorhandene FastAPI-Scheinendpunkt, der Scans ohne Tokenprüfung mit einer zufälligen ID als verifiziert beantwortete, wurde entfernt.
- Dienst-/Schichtplanung wurde nicht implementiert; nur die fehlende Integrationsgrenze ist dokumentiert.

## Verifikation

| Prüfung | Ergebnis |
|---|---|
| PostgreSQL 16 Migration/RLS-Integration (`src/tests/migrations.test.ts`) | 65 Tests bestanden |
| Patrol API-Integration (`src/tests/patrol.integration.test.ts`) | 1 Test bestanden: Tokenhash, doppelte Routenpunkte, parallele Rundgang-/Abweichungswiederholung, gültiger/ungültiger/rotierter Token |
| TypeScript-Backend-Build | bestanden |
| Frontend-Vitest | 54 Tests bestanden, inkl. Outbox-Wiederöffnung über eine neue Serviceinstanz |
| Frontend-Vite-Produktionsbuild | bestanden; bestehende Chunkgrößen-/Vite-Konfigurationswarnungen |
| Python-Mobile-Regressionsprüfungen | 2 Tests bestanden |
| Docker Compose-Konfiguration und Frontend-/Backend-Images | Konfiguration valide; beide Images gebaut |
| Gesamte Backend-Jest-Suite | 20 Suites, 219 Tests bestanden |
| Echte Browserkamera/NFC und End-to-End-Offlineverhalten auf realen Mobilgeräten | nicht geprüft |
| GitHub-CI | Bei der ersten Abfrage nach PR-Erstellung waren Backend/PostgreSQL, Frontend, Produktions-Docker und Root-Workflow alle `pending`; kein Ergebnis wurde als bestanden behauptet. Den aktuellen Status zeigt die PR-Prüfübersicht. |

Migrationstests liefen gegen einen kurzlebigen PostgreSQL-16-Container mit getrennten Admin- und `secops_app_user`-Verbindungen. Die initiale Testausführung benutzte fälschlich den Superuser für API-RLS-Tests und zeigte erwartungsgemäß keine Isolation; mit der realen Anwendungsrolle waren die Tests erfolgreich. Die Patrol-Integration richtet ihre eigenen temporären Konto-, Mitarbeiter-, Objekt- und Kundendaten ein und räumt sie anschließend wieder auf.

## Bekannte Einschränkungen

- Tokenprüfung kann offline nicht stattfinden; Sync kann nach Rotation/Archivierung ablehnen.
- QR-Fotos können kopiert werden; Web NFC ist kein kryptografischer Anwesenheitsbeweis. Geofencing, dynamische Codes und manipulationssichere NFC-Hardware fehlen.
- Kein Patrol-Alarm-/Push-/E-Mail-Provider, keine autonome Alarmzustellung und keine automatische Bewertung der Routenerfüllung.
- Rundgänge starten/enden online. Der Scan-/Abweichungs-Sync ist implementiert; reale Browser-/Geräte- und Netzausfall-End-to-Endtests bleiben offen.
- Mitarbeiterkonten und aktive Objektzuweisungen müssen vor validierten Scans administrativ verknüpft sein.
- Es gab keinen Production-Rollout und keinen unabhängigen Sicherheitsreview für diesen Feature-Branch. Es wird keine Einsatz- oder Bereitschaftsaussage getroffen.
