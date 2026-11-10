# SECURITYOPS 2.0 – IT-SICHERHEITS- & DATENSCHUTZKONZEPT (PHASE 1)

## 1. Schutzziele nach DIN 77200 & BSI Grundschutz
- **Vertraulichkeit**: Strikte Mandantentrennung via PostgreSQL RLS und JWT Tenant Claims.
- **Integrität**: Kryptografische Verkettung (SHA-256) aller Wachbucheinträge. Nachträgliche Manipulationen sind rechnerisch unmöglich und auditierbar.
- **Verfügbarkeit**: Lokale Offline-Warteschlange schützt vor Ausfällen bei Netztrennung.
- **DSGVO-Konformität**: Personenbezogene Mitarbeiter- und Kundendaten werden getrennt gespeichert und nach Ablauf von Aufbewahrungsfristen (z.B. § 34a GewO Fristen) anonymisiert.

---

## 2. Authentifizierung & Sitzungsverwaltung
- **Passwort-Hashing**: Argon2id (`time_cost=3`, `memory_cost=65536`, `parallelism=4`) mit individuellem Salt.
- **Token-Architektur**: Kurzlaufende JWT Access-Tokens (Gültigkeit: 15 Minuten) kombiniert mit kryptografisch gesicherten Refresh-Tokens in `HttpOnly, Secure, SameSite=Strict` Cookies.
- **Brute-Force Schutz**: Account-Sperrung nach 5 fehlerhaften Login-Versuchen für 15 Minuten via Redis Sliding-Window Rate Limiter.

---

## 3. Rollenbasiertes Berechtigungssystem (RBAC)

| Rolle | Mandanten | Wachbuch | Dienstplan | Personal §34a | QM & SOPs | System-Admin |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Systemadministrator** | Alle | Audit Read | Audit Read | Audit Read | Read | Vollzugriff |
| **Geschäftsführung** | Eigener | Lesen/Export| Lesen/Export| Vollzugriff | Lesen/Freigabe| Tenant Admin |
| **Einsatzleitung (Leitstand)**| Eigener | Vollzugriff | Vollzugriff | Lesen/Prüfen | Lesen/Freigabe| Benutzerverwaltung|
| **Objektleitung** | Eigener (Objekt)| Vollzugriff | Dispo Objekt| Dienstaufsicht| Lesen/Quittieren| Keine |
| **Sicherheitsmitarbeiter** | Eigener (Schicht)| Erfassen | Eigene Schicht| Eigene Nachweise| Quittieren | Keine |

---

## 4. Revisionssichere Audit-Kette im Wachbuch
Jeder Vorfall wird mit dem Hash des unmittelbar vorherigen Eintrags verkettet:
```
Hash_n = SHA256(Record_n + Hash_{n-1} + Timestamp + GuardID + TenantID)
```
Ein Löschen oder Verändern eines Eintrags in der Datenbank bricht die Kette und wird bei internen oder VdS/DIN 77200 Zertifizierungsaudits sofort als Manipulationsversuch gemeldet.
