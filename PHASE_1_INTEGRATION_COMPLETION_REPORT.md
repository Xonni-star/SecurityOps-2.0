# Phase 1: Gesamtintegration und technische Konsolidierung

**Prüfstand:** 2026-11-13  
**Basis:** `main` / `252d4bf6e8ff26d7b7855529952cb5340d8f8fa8`  
**Ergebnis:** Codebasierte Bestandsaufnahme abgeschlossen; ein reproduzierbarer Authentifizierungsfehler ist behoben und bekannte Runtime-Abhängigkeitshinweise sind aktualisiert. Die Anwendung bleibt ausdrücklich **nicht produktionsfreigegeben**.

## A–G: Bestandsaufnahme und Bewertung

Die Buchstaben bezeichnen hier die sieben geprüften technischen Bereiche, nicht ein Reifegrad- oder Compliance-Siegel.

| Bereich | Tatsächlicher Quellcodebestand | Bewertung |
|---|---|---|
| **A – Architektur und API** | React/Vite-Frontend, TypeScript/Express-API unter `/api/v1`, PostgreSQL-Migrationen und ein separates Docker-Produktionsprofil. Das Compose-/Caddy-Ziel ist das TypeScript-Backend; Python-Dateien im Backend-Verzeichnis sind nicht als aktueller Produktionspfad nachgewiesen. | Implementiert; Betriebs-/Produktionsdeployment nicht nachgewiesen. |
| **B – Authentifizierung und RBAC** | Argon2id-Login, zufällige opake `HttpOnly`-Sessioncookies mit Datenbank-Widerruf, CSRF-Cookie/Header-Prüfung, Tenant-Auswahl, Berechtigungs-Middleware und accountbasierter Fehlversuch-Lockout. Keine Benutzer-/Rollen-Administrations-API. `RATE_LIMIT_MAX` wird eingelesen, aber nicht angewendet. `JWT_SECRET` bleibt als Legacy-Konfigurationspflicht bestehen, obwohl der aktuelle Sitzungsweg keine JWTs signiert. | Kernpfad implementiert und getestet; globales/verteiltes Request-Rate-Limit fehlt; Secret-Konfiguration ist nicht mit dem aktuellen Auth-Mechanismus konsolidiert. |
| **C – Tenant, RLS und Identitätsbeziehungen** | `withTenantTransaction` setzt den Tenant-Transaktionskontext; Migrationen aktivieren/erzwingen RLS. Zusammengesetzte Fremdschlüssel verbinden tenant-scoped Daten. Mitarbeiter↔Benutzer-Verknüpfungen und Mitarbeiter↔Objekt-Zuordnungen sind modelliert; `secops_app_user` wird beim Serverstart auf Privilegien geprüft. | Mehrschichtiger Isolationspfad vorhanden; Integrations- und RLS-Tests bestehen. Vollständige Produktionskonfiguration bleibt Betreiberverantwortung. |
| **D – Fachmodule** | Kunden, Objekte, Mitarbeiter, Schichten, Schlüssel, Aufgaben und Wachbuch haben Backend-Persistenz. DMS, SOP, Alarm/Notfall, Übergabe und Patrol besitzen Migrationen, APIs und Modul-Workflows. PR #12 (Alarm), #13 (Übergaben) und #14 (Patrol) sind in `main` enthalten. | Deutlich mehr als der historische README-/Auditstand; Moduldetails und verbleibende Grenzen siehe Matrix unten. |
| **E – Zeit und Dienstplanung** | Schichten verwenden `DATE` plus Uhrzeit-Strings und Basis-CRUD. Mitarbeitende besitzen Qualifikations-, Abwesenheits- und Objektzuordnungsdaten. Patrol-Terminierung nutzt je Route eine IANA-Zeitzone. Eine serverseitige Prüfung von Arbeitszeit, Ruhezeit, Überschneidungen oder Tarifregeln ist nicht implementiert. | Dienstplanungs-Fachlogik bleibt offen. Ein technisches Zielbild ist separat spezifiziert; keine Planung implementiert. |
| **F – Audit und Offline-Synchronisierung** | IndexedDB-Outbox, mutation IDs, serverseitige Sync-Routen/Quittungen und Konfliktpfade sind in mehreren Domänen vorhanden. DMS, Übergaben, Alarme, SOP und Patrol haben Domänenereignisse bzw. Audit-Tabellen. | Teilweise integriert; kein Nachweis, dass jede Aktion, jedes Binärartefakt und jeder Wiederanlauf offline verfügbar ist. |
| **G – Betrieb, CI und Sicherung** | CI enthält Root-/Frontend-/Backend-Jobs, PostgreSQL-Integration und Docker-Build/Compose-Validierung. Produktions-Compose trennt Migration, Anwendungsrolle, API und Proxy. Backup-Skript verschlüsselt DB-Dump plus DMS-Dateien; ein Restore-Runbook existiert. | Automatisierte Builds/Tests vorhanden. Kein Produktions-Rollout oder erfolgreich durchgeführter Restore wurde in dieser Prüfung belegt. |

