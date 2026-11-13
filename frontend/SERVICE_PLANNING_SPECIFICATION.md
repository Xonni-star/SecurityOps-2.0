# Technische Spezifikation: Dienstplanung

**Status:** Phase 2 implementiert Planungsoberfläche und API-gestützte Entwurfs-, Zuweisungs- und Veröffentlichungsabläufe. PR #16 (Backend) und PR #19 (Frontend) sind offen, nicht gemergt und nicht deployed. Das System ist nicht produktionsabgenommen und trifft keine Rechtskonformitätsaussage.
**Ausgangslage:** Das Phase-2-Backend erweitert `shifts` um aufgelöste Zeitpunkte, Planungsstatus, Mindestbesetzung, Revisionen und Prüf-/Auditdaten. Die API-Verträge, Berechtigungen und bekannten Grenzen stehen in [SERVICE_PLANNING_API.md](./backend/SERVICE_PLANNING_API.md); verifizierte PR-/CI-Stände, Frontend-Umfang, Audits und offene Grenzen in [PHASE_2_FINAL_COMPLETION_REPORT.md](../PHASE_2_FINAL_COMPLETION_REPORT.md).

## Aktueller Implementierungsstand

Die bestehende `roster`-Route zeigt Monats-, Wochen- und Tagesansichten mit Gruppierung nach Zeit, Mitarbeiter, Objekt oder Kunde, Filtern und Suche. Entwürfe können angelegt, bearbeitet, kopiert und wiederholt werden; Perioden, Templates, Zuweisungen, Tauschanträge, Prüfhinweise, Coverage- und Arbeitszeitberichte sowie CSV-/Druckausgabe verwenden die Planning-API. Serverseitige Befunde und Revisionskonflikte werden dargestellt. Zuweisungen und Veröffentlichung erfordern Online-Serverprüfung.

Der mandanten- und benutzerspezifische IndexedDB-Cache ermöglicht das Lesen der zuletzt geladenen Planung. Die Outbox erlaubt einzelne unbesetzte Entwurfsanlagen ohne Periodenbindung und Mindestbesetzung 1 sowie Draft-Updates mit Schicht-ID und Basisrevision. Offline-Updates lassen die Mindestbesetzung und Periodenzuordnung unverändert; Offline-Änderungen bleiben ausstehend und ungeprüft. Sie werden bei Verbindung serverseitig validiert; Konflikte/Ablehnungen werden nicht als Erfolg dargestellt.

Die UI unterstützt die Verwaltung versionierter, quellenbelegter Regelprofilentwürfe und die separate, online erfolgende Freigabe über die dokumentierten API-Endpunkte. Profilwerte werden nicht mit gesetzlichen oder tariflichen Standardwerten vorbelegt; eine Freigabe attestiert keine Rechtskonformität. Die Backend-API bietet Vorlagenliste, revisionierte Bearbeitung/Aktivierung und Anwendung; Hard-Delete und separater Copy-Endpunkt fehlen. Die aktuelle Vorlagen-API enthält keine Pausen-/Unterbrechungsregel, keinen konfigurierbaren Personalbedarf und keine Gültigkeitsdaten; Vorlagenanwendung erzeugt genau eine Personalbedarfsanforderung und übernimmt die Datenbankpause von 0 Minuten. Dafür werden keine UI-Felder erfunden. Berichte bieten geplante und aufgezeichnete Ist-Zeiten, konfigurierte Überstunden-/Nacht-/Feiertags-/Wochenendaufschlüsselungen sowie Coverage, Qualifikations- und Abwesenheitsberichte. Die Ist-Soll-Abweichung wird separat als erfasste Ist-Stunden minus Soll-Stunden mit dem Ist-Status dargestellt; konfigurierte Überstunden bleiben eine getrennte Kennzahl. Erklärbare Personalvorschläge sind deterministisch und unverbindlich; die API listet nur Kandidaten, die ihre anfänglichen Objekt-/Qualifikationsfilter bestehen, und nennt keine Einzelgründe für zuvor ausgefilterte Mitarbeitende. Eine gewählte Zuweisung wird separat serverseitig validiert. Fehlende Ist-/Regelwerte werden nicht als Nullwerte ausgegeben. Externe Rechts-/Tarifdaten, Benachrichtigungen, separate Ist-Zeit-Zweitfreigabe und eine Rechtskonformitätsbestätigung sind nicht implementiert. Die responsive UI wurde nicht auf realen Mobilgeräten oder unter allen Browsern geprüft; Rollout und fachliche/rechtliche Abnahme sind offen.

## Ziele und Grenzen

Die Planung bildet Besetzungsbedarf je Objekt/Qualifikation ab und schlägt geeignete Mitarbeitende deterministisch nach aktueller Wochenarbeitslast vor. Der Vorschlag ist unverbindlich und darf keine Zuweisung ohne Bestätigung erzeugen; die gewählte Besetzung wird anschließend serverseitig verbindlich validiert. Die Wochenarbeitslast-Reihenfolge ist keine Fairness- oder Rechtskonformitätsgarantie.

