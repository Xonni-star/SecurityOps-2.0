# SecurityOps 2.0 - Bekannte technische Einschränkungen (Release 1.0)

In Übereinstimmung mit den verbindlichen Qualitätskriterien werden nachfolgende plattformbedingte Einschränkungen transparent dokumentiert:

1. **Web NFC API auf iOS (Apple Safari)**:
   - *Einschränkung*: Die Web NFC Spezifikation wird aktuell nur von Chromium-basierten Browsern auf Android unterstützt.
   - *Verhalten*: Auf iOS-Geräten blendet die mobile App den NFC-Modus automatisch aus; Sicherheitskräfte nutzen den kamera-basierten QR-Code-Scanner oder die manuelle Bestätigung.
2. **Kamerazugriff in Drittanbieter-Iframes**:
   - *Einschränkung*: Wenn die Web-App in fremde Sicherheitsportale eingebettet wird, erfordert der QR-Code-Scanner das iframe-Attribut `allow="camera"`.
3. **Background Sync API**:
   - *Einschränkung*: Die W3C Background Sync API wird nicht von allen Desktop-Browsern (z. B. Firefox) unterstützt.
   - *Lösung*: SecurityOps 2.0 besitzt einen transparenten Fallback über den `online`-Eventlistener des Browser-Fensters.
