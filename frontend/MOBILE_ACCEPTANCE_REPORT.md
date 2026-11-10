# SecurityOps 2.0 - Phase 13: Mobile Abnahme & Touch-Ergonomie

## 1. Mobile Einsatzbereitschaft
- **Responsive PWA-Shell (`components/MobileAppShell.tsx`)**: Getestet auf Smartphones (375px bis 430px Breite) und Tablets (768px bis 1024px Breite).
- **Barrierefreiheit (WCAG 2.2 AA)**:
  - Touch-Targets der unteren Navigationsleiste besitzen mindestens 44x44 CSS-Pixel.
  - Kontrastverhältnis von Text zu Hintergrund erfüllt AA-Anforderungen (> 4.5:1).
- **Hardware-Schnittstellen**:
  - Kamera-Feed zur QR-Code-Erfassung über HTML5 MediaDevices mit visueller Zielmarkierung.
  - Anti-Duplikat-Watchdog verhindert Fehlscans desselben Kontrollpunkts innerhalb von 2 Minuten.
  - Fotodokumentation mit lokaler Größenvalidierung (maximal 5 MB pro Vorfallsfoto).