### Modulstatus aus dem aktuellen Quellcode

| Modul | Nachgewiesene Funktion | Offene Grenze |
|---|---|---|
| Kunden/Objekte | Tenant-scoped API, Persistenz, Versionierung, Archiv-/Sync-Pfade | Bedienabläufe und vollständige Offlineabdeckung sind nicht als Produktionsabnahme belegt |
| Mitarbeiter | Stammdaten, Qualifikationen, Abwesenheiten, Konto-/Objektzuordnungen | Keine Benutzer-/Rollenverwaltung; Planungsregeln prüfen Qualifikation/Abwesenheit nicht verbindlich bei jeder Zuweisung |
| Schichten | REST CRUD, Sync, Datenbankbeziehungen und Revision | Keine serverseitige Kollisionserkennung oder ArbZG-/Tarifprüfung |
| Schlüssel/Aufgaben | REST CRUD und Sync-Pfade | Keine vollständige Historie/Offlineabdeckung für jeden Vorgang belegt |
| Wachbuch | Lesen, Erfassung, Korrektur als Ergänzung und Sync | Prüfstand umfasst nicht jede Audit-/Export-/Offlineanforderung |
| DMS | Tenant-scoped Metadaten, private Dateien, Versionen, Kategorien/Ordner, Audit und Beziehungen | Externe Virenprüfung nicht konfiguriert; Binärdateien sind nicht vollständig offline synchronisiert |
| SOP | Versionierung, Review/Freigabe, Zuweisung, Bestätigung und Bericht | Nicht deployed; keine produktive Benachrichtigung bestätigt |
| Alarm/Notfall | Pläne, Vorfälle, Ereignisse, Sync und Eskalationsworker | Externe E-Mail-/Push-Zustellung ist nicht konfiguriert |
| Übergabe | Protokolle, getrennte Bestätigungen, Ereignisse, Aufgaben, DMS-Links und Sync | Nicht deployed; Offline- und Betriebsabnahme ausstehend |
| Patrol | Checkpoints, Routen/Versionen, Gruppen, Scans, Zeitpläne/Vorkommen, Abweichungen und Offline-Sync | Externe Zustellung und Offline-Binäranhänge fehlen; nicht deployed |

## Behobener, reproduzierbarer Integrationsfehler

`authenticateJwt` behandelte Fehler beim Datenbankzugriff zur Sessionauflösung als HTTP 401 „Sitzung ungültig“. Der API-Client löst bei 401 ein `securityops:unauthorized`-Ereignis aus und setzt so auch bei einem vorübergehenden Datenbankausfall den angemeldeten Frontend-Zustand zurück. Das Middleware reicht den Fehler jetzt an den zentralen, detailredigierenden Error-Handler weiter, der HTTP 500 ausgibt. Ein Regressionstest erzwingt einen DB-Fehler und prüft, dass kein 401/Antwortkörper aus der Auth-Middleware erzeugt wird.

## Dependency-Härtung

