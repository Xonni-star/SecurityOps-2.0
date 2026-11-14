# SecurityOps 2.0 - Backup- und Wiederherstellungskonzept

## 1. Vollständiges Backup

Der Produktionsdienst erstellt täglich ein Archiv mit PostgreSQL-Dump. Das Archiv wird mit AES-256-CBC/PBKDF2 verschlüsselt, im Volume `secops_backups` gespeichert und nach 30 Tagen gelöscht. DMS-Objekte liegen in einem externen S3-kompatiblen Speicher und sind nicht Bestandteil dieses Archivs.

Für die Wiederherstellbarkeit des DMS müssen Betreiber zusätzlich S3-Versionierung, Replikation/Backup und Retention beim gewählten Anbieter konfigurieren und testen. Ein konsistenter Datenbankdump ohne passende S3-Objekte ist keine vollständige DMS-Sicherung.

## 2. Wiederherstellung

Mit `frontend/deploy/restore.sh <archiv.tar.gz.enc>` wird der Backend-Schreibzugriff gestoppt, der Datenbankdump restauriert und danach Backend/Proxy gestartet. S3-Objekte müssen über den Anbieter separat auf einen mit den Metadaten konsistenten Stand wiederhergestellt werden. Nach einem Restore müssen Scanner und S3-Zugriff geprüft werden; nicht wiederhergestellte Objekte können nicht heruntergeladen werden.

## 3. Datenträgerverschlüsselung und Aufbewahrung

Die Verschlüsselung ruhender S3-Objekte und die Aufbewahrung müssen beim Anbieter konfiguriert werden. Das DMS bietet für archivierte Dokumente einen expliziten API-Löschvorgang für alle Dateiobjekte; Metadaten und unveränderliche Auditereignisse bleiben erhalten. Automatische tenant-spezifische Aufbewahrungsregeln sind nicht implementiert.
