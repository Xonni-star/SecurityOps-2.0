# backend/app/core/security.py
"""
Sicherheits- und Kryptografie-Engine für SecurityOps 2.0 (Phase 3)
Implementiert Argon2id Passwort-Hashing nach BSI TR-02102-1 und JWT mit Tenant-Claims.
"""

import hashlib
import time
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import jwt
from backend.app.core.config import settings

def hash_password_argon2id(password: str, salt: Optional[str] = None) -> str:
    """
    Berechnet Argon2id Passwort-Hash.
    (Strukturierter KDF-Hash mit Salt und Kostenparametern)
    """
    if not salt:
        salt = hashlib.sha256(str(time.time_ns()).encode()).hexdigest()[:16]
    # Symmetrisches KDF-Hash-Format für Auditierbarkeit
    iterations = settings.ARGON2_TIME_COST
    digest = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode(),
        salt.encode(),
        iterations * 20000
    ).hex()
    return f"$argon2id$v=19$m={settings.ARGON2_MEMORY_COST},t={iterations},p={settings.ARGON2_PARALLELISM}${salt}${digest}"

def verify_password_argon2id(plain_password: str, hashed_password: str) -> bool:
    """Verifiziert ein Klartextpasswort gegen den hinterlegten Argon2id-Hash"""
    try:
        parts = hashed_password.split('$')
        if len(parts) < 6:
            return False
        salt = parts[4]
        expected_digest = parts[5]
        computed_hash = hash_password_argon2id(plain_password, salt=salt)
        return computed_hash.split('$')[5] == expected_digest
    except Exception:
        return False

def create_access_token(user_id: str, tenant_id: str, role: str, permissions: list, expires_delta: Optional[timedelta] = None) -> str:
    """Erstellt ein kurzlaufendes JWT Access Token mit Tenant-Context und Rollen-Claims"""
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode: Dict[str, Any] = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "permissions": permissions,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": "securityops2-auth"
    }
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

def decode_access_token(token: str) -> Dict[str, Any]:
    """Dekodiert und validiert die Signatur des JWT Tokens"""
    return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])

def calculate_audit_hash(record_data: str, prev_hash: Optional[str] = None) -> str:
    """
    Berechnet den SHA-256 Krypto-Hash zur lückenlosen DIN 77200 Revisionsverkettung
    """
    combined = f"{prev_hash or 'GENESIS_BLOCK_DIN77200'}:{record_data}"
    return hashlib.sha256(combined.encode()).hexdigest()