Das Runtime-Dependency-Audit meldete Zod `<4.6.6` (High) und uuid `<11.1.1` (Moderate). Backend-Abhängigkeiten wurden auf `zod@^4.6.7` und `uuid@^11.1.1` aktualisiert. Zod 4 verschärft `uuid()` auf RFC-Varianten; die Eingabevalidierung nutzt nun `guid()`, damit bisher akzeptierte UUID-formatierte PostgreSQL-Werte gültig bleiben. Payload-Record-Schemas verwenden die explizite Key-/Value-Signatur von Zod 4. Der vollständige Backend-Testlauf bestätigt die Kompatibilität. `npm audit --omit=dev` meldet danach **0 Runtime-Advisories**; der vollständige Installationsbaum meldet weiterhin 7 niedrige Hinweise in Entwicklungsabhängigkeiten.

## Sicherheits- und Betriebsbefunde

* `RATE_LIMIT_MAX` ist im Konfigurationsschema enthalten, aber unbenutzt. Die bestehende Sperre nach wiederholten falschen Passwörtern ist kein IP-basierter oder verteilter Request-Rate-Limiter.
* Die technische Dienstplanung hat keine verbindlichen serverseitigen Arbeitszeit-, Ruhezeit-, Überschneidungs- oder Tarifprüfungen. Konfigurierbare Regelprofile und Anforderungen sind in [SERVICE_PLANNING_SPECIFICATION.md](./frontend/SERVICE_PLANNING_SPECIFICATION.md) beschrieben; es wurden dafür keine Tabellen, Endpunkte oder Regeln umgesetzt.
* Backup-/Restore-Skripte und Docker-Konfiguration belegen nur den vorgesehenen Betriebsweg. Kein externer Dienst, Produktionsbetrieb oder durchgeführter Wiederherstellungslauf wurde geprüft.

## Verifikation

| Prüfung | Ergebnis |
|---|---|
| Frontend Vitest | **56 Tests in 11 Dateien bestanden** |
| Frontend Produktionsbuild | Erfolgreich; Vite meldet bestehende Konfigurations-/Chunkgrößen-Warnungen |
| Backend TypeScript-Build | Erfolgreich |
| PostgreSQL 16, frische DB | **27 Migrationen angewendet**, Seed für zwei Testmandanten erfolgreich |
| Backend Jest inkl. RLS/Integration | **220 Tests in 21 Suites bestanden** |
| Gezielte Auth-/Error-Regression | **8 Tests in 4 Suites bestanden**, einschließlich neuem DB-Fehler-Test |
| Backend Lockfile-Installation | `npm ci --prefix frontend/backend` erfolgreich |
| Backend Runtime Dependency Audit | `npm audit --prefix frontend/backend --omit=dev`: **0 Findings** |
| Produktions-Docker | Compose-Konfiguration validiert; Backend- und Frontend-Images erfolgreich gebaut |
| GitHub CI auf `main` | Merge-Lauf `43439284509` erfolgreich; nachfolgender Release-Artefakt-Lauf `43439596034` erfolgreich |
| Arbeitsbaum vor Phase-1-Änderungen | Sauber; HEAD entsprach dem live abgefragten `main`-Commit |
| CI für diesen Feature-Branch | Noch nicht ausgeführt; muss nach PR-Erstellung durch GitHub bestätigt werden |

## Grenzen und Abschlussstatus

Die Prüfung bestätigt Funktionspfade und Testresultate, nicht rechtliche Konformität, tatsächliche Produktionskonfiguration, Hochverfügbarkeit, Datenschutzfreigabe, Benutzerakzeptanz oder Wiederherstellbarkeit produktiver Daten. Frühere Berichte wurden nicht als Quelle für den aktuellen Modulstatus behandelt, weil sie nachweislich vor den Merges #12–#14 entstanden.

**Phase-1-Status:** Implementierte Bereiche sind konsolidiert dokumentiert; der nachgewiesene Auth-Fehler ist korrigiert; die gemeldeten Runtime-Advisories sind behoben; Dienstplanung ist spezifiziert, nicht implementiert. Das fehlende allgemeine Request-Rate-Limit, niedrige Hinweise in Entwicklungsabhängigkeiten, unvollständige Offlineabdeckung und die fehlende Produktions-/Restore-Abnahme bleiben offene Arbeit.

**Commit/PR:** Wird nach dem Commit und der Erstellung des Reviews-PRs ergänzt.
