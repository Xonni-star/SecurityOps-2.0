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

---

## 3. Datenintegrität & Append-Only Modell
- **Digitales Wachbuch**: Einträge sind grundsätzlich **append-only**. Geschlossene Einträge werden niemals überschrieben; Änderungen werden als versionierte Korrekturrevisionen (`LogbookRevisionEntry`) revisionssicher angehängt.
- **Aufgaben & Termine**: Erkennung von Parallelbearbeitungen über `base_version` und `server_version`. Bei Kollisionen wird ein `CONFLICT` erzeugt, der im Conflict Resolution Center manuell oder per Regel aufgelöst werden kann.

## 4. Dokumentenmanagement

DMS-Metadaten werden nach erfolgreichem Serverabruf nur im Arbeitsspeicher der aktiven Sitzung gehalten und nicht in LocalStorage oder IndexedDB repliziert. Im Offline-Fall sind bereits geladene Metadaten durchsuchbar; Upload, Download, Vorschau, Bearbeitung, Archivierung und Wiederherstellung sind deaktiviert bzw. zeigen einen Fehler. Dokumentdateien und neue Änderungen werden nicht offline gepuffert oder als Servererfolg angezeigt. Eine Offline-Outbox für DMS-Metadaten ist nicht implementiert.
