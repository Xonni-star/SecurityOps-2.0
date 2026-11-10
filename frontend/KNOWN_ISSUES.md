# SecurityOps 2.0 - Bekannte technische Einschränkungen (Release 1.0)

1. **Web NFC Unterstützung**: Die Web NFC API wird gegenwärtig von Google Chrome auf Android unterstützt. Auf iOS Safari steht Web NFC aufgrund von Apple-Restriktionen nicht zur Verfügung; Wachkräfte nutzen auf iOS den integrierten QR-Code Scanner.
2. **Kamera-Berechtigung im Iframe**: Bei Einbettung in strikten Drittanbieter-Iframes muss das Attribut `allow="camera"` gesetzt sein.
3. **Background Sync API**: In Browsern ohne Background Sync (z. B. Firefox) greift der automatische Reconnect-Event-Listener (`window.addEventListener('online')`) als zuverlässiger Fallback.
