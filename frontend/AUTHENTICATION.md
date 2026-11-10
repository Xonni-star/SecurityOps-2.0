# SECURITYOPS 2.0 – AUTHENTIFIZIERUNG & SITZUNGSVERWALTUNG (PHASE 3)

## 1. Passwort-Sicherheit mit Argon2id
Als Passwort-Hashing-Algorithmus kommt verbindlich **Argon2id** (gemäß BSI Technische Richtlinie TR-02102-1) zum Einsatz:
- **Speicheraufwand (Memory Cost)**: `m = 65536` KiB (64 MiB)
- **Zeitaufwand (Iterations)**: `t = 3`
- **Parallelität**: `p = 4`
- **Salt-Länge**: 16 Bytes kryptografisch sichere Zufallswerte

---

## 2. Token- und Sitzungsarchitektur
```
[Client Login] 
     │ (E-Mail + Passwort)
     ▼
[Argon2id Verifikation]
     │ OK
     ▼
[JWT Access Token] (15 Min Gültigkeit)
  - claims: { sub, user_id, tenant_id, role, permissions: [...] }
  
[JWT Refresh Token] (7 Tage Gültigkeit)
  - Gespeichert in DB `sessions` mit IP, User-Agent & Device-Fingerprint
  - Token-Rotation bei jedem Refresh (alter Token wird ungültig)
```

---

## 3. Brute-Force & Account-Lockout Schutz
1. **Fehlgeschlagene Versuche**: Werden in `system_users.failed_login_attempts` hochgezählt.
2. **Lockout**: Nach 5 Fehlversuchen wird `locked_until = now() + 15 Minuten` gesetzt.
3. **Sliding-Window Rate Limiting**: Redis blockiert mehr als 10 fehlerhafte Login-Anfragen pro IP und Minute mit HTTP 429 Too Many Requests.
4. **Offline-Resilienz**: Mobile Wach-Geräte cachen autorisierte Krypto-Signaturschlüssel lokal, um Schichtübergaben auch bei 12 Stunden Funkstille kryptografisch signieren zu können.