Das System soll Regelprofile unterstützen, aber keine gesetzlichen oder tariflichen Grenzwerte fest einprogrammieren und keine Rechtskonformität attestieren. Jede Organisation muss die für sie geltenden Regeln, Tarifverträge, Betriebsvereinbarungen und Ausnahmen durch fachlich/rechtlich zuständige Personen konfigurieren und freigeben. Änderungen gelten versioniert und mit Wirksamkeitsdatum.

## Regelprofile und Priorität

Ein Regelprofil gehört zu einem Mandanten und kann optional für Objekt, Mitarbeitergruppe oder Beschäftigungsart eingegrenzt werden. Es enthält versionierte Regeln mit `effective_from`, optionalem `effective_until`, Zeitzone, Quelle/Begründung, Status und Freigabe-Akteur. Regelwerte und Regelquellen müssen konfigurierbar sein; eine Regel darf nur dann angewendet werden, wenn sie im betreffenden Zeitraum aktiv und freigegeben ist.

Konfigurierbare Regelgruppen:

| Gruppe | Beispiele für konfigurierbare Parameter |
|---|---|
| Arbeitszeit | tägliche und wöchentliche Höchstwerte, Bezugszeitraum, Pausenmodell, Rundung |
| Ruhezeit | Mindestabstand zwischen Schichten, Ausgleichs- und Ausnahmebedingungen |
| Nacht-, Sonn- und Feiertagsarbeit | lokale Zeitfenster, Zuschlags-/Qualifikationsanforderung, zulässige Häufigkeit |
| Einsatzabdeckung | Mindestbesetzung nach Objekt, Posten, Zeitfenster und erforderlicher Qualifikation |
| Verfügbarkeit | genehmigte Abwesenheiten, Vertragszeitraum, Beschäftigungsstatus, Objektzuordnung |
| Tarif/Betrieb | vertragliche Wochenstunden, maximale Folgen, Vorlaufzeit und genehmigte Ausnahmen |

Ein Regelwert speichert neben dem Ergebnis auch Herkunft, Profilrevision und Wirksamkeitszeitraum. Fehlende, widersprüchliche oder abgelaufene Profilwerte führen zu einem sichtbaren Prüfstatus und nicht zu stillen Standardwerten.

## Daten- und API-Zielbild

Die vorhandene Tabelle `shifts` bleibt der Ausgangspunkt, benötigt für verbindliche Zeitberechnungen aber eine eindeutige Semantik aus lokalem Datum/Uhrzeit, IANA-Zeitzone und aufgelösten UTC-Zeitpunkten. Für Schichten über Mitternacht werden Anfang und Ende als konkrete Zeitpunkte modelliert. Eine Regelprofilrevision wird bei der Prüfung referenziert, sodass spätere Regeländerungen historische Entscheidungen nicht umdeuten.

Vor der Implementierung sind mindestens folgende Datenobjekte fachlich zu bestätigen:

* **Regelprofil und Regelprofilrevision:** Mandant, Anwendungsbereich, IANA-Zeitzone, Wirksamkeitszeitraum, Freigabe und Quellenangaben.
* **Besetzungsbedarf:** Objekt/Posten, Zeitfenster, Anzahl benötigter Kräfte, Qualifikationen und Priorität.
* **Zuweisung/Prüfergebnis:** Schicht, Mitarbeiter, geprüfte Regelrevision, Verstöße/Warnungen, Ergebnis und Version.
* **Ausnahmefreigabe:** verletzte Regel, Begründung, berechtigter Freigeber, Zeitstempel und unveränderbarer Audit-Eintrag.

Mögliche Ressourcen sind mandantengeschützte Endpunkte für Bedarf, Regelprofile, Kandidatenvorschläge, Zuweisung und Prüfbericht. Eine Zuweisung muss in einer Transaktion gegen den aktuellen Mitarbeiter-, Abwesenheits-, Objekt- und Regelstand validiert werden. Paralleländerungen benötigen Versionsprüfung und Sperr-/Serialisierungsstrategie; ein veralteter Plan darf nicht unbemerkt überschrieben werden. Endpunkte erben Authentifizierung, konkrete Berechtigungen, Tenant-RLS und die vorhandenen zusammengesetzten Fremdschlüssel.

## Zeit, Offlinebetrieb und Audit

Planungswerte werden in der Objekt-Zeitzone eingegeben. Die Zeitzone wird als IANA-ID (z. B. `Europe/Berlin`) und nicht als fester UTC-Offset gespeichert. Lokale Uhrzeiten in einer DST-Lücke müssen abgelehnt werden; mehrdeutige Uhrzeiten beim Zurückstellen der Uhr erfordern die explizite Wahl des Offsets. Dauer, Ruhezeit und Überschneidungen werden anhand aufgelöster UTC-Zeitpunkte berechnet, während die lokale Darstellung erhalten bleibt.

