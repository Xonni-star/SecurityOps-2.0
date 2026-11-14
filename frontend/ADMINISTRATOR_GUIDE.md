# SecurityOps 2.0 - Administratorhandbuch

> **Projektstatus:** In Entwicklung; nicht für Produktion freigegeben. Die folgenden Hinweise beschreiben Funktionen im aktuellen Quellcode/PR-Arbeitsstand, keine erfolgte Produktivabnahme.

## Benutzer und Rollen

Mit `users:read` können berechtigte Personen Benutzer und Auditereignisse des aktiven Mandanten einsehen. `users:manage` erlaubt Benutzeranlage, Profilpflege, Aktivieren/Deaktivieren, Sperren/Entsperren, Rollenzuordnung und das Vorbereiten eines Passwort-Resets. `roles:read` und `roles:manage` kontrollieren den Zugriff auf tenant-eigene Rollen und Berechtigungen. Die API leitet den Tenant ausschließlich aus der authentifizierten Session ab.

Unter **Systemverwaltung → Benutzer & Berechtigungen**:

- Suche nach E-Mail/Name und Filterung nach Status, Rolle und Objekt verwenden.
- Benutzerprofile im Mandanten anlegen oder bearbeiten. Eine Rollenzuordnung ohne Objekt beschränkt sich nicht auf ein einzelnes Objekt; Objektzuordnungen sind ausdrücklich auszuwählen.
- Deaktivieren oder Sperren widerruft aktive Sitzungen des betroffenen Kontos im aktuellen Mandanten. Rollenänderungen widerrufen ebenfalls diese Sitzungen.
- Die verfügbaren Rollen sind tenant-eigene, konfigurierbare Datensätze. Vorlagen haben anfangs keine fachlichen Rechte; Rechte müssen gezielt vergeben werden.
- Site-Grants werden serverseitig ausgewertet. Für Objekte, die nicht Teil der Anfrage sind oder deren Site nicht durch den jeweiligen Handler validiert wird, gewährt ein Site-Grant keinen Zugriff. Bestehende tenantweite Rollen bleiben tenantweit.

Tenant-Administratoren können keine fremden Mandanten verwalten, keine Berechtigungen delegieren, die sie nicht selbst besitzen, und keine administrativen Rechte weitergeben. Das dedizierte Recht `roles:delegate_admin` bzw. das explizite Systemadministrator-Konto ist für administrative Delegation vorgesehen. Das Setzen von `users.is_superadmin` wird nicht über die Tenant-API angeboten.

### Passwort-Reset

Die Reset-Vorbereitung erzeugt einen einmaligen, 30 Minuten gültigen Token, speichert ausschließlich dessen SHA-256-Hash, widerruft Sitzungen und protokolliert die Aktion. Es ist kein E-Mail-Provider angebunden. Der Token muss deshalb über einen sicheren, separaten Kanal manuell zugestellt werden; er wird in der Oberfläche nur einmal angezeigt. Der Reset-Endpunkt erfordert Tenant-ID, Token und ein neues Passwort mit mindestens 12 Zeichen. Die Tenant-ID ist dabei kein Autorisierungsnachweis; gültig ist nur der passende unbenutzte Token.

## Audit

Änderungen an Benutzern, Rollen, Status, Zuordnungen und Passwörtern werden mit Akteur, Mandant, Aktion, Ziel und Zeit protokolliert. Passwörter und Reset-Tokens werden nicht in Auditdetails gespeichert. Die Auditansicht ist über die Benutzer-Detailansicht erreichbar.

## Backup und Wiederherstellung

Die Produktions-Compose-Datei definiert einen Backup-Container, der alle 24 Stunden einen verschlüsselten PostgreSQL-Dump samt DMS-Dateivolume erstellt und Backups nach 30 Tagen entfernt. Das Vorhandensein der Konfiguration beweist keinen erfolgreichen Backup- oder Restore-Lauf. Prüfen Sie Ausgaben/Volumes und führen Sie Wiederherstellungsübungen in einer isolierten Umgebung durch. Das Restore-Skript liegt unter `frontend/deploy/restore.sh`; es stoppt den Backend-Schreibzugriff und spielt Datenbank sowie DMS-Dateien wieder ein.

## Nicht zugesicherte Funktionen

Es gibt keinen Rollenwechsel-Schalter, keine automatische E-Mail-Zustellung von Reset-Tokens, keine bestätigte Hardware-/Browserabnahme und keine Aussage, dass alle Module produktionsreif oder rechtlich konform sind. Der Automatisierungs-/Watchdog-Bereich ist nicht mit der hier beschriebenen Benutzerverwaltung gleichzusetzen.
