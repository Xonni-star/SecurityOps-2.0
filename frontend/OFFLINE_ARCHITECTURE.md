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
3. **`attachments` Store**: Lokale Speicherung von Vorfallsfotos (Base64/Blobs) mit Validierung auf maximal 5 MB pro Bild.
4. **`device_meta` Store**: Speicherung der cryptographischen Geräte-ID (`dev-uuid`) und Vertrauensstufe.

SOP-Kenntnisnahmen verwenden zusätzlich den `sopAcknowledgements`-Store derselben IndexedDB. Jeder Eintrag ist an Mandant, Benutzer, SOP-Zuweisung und konkrete Versions-ID gebunden und enthält einen stabilen `clientMutationId` sowie den Erfassungszeitpunkt. Der Eintrag wird dauerhaft gespeichert, bevor die Oberfläche die Bestätigung als vorgemerkt anzeigt; fehlgeschlagene Übertragungen werden mit derselben Mutation-ID erneut versucht und erst nach bestätigter Serverantwort entfernt. Der allgemeine Entity-Outbox-Endpunkt wird dafür nicht verwendet. Alte localStorage-Einträge werden nur dann einmalig übernommen, wenn die konkrete Versions-ID zuverlässig zugeordnet werden kann.

Übergaben verwenden denselben `outbox`-Store mit `entityType='handover'`, stabiler Client-ID, Mandant, Benutzer, Erfassungszeitpunkt und Payload. Der Store schreibt zuerst transaktionssicher in IndexedDB; danach überträgt der bestehende Sync-Manager die Mutationen an `POST /api/v1/handovers/sync`. Die Antwort wird mit derselben Client-ID quittiert. `SYNCED` entfernt die Outbox-Mutation, `CONFLICT` und `FAILED` bleiben lokal erhalten, und fehlgeschlagene Mutationen können bei Verbindung erneut gesendet werden. Eine Konfliktwiederholung mit abweichendem Inhalt wird nicht als Erfolg behandelt. Synchronisierte Datensätze werden anschließend aus PostgreSQL geladen; lokale Einträge sind sichtbar als „ausstehend“, nie als serverbestätigt.

Die Handover-Outbox ermöglicht die Offline-Erfassung des Übergabeprotokolls und der initialen Aufgaben. Statusbestätigungen, Aufgabenänderungen und DMS-Verknüpfungen benötigen eine Online-Verbindung. Eine verspätete Erfassung kann bestätigte Serverprotokolle nicht ändern; Korrekturen werden als Historienereignis hinzugefügt.

Die Erfassung setzt eine aktive angemeldete Sitzung sowie zuvor geladene Objekt- und Mitarbeiter-Stammdaten voraus. Die vorhandene Session-Wiederherstellung ruft `/auth/me` online ab; nach einem App-Neustart ohne Netzwerk sind Anmeldung und Stammdaten deshalb nicht wiederherstellbar. Dieser Offline-Startpfad ist nicht implementiert.

---

## 3. Datenintegrität & Append-Only Modell
- **Digitales Wachbuch**: Einträge sind grundsätzlich **append-only**. Geschlossene Einträge werden niemals überschrieben; Änderungen werden als versionierte Korrekturrevisionen (`LogbookRevisionEntry`) revisionssicher angehängt.
- **Aufgaben & Termine**: Erkennung von Parallelbearbeitungen über `base_version` und `server_version`. Bei Kollisionen wird ein `CONFLICT` erzeugt, der im Conflict Resolution Center manuell oder per Regel aufgelöst werden kann.

## 4. Dokumentenmanagement

DMS-Metadaten werden nach erfolgreichem Serverabruf nur im Arbeitsspeicher der aktiven Sitzung gehalten und nicht in LocalStorage oder IndexedDB repliziert. Im Offline-Fall sind bereits geladene Metadaten durchsuchbar; Upload, Download, Vorschau, Bearbeitung, Archivierung und Wiederherstellung sind deaktiviert bzw. zeigen einen Fehler. Dokumentdateien und neue Änderungen werden nicht offline gepuffert oder als Servererfolg angezeigt. Eine Offline-Outbox für DMS-Metadaten ist nicht implementiert.
