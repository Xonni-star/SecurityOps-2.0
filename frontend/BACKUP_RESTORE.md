# SecurityOps 2.0 - Backup- und Wiederherstellungskonzept

## 1. Vollständiges Backup

Der Produktionsdienst erstellt täglich ein Archiv mit PostgreSQL-Dump und dem privaten Docker-Volume `secops_documents`. Das gesamte Archiv wird mit AES-256-CBC/PBKDF2 verschlüsselt, im Volume `secops_backups` gespeichert und nach 30 Tagen gelöscht. Der Dateiinhalt ist unveränderlich; Metadaten und Audit werden gemeinsam mit dem Dump gesichert.

Ein isolierter Datenbankdump allein reicht für das DMS nicht aus: Er enthält keine Datei-Blobs. Manuelle Dumps sind daher nur Datenbank-Sicherungen und müssen zusammen mit einem konsistenten Export von `secops_documents` aufbewahrt werden.

## 2. Wiederherstellung

Mit `frontend/deploy/restore.sh <archiv.tar.gz.enc>` wird der Backend-Schreibzugriff gestoppt, das Datenbankarchiv restauriert, das DMS-Dateivolume zurückgespielt und danach Backend/Proxy gestartet. Restore muss Datenbank und Blobs aus demselben Backup verwenden; andernfalls können Metadaten auf nicht vorhandene Dateien zeigen. Ältere Archive ohne `documents/` enthalten keine DMS-Dateien und werden entsprechend gewarnt.

## 3. Datenträgerverschlüsselung und Aufbewahrung

Das Docker-Volume ist nicht selbst verschlüsselt. Produktion muss zusätzlich verschlüsselte Hostdatenträger bzw. verschlüsselte Volume-Speicherung verwenden und Dateibackups wie Datenbankbackups gemäß der organisationsweiten Aufbewahrungsfrist löschen. Das DMS implementiert derzeit keine automatische tenant-spezifische Aufbewahrungs- oder physische Löschrichtlinie; archivierte Dokumente und frühere Versionen bleiben absichtlich erhalten.
