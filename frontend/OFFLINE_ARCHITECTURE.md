# SecurityOps 2.0 - Phase 6: Offline-First Architektur

## 1. PWA & Service Worker
SecurityOps 2.0 ist als vollwertige Progressive Web App (PWA) nach modernen Webstandards konzipiert:
- **App Shell Caching**: Die Kernanwendung (`index.html`, Scripts, Styles, Icons) wird über `public/sw.js` lokal im Cache vorgehalten.
- **Offline Erkennung**: Reagiert nahtlos auf `navigator.onLine`, `window.addEventListener('online')` und `window.addEventListener('offline')`.
- **Installierbar**: Über `public/manifest.json` auf Desktop (Chrome/Edge), Tablets (iPad/Android) und mobilen Dienstgeräten installierbar.

---

## 2. Lokale Datenspeicherung (IndexedDB Vault)
Die lokale Speicherung erfolgt über die native Browser-IndexedDB `SecurityOps2_OfflineVault`:
1. **`outbox` Store**: Warteschlange für erfasste Mutationen (`id`, `tenantId`, `entityType`, `action`, `payload`, `occurredAt`, `status`).
2. **`inbox` Store**: Lokale Replikation von Mandantendaten (Objekte, Schichten, Notfallpläne).
3. **`attachments` Store**: Allgemeiner lokaler Anhangsspeicher für explizit integrierte Workflows; Alarmfotos sind nicht angebunden.
4. **`device_meta` Store**: Speicherung der cryptographischen Geräte-ID (`dev-uuid`) und Vertrauensstufe.

SOP-Kenntnisnahmen verwenden zusätzlich den `sopAcknowledgements`-Store derselben IndexedDB. Jeder Eintrag ist an Mandant, Benutzer, SOP-Zuweisung und konkrete Versions-ID gebunden und enthält einen stabilen `clientMutationId` sowie den Erfassungszeitpunkt. Der Eintrag wird dauerhaft gespeichert, bevor die Oberfläche die Bestätigung als vorgemerkt anzeigt; fehlgeschlagene Übertragungen werden mit derselben Mutation-ID erneut versucht und erst nach bestätigter Serverantwort entfernt. Der allgemeine Entity-Outbox-Endpunkt wird dafür nicht verwendet. Alte localStorage-Einträge werden nur dann einmalig übernommen, wenn die konkrete Versions-ID zuverlässig zugeordnet werden kann.

Alarmmeldungen, Maßnahmen und Statusänderungen verwenden ebenfalls dieselbe Datenbank `SecurityOps2_OfflineVault` (Schema-Version 4), im separaten `alarmMutations`-Store. Mutationen sind tenant- und benutzerspezifisch, erhalten vor der Netzwerkanfrage eine clientseitige ID und werden mit diesem Schlüssel wiederholt. Incident-Berichte werden vor abhängigen Maßnahmen/Statusänderungen synchronisiert; der Server prüft Payload-Hashes und liefert für identische Wiederholungen dieselbe Quittung. Veraltete Revisionen oder fachliche Ablehnungen werden als `conflict` festgehalten; temporäre Netzwerkfehler bleiben `pending`. Der UI-Status `confirmed` wird erst nach positiver Serverantwort angezeigt.

Notfallpläne, Alarmarten und erlaubte Sites werden benutzerspezifisch zwischengespeichert; Kontaktinformationen werden vor dem Cache entfernt. Offline-Alarme sind lokal erfasst, nicht serverseitig alarmiert oder zugestellt. Vorhandene Dokumente können online als Maßnahme referenziert werden, aber Fotos/Dateien für einen Alarm offline aufzunehmen und später hochzuladen ist nicht implementiert.

Übergaben verwenden denselben `outbox`-Store mit `entityType='handover'`, stabiler Client-ID, Mandant, Benutzer, Erfassungszeitpunkt und Payload. Der Store schreibt zuerst transaktionssicher in IndexedDB; danach überträgt der bestehende Sync-Manager die Mutationen an `POST /api/v1/handovers/sync`. `SYNCED` entfernt die Outbox-Mutation, `CONFLICT` und `FAILED` bleiben lokal erhalten. Eine Wiederverwendung einer Client-ID mit abweichendem Inhalt wird nicht als Erfolg behandelt. Lokale Einträge sind sichtbar als „ausstehend“, nie als serverbestätigt.

