# SecurityOps 2.0 - Phase 11: QR-Code & NFC Kontrollpunkt-Spezifikation

## 1. Technische Verfahren
- **QR-Code**: Erfassung über die HTML5 MediaDevices Kamera-Schnittstelle.
- **NFC-Wandtransponder (RFID)**: Hardwaregestützte Erfassung über Web NFC (NFCReader) auf unterstützten Android-Geräten.
- **Anti-Duplikat-Schutz**: Serverseitige und clientseitige Sequenzprüfung verhindert mehrfaches unbemerktes Abtasten desselben Tags.

## 2. Manipulationsrisiken und Gegenmaßnahmen
- **Risiko**: QR-Codes können ausgedruckt oder abfotografiert werden.
- **Gegenmaßnahme nach DIN 77200**: Bei KRITIS-Objekten ist die Kombination mit kryptografisch gesicherten NFC-Tags und dynamischen Sequenzintervallen vorgeschrieben.