Offline darf ein Entwurf erfasst und als ausstehend markiert werden. Nach Authentifizierung startet die Outbox-Wiedergabe auch bei einer bereits bestehenden Online-Verbindung. Jede Mutation wird nur wiedergegeben, wenn sowohl Mandant als auch gespeicherte Benutzer-ID exakt zur aktuellen Identität passen; ältere Einträge ohne bekannten Benutzerbesitzer werden nicht übertragen. Eine verbindliche Zuweisung bzw. Ausnahmefreigabe wird erst nach serverseitiger Prüfung bestätigt. Sync verwendet eine stabile Mutation-ID, Payload-Hash, Basisversion und eine dauerhafte Serverquittung. Schichtkonflikte bleiben sichtbar; solange der Backend-Sync keinen vollständigen tenant-validierten Server-Snapshot liefert, sind Konfliktentscheidungen in der UI deaktiviert, um keine lokale Version ohne sichtbaren Serverstand durchzusetzen. Regelrevision, Prüfergebnis, manuelle Änderung und Ausnahmefreigabe werden nachvollziehbar auditiert.

Der Offline-Planungscache hält je Mandant und Benutzer nur den zuletzt geladenen Kalenderbereich. Der gespeicherte Zeitraum wird angezeigt; wenn der angeforderte Bereich nicht vollständig darin liegt, warnt die UI, dass leere Bereiche außerhalb des Caches nicht als fehlende Schichten interpretiert werden dürfen. Es gibt keine mehrbereichige Offline-Replikation.

## Abnahmekriterien für eine spätere Implementierung

1. Überlappungen, fehlende Qualifikation, inaktive Mitarbeitende, genehmigte Abwesenheit und fehlende Objektzuordnung werden serverseitig erkannt.
2. Arbeitszeit-/Ruhezeitregeln sind aus dem aktiven Profil gelesen; keine gesetzlichen Zahlenwerte sind im Code fest verdrahtet.
3. Ein genehmigter Ausnahmefall speichert Grund, Freigeber, verletzte Regel und Profilrevision; ein unberechtigter Benutzer kann ihn nicht freigeben.
4. Gleichzeitige Zuweisungen an denselben Mitarbeiter/Zeitraum führen deterministisch zu einem Erfolg und einem Konflikt, nie zu Doppelbelegung.
5. Tests decken Mandantentrennung, Versionkonflikte, Mitternachtsschichten sowie DST-Lücke und DST-Mehrdeutigkeit ab.
6. Offline-Sync bestätigt erst nach erfolgreicher Serverprüfung und erhält Quittung/ Konfliktstatus über Wiederholungen hinweg.
7. Profiländerungen sind versioniert, zeitlich wirksam und auf Testdaten nachvollziehbar; fachliche Freigabe wird vor einem Produktiveinsatz dokumentiert.

## Grenzen und Voraussetzungen

Die serverseitige Validierung prüft nur die implementierten Planungsregeln und vorhandenen Mitarbeiter-, Qualifikations-, Abwesenheits- und Objektzuordnungsdaten. Konfigurierbare Profile liefern keine externen Rechts- oder Tarifgrenzen; Mandanten müssen Regeln und Quellen fachlich festlegen und freigeben. Ein erfolgreich synchronisierter Entwurf ist nicht automatisch veröffentlicht oder rechtlich freigegeben. Vor dem Produktiveinsatz sind Browser-/Geräteverhalten, Betriebs-/Backupkonfiguration und die fachliche sowie rechtliche Abnahme separat zu verifizieren.

## Verifikationsstatus (2026-11-13)

- `cd frontend && npm test`: 14 Testdateien, 83 Tests bestanden.
- `cd frontend && npm run build`: erfolgreich; Vite meldet den bestehenden `__dirname`-Config-Hinweis und einen Chunk über 500 kB.
- `cd frontend && npm audit`: 0 Vulnerabilities.
- `cd frontend/backend && npm audit`: 7 Low-Severity-Befunde im Jest/`ts-jest`-Testwerkzeug-Dependency-Tree, einschließlich `deepmerge` GHSA-gcqx-w48m-w2h4; `npm audit --omit=dev`: 0 Vulnerabilities. Der vorgeschlagene `--force`-Fix wäre ein Jest-Downgrade mit Breaking Change und wurde nicht angewendet.
- PR #16 CI run `43487585461` passed all four jobs at head `c826460f0cc70e16031db93f8c5b0ccb8e3606da`.
- PR #19 CI run `43489042661` passed all four jobs at head `aa45781f55db81bffd69e3557ea478dca36aa38d`.

Diese Prüfungen enthalten keinen Geräte-/Browser-Kompatibilitätstest, Produktions-Rollout oder fachlich/rechtliche Abnahme.