Die Handover-Outbox ermöglicht Offline-Erfassung des Übergabeprotokolls und initialer Aufgaben. Bestätigungen, spätere Aufgabenänderungen und DMS-Verknüpfungen benötigen eine Online-Verbindung. Die Erfassung setzt eine aktive Sitzung und zuvor geladene Objekt-/Mitarbeiter-Stammdaten voraus; nach App-Neustart ohne Netzwerk können Sitzung und Stammdaten nicht wiederhergestellt werden. Eine verspätete Erfassung ändert keine bestätigten Serverprotokolle; Korrekturen werden als Historienereignis hinzugefügt.

Kontrollgangs-Start, Scans (einschließlich optionaler GPS-Koordinaten), Abschluss (einschließlich Bemerkung) und Abweichungen verwenden dieselbe IndexedDB-Outbox mit stabiler Mutations-ID und tenant-/benutzerbezogenem Kontrollpunkt-, Routen- und Rundgangscache (Schema-Version 6). Die Outbox bleibt bei Netzwerkfehlern erhalten und kann nach App-Neustart erneut übertragen werden. Die Übertragungsreihenfolge ist Start → Scans/Abweichungen → Abschluss. Direkte API- und Sync-Mutationen teilen einen Payload-Hash, sodass ein wegen Verbindungsabbruch nicht bestätigter Online-Start/-Abschluss mit derselben Mutations-ID wiederholt werden kann. Ein gezielter Test öffnet Outbox, Route und Rundgang über eine neue Serviceinstanz.

Die Servertransaktion validiert Mitarbeiter-/Objektzuordnung, Kontrollpunkt, Token-Hash und Tokenversion und prüft Idempotenz sowie das Zwei-Minuten-Duplikatfenster. Eine wiederverwendete Mutations-ID mit anderem Payload-Hash oder ein veralteter/rotierter Token wird nicht als Erfolg behandelt. Der Token ist bis zur serverseitigen Prüfung Teil der lokalen Mutation und wird aus sichtbaren Queue-Vorschauen und Konfliktdetails redigiert; nach bestätigter Übertragung wird die Mutation entfernt. Ein Patrol-Konflikt wird erst nach serverseitiger Entscheidung entfernt: `USE_SERVER` verwirft den lokalen Sachverhalt zugunsten des abgefragten Serverstands; `RECORD_AS_EXCEPTION` speichert eine neue, tokenfreie Abweichung mit getrenntem idempotentem Konfliktbeleg. Bei fehlender Berechtigung oder ungültigen Referenzen bleibt die Outbox-Mutation erhalten. Online-Browserereignisse starten Sync automatisch. Offline erfasste Scans sind bis zur serverseitigen Prüfung kein verifizierter Kontrollnachweis. Browser-Events garantieren keine Hintergrundausführung nach App-/Browser-Schließung; geräteübergreifende tatsächliche Offline-/Kamera-/NFC-E2E-Prüfungen sind offen. Binäre Fotos/Dateien werden im Patrol-Modul nicht offline gespeichert oder synchronisiert.

---

## 3. Datenintegrität & Append-Only Modell
- **Digitales Wachbuch**: Einträge sind grundsätzlich **append-only**. Geschlossene Einträge werden niemals überschrieben; Änderungen werden als versionierte Korrekturrevisionen (`LogbookRevisionEntry`) revisionssicher angehängt.
- **Aufgaben & Termine**: Erkennung von Parallelbearbeitungen über `base_version` und `server_version`. Bei Kollisionen wird ein `CONFLICT` erzeugt, der im Conflict Resolution Center manuell oder per Regel aufgelöst werden kann.

## 4. Dokumentenmanagement

DMS-Metadaten werden nach erfolgreichem Serverabruf nur im Arbeitsspeicher der aktiven Sitzung gehalten und nicht in LocalStorage oder IndexedDB repliziert. Im Offline-Fall sind bereits geladene Metadaten durchsuchbar; Upload, Download, Vorschau, Bearbeitung, Archivierung und Wiederherstellung sind deaktiviert bzw. zeigen einen Fehler. Dokumentdateien und neue Änderungen werden nicht offline gepuffert oder als Servererfolg angezeigt. Eine Offline-Outbox für DMS-Metadaten ist nicht implementiert.
