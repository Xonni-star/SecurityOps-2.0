# SECURITYOPS 2.0 – OFFLINE-SYNCHRONISATIONS-BACKEND (PHASE 3)

## 1. Idempotentes Batch-Sync Protokoll

```
Client (Handheld/Browser)                     Backend (/api/v1/sync/batch)
        │                                                  │
        │── POST /api/v1/sync/batch ──────────────────────>│
        │   Body: {                                        │ 1. Prüfe Idempotency-Keys
        │     transactions: [                              │ 2. Starte DB-Transaktion
        │       { idempotency_key: "uuid1", ... },         │ 3. Verifiziere Mandantenkontext
        │       { idempotency_key: "uuid2", ... }          │
        │     ]                                            │
        │   }                                              │
        │                                                  │
        │<─ 200 OK ────────────────────────────────────────│ 4. Erzeuge SHA-256 Hashes
        │   Body: {                                        │ 5. Melde COMMITTED / CONFLICT
        │     committed: ["uuid1"],                        │
        │     conflicts: [                                 │
        │       { key: "uuid2", server_version: 3 }        │
        │     ]                                            │
        │   }                                              │
```

---

## 2. Revisionssichere Append-Merge Strategie für Wachbücher
Bei Vorfällen und Wachbucheinträgen wird **niemals** ein Datensatz stillschweigend überschrieben (kein unkritisches Last-Write-Wins):
- Wenn zwei Wachmänner offline denselben Vorfall ergänzen, werden beide Texte chronologisch als Nachtrag verkettet:
  `[Nachtrag Schichtleiter A]: ... \n[Nachtrag Schichtleiter B]: ...`
- Der Krypto-Hash wird über den zusammengeführten Text neu berechnet, sodass die Revisionssicherheit nach DIN 77200 gewahrt bleibt.
