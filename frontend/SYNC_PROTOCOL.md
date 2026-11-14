# SecurityOps 2.0 - Phase 6: Synchronisationsprotokoll

## 1. Push-Protokoll (`POST /api/v1/sync/push`)
- **Idempotenz**: Jede Mutation besitzt eine `client_uuid`. Mehrfaches Senden derselben Mutation erzeugt serverseitig keine Duplikate.
- **Geräteprüfung**: Das Gerät wird anhand seines Fingerprints validiert. Ein widerrufenes Gerät (`DeviceStatus.REVOKED`) wird mit HTTP 403 abgewiesen.
- **Mandantensicherheit**: Der Mandantenkontext wird strikt aus der authentifizierten Sitzung ermittelt; Mutation-Payloads können keinen Mandanten auswählen.
- **Objektberechtigungen**: Tenant-Grants gelten tenantweit. Site-Grants werden für jede Mutation anhand des gespeicherten Site-Bezugs der Zielentität geprüft; bei Standortwechseln müssen sowohl Ausgangs- als auch Zielobjekt freigegeben sein. CREATE-Mutationen müssen auf ein freigegebenes Objekt verweisen. Die Prüfung umfasst auch Konfliktauflösungen. Nicht site-gebundene Sync-Entitäten akzeptieren keinen Site-Grant.

## 2. Pull-Protokoll (`POST /api/v1/sync/pull`)
- Client sendet `since_sequence`.
- Server liefert alle Änderungen seit dieser Sequenznummer, strikt isoliert durch `tenant_id` und PostgreSQL Row Level Security.
