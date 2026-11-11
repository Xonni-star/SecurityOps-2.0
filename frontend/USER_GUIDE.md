# SecurityOps 2.0 – Vollständig bebildertes Benutzerhandbuch

## 1. Einführung & Systemarchitektur
SecurityOps 2.0 ist eine zertifizierte Sicherheitsdienstverwaltungssoftware nach DIN 77200-1:2020-10 und § 34a GewO. Dieses Handbuch führt Schritt für Schritt mit Abbildungen, nummerierten Markierungen (Callouts) und Erklärungen durch alle Kernarbeitsabläufe.

### Bildverzeichnis (In-App & Dokumentation)
Alle Abbildungen sind im zentralen Dokumentationsverzeichnis `docs/handbuch/images/` sowie direkt in der Webanwendung unter dem Menüpunkt **Bebildertes Handbuch** verfügbar:
- `docs/handbuch/images/dashboard/01_lagebild_hauptansicht.svg`
- `docs/handbuch/images/mitarbeiter/02_personal_anlegen_bwr.svg`
- `docs/handbuch/images/wachbuch/03_vorfall_erfassen_ki.svg`
- `docs/handbuch/images/mobile/04_mobile_app_qr_nfc.svg`
- `docs/handbuch/images/offline/05_outbox_sync_konflikt.svg`
- `docs/handbuch/images/kiosk/06_wachlokal_terminal_pin.svg`
- `docs/handbuch/images/schluessel/07_depot_rueckgabe_verzug.svg`

---

## 2. Visuelle Schritt-für-Schritt Anleitungen

### Kapitel 1: Einsatz-Dashboard & Leitstellen-Lagebild
```
┌────────────────────────────────────────────────────────────────────────┐
│ [1] Mandanten-Umschaltung                                              │
│ Securitas & Wache Frankfurt GmbH       ● PostgreSQL Live (RLS Aktiv)   │
├────────────────────────────────────────────────────────────────────────┤
│ [2] KPI-Übersicht:                                                     │
│ [4/5 Personal Aktiv]  [2 KRITIS Objekte]  [2/3 Schichten]  [Schlüssel] │
├────────────────────────────────────────────────────────────────────────┤
│ [3] Soll/Ist Stundenvergleich (Woche):                                 │
│ Ist: 476h / Soll: 480h  [=========================================] 98%│
└────────────────────────────────────────────────────────────────────────┘
```
- **Schritt 1 (Markierung [1])**: Prüfen Sie in der Kopfzeile den aktiven Mandanten. Alle Datenräume sind physisch getrennt.
- **Schritt 2 (Markierung [2])**: Überwachen Sie die vier Kern-KPIs. Rote Warnungen signalisieren sofortige Handlungsnotwendigkeit.
- **Schritt 3 (Markierung [3])**: Schnellerfassung von Wachbucheinträgen oder direktes Öffnen der Schichtdisposition.

---

### Kapitel 2: Mitarbeiter anlegen & § 34a GewO Qualifikationsprüfung
1. **Navigation**: Klicken Sie in der linken Seitenleiste auf **Personal & § 34a GewO**.
2. **Dialog**: Betätigen Sie die Schaltfläche **Mitarbeiter anlegen** oben rechts.
3. **Stammdaten**: Tragen Sie Vorname, Nachname, Personalnummer, E-Mail und Wochenstunden ein.
4. **Qualifikation**: Wählen Sie die IHK-Qualifikation (`Sachkundeprüfung § 34a GewO` oder `Unterrichtung § 34a GewO`).
5. **Watchdog**: Tragen Sie das Zertifikatsablaufdatum ein. Der Watchdog überwacht die Frist automatisch und erzeugt 30 Tage vor Ablauf eine HR-Aufgabe.

---

### Kapitel 3: Digitales Wachbuch & Vorfallsmanagement
1. Öffnen Sie das **Digitale Wachbuch** über die Navigation oder mit dem Tastenkürzel **Ctrl+K**.
2. Klicken Sie auf **Ereignis erfassen**.
3. Wählen Sie das Schutzobjekt, die Wachkraft, Kategorie und Priorität (`Normal`, `Dringend`, `Kritisch`).
4. **Manuelle Dokumentation**: Erfassen Sie Titel und Sachverhalt selbst. Prüfen Sie die Angaben auf Vollständigkeit, Sachlichkeit sowie korrekte Zeiten und Beteiligte, bevor Sie den Eintrag speichern.
5. **Append-Only Sicherung**: Korrekturen werden als unzerstörbare Revisionen (`LogbookRevisionEntry`) angehängt.

---

### Kapitel 4: Mobile Mitarbeiter-App & QR-/NFC-Kontrollgang
1. Öffnen Sie auf dem Smartphone die Web-App oder installieren Sie die PWA.
2. Wechseln Sie über **Mitarbeiter-App** in die Daumennavigation.
3. **Mein Dienst**: Schichtzeiten und Anruf-Button zum Objektleiter einsehen.
4. **Scan**: Richten Sie die Kamera auf den QR-Code der Stechstelle oder halten Sie das Smartphone an den NFC-Wandtransponder.
5. **Anti-Duplikat-Schutz**: Doppelte Scans desselben Kontrollpunkts innerhalb von 2 Minuten werden automatisch abgewiesen.

---

### Kapitel 5: Offline-Betrieb & Synchronisations-Zentrale
1. Bei Netzwerkausfall schaltet die Anwendung nahtlos auf den **Offline-Modus** um.
2. Alle Einträge werden verschlüsselt in der lokalen **IndexedDB Outbox** zwischengespeichert.
3. Bei Reconnect gleicht das Push-Protokoll alle Einträge über `client_uuid` dedupliziert und idempotent mit dem Server ab.
4. Bei Kollisionen zweier Offline-Geräte öffnet das **SyncManagerModal** eine Side-by-Side Gegenüberstellung.

---

### Kapitel 6: Kiosk-Modus für Wachlokal-Tablets
1. Wand-Tablets laufen im gesperrten Vollbildmodus.
2. Wachkräfte authentifizieren sich für Kontrollgänge per PIN-Pad oder RFID-Dienstausweis.
3. Nach 120 Sekunden Inaktivität schützt der automatische Timeout Kundendaten vor fremden Blicken.

---

### Kapitel 7: Schlüssel- & Transponderdepotverwaltung
1. Unter **Schlüssel & Zutrittsmedien** sehen Sie den Status jedes Generalschlüssels.
2. **Ausgabe**: Quittieren Sie die Schlüsselausgabe mit Name und geplanter Rückgabeuhrzeit.
3. **Verzugswarnung**: Wird der Schlüssel nicht fristgerecht zurückgegeben, erzeugt die Watchdog-Engine automatisch eine Eskalationsaufgabe.
4. **Rücknahme**: Bestätigen Sie die Rücknahme ins Tresordepot mit einem Klick.
