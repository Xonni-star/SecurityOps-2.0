# Kontrollgangserfassung: QR, NFC und Fallbacks

## Erfassung

- **QR**: Die Scanneransicht verwendet die Browser-`BarcodeDetector`-API, sofern der Browser QR-Decodierung unterstützt. Der Browser muss Kamerazugriff erlauben; ein serverseitiger QR-Bilddecoder ist nicht vorhanden.
- **NFC**: Web NFC (`NDEFReader`) wird nur angeboten, wenn die Browser-/Geräteimplementierung es bereitstellt (typischerweise Android/Chromium, HTTPS und Nutzeraktion). Ein nativer iOS-NFC-Reader ist nicht integriert.
- **Manuell**: Wenn QR- oder NFC-APIs fehlen oder nicht verfügbar sind, kann die Bedienperson den Checkpoint manuell auswählen. Solche Einträge werden als `manual` gespeichert und sind nicht als tokenverifiziert zu verstehen.

QR-Inhalt: `secops:patrol:v1:<site UUID>:<checkpoint UUID>:<random token>`. Tokens enthalten 32 zufällige Bytes in Base64url-Kodierung; in PostgreSQL wird nur der SHA-256-Hash gespeichert. Der Klartext wird nur beim Erstellen oder Rotieren zurückgegeben. Rotation invalidiert den alten Token und erhöht die Tokenversion. Die QR-Code-Bildgenerierung geschieht lokal im Browser.

## Verifikation und Grenzen

QR-/NFC-Tokens werden bei der Synchronisierung durch die API geprüft, nicht offline durchsetzbar. Eine Offline-Erfassung bleibt ausstehend bis zur Serverantwort; ein in der Zwischenzeit rotierter/archivierter Kontrollpunkt wird beim Sync abgelehnt. Die API weist dieselbe Mitarbeiter-/Kontrollpunktkombination innerhalb von zwei Minuten zurück. Diese Prüfungen verhindern keine physische Manipulation oder Weitergabe eines fotografierten QR-Codes und beweisen keine Anwesenheit am Standort. Dynamische Tokens, kryptografisch gesicherte RFID-Hardware, Geofencing und KRITIS-spezifische Sequenzregeln sind nicht implementiert.

Weitere Details: [Kontrollgangsmanagement](./PATROL_MANAGEMENT.md).
