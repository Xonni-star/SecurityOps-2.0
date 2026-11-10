# SecurityOps 2.0 - Phase 14: Kiosk-Modus Architektur

## 1. Betriebsarten
- **Modus A – Einzel-App-Kiosk (`EINZEL_APP_KIOSK`)**:
  - Android: `Activity.startLockTask()` über Device Owner (`DevicePolicyManager.setLockTaskPackages()`). Home-, Back- und App-Switcher-Tasten sind hardwareseitig gesperrt.
  - iOS: Supervised Single App Mode (ASAM) via MDM Konfigurationsprofil (`com.apple.app.lock`).
  - Verlassen nur durch autorisierte Leitstellen-PIN (Standard `7720`).
- **Modus B – Mehr-App-Kiosk (`MEHR_APP_KIOSK`)**:
  - SecurityOps 2.0 als primäre Oberfläche; ausgewählte System-Tools (Kamera, Telefon-Notruf) freigegeben.
- **Modus C – Normaler Mitarbeiterbetrieb (`NORMALER_BETRIEB`)**:
  - Unbeschränkte mobile App für persönliche Dienstgeräte (BYOD/Corporate).

---

## 2. Arbeitsplatzprofile (Station Profiles)
1. **Pforte & Empfang**: Wachbuch, Besucherausweise, Schlüsselausgabe, Schichtwechsel.
2. **Rundgangskontrolle**: QR-Code- und NFC-Scanner, Vorfallsmeldungen mit Kamera, Aufgaben.
3. **Wachbuch-Terminal**: Stationäres Wand-Tablet für Wachwechsel und Schichtübergaben.
