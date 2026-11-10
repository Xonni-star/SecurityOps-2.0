# SecurityOps 2.0 - Phase 13: Rollen- & Berechtigungs-Prüfbericht (RBAC)

## 1. Getestete Rollenhierarchie & Berechtigungsmatrix

| Rolle | Wachbuch | Dienstplan | Kunden / Verträge | Personal (HR) | QM (SOP) | Schlüssel | Audit & Admin |
|---|---|---|---|---|---|---|---|
| **Systemadministrator** | Voll (CRUD) | Voll (CRUD) | Voll (CRUD) | Voll (CRUD) | Voll (CRUD) | Voll (CRUD) | Root / Systemweit |
| **Geschäftsführung** | Lesen + Export | Freigabe | Voll (CRUD) | Lesen + Berichte | Freigabe | Lesen | Controlling / RLS |
| **Einsatzleitung** | Voll (CRUD) | Disposition | Objektsicht | Einsatzfähigkeit | Erstellung | Voll (CRUD) | Mandanten-Audit |
| **Objektleitung** | Objektbezogen | Soll/Ist Sicht | Eigenes Objekt | Kein Zugriff | Quittierungsstatus | Depotausgabe | Kein Zugriff |
| **Personalverwaltung**| Kein Zugriff | Urlaub/Krankheit | Kein Zugriff | Voll (BWR/§ 34a) | Kein Zugriff | Kein Zugriff | Kein Zugriff |
| **Qualitätsmanagement**| Kein Zugriff | Kein Zugriff | Kein Zugriff | Unterweisungen | Voll (CRUD) | Kein Zugriff | Kein Zugriff |
| **Wachdienst** | Erfassung | Mein Dienst | Einsatzort | Eigenes Profil | Lesebestätigung | Empfang/Rückgabe| Kein Zugriff |
| **Auditor** | Revisionssicht | Soll/Ist Sicht | Vertragssicht | BWR-Status | QM-Historie | Bestandssicht | Audit-Protokoll |

---

## 2. Serverseitige Durchsetzung
- Alle REST-Endpunkte sind mit FastAPI-Dependencies (`require_permission`) geschützt.
- Clientseitige Manipulationen von Rollen oder IDs im Token werden durch kryptografische JWT-Signaturprüfung (`decode_token`) mit HTTP 401/403 abgewehrt.
- Bloßes Ausblenden von UI-Elementen gilt im System **nicht** als Sicherheitsgrenze.
