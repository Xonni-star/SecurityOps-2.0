# SecurityOps 2.0 - Phase 14: Apple iOS MDM & ASAM Konfiguration

## 1. Bereitstellung über Apple Configurator / MDM
- Das iPhone / iPad muss den Status **Supervised (Überwacht)** besitzen (über Apple Business Manager oder Apple Configurator 2).
- MDM-Payload `com.apple.app.lock` mit Bundle-Identifier `de.securityops.mobile`.
- Autonomous Single App Mode (ASAM) sperrt das Gerät in SecurityOps 2.0, bis der Wachleiter die PIN eingibt.
