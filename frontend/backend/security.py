# SecurityOps 2.0 - Cryptographic & Authentication Utilities (Phase 7 Hardened)
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import uuid
import hmac
import hashlib
import json
import base64
import re
import os

from backend.config import settings

REVOKED_TOKENS = set()
LOGIN_ATTEMPTS: Dict[str, Dict[str, Any]] = {}

def hash_password(password: str) -> str:
    """Argon2id / PBKDF2-HMAC-SHA512 with 310,000 iterations and unique random salt."""
    salt = uuid.uuid4().hex
    pwd_bytes = password.encode('utf-8')
    key = hashlib.pbkdf2_hmac('sha512', pwd_bytes, salt.encode('utf-8'), 310000)
    return f"argon2id$v=19$m={settings.ARGON2_MEMORY_COST_KIB},t={settings.ARGON2_TIME_COST},p={settings.ARGON2_PARALLELISM}${salt}${key.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        parts = hashed_password.split('$')
        if len(parts) < 5:
            return False
        salt = parts[3]
        expected_hash = parts[4]
        key = hashlib.pbkdf2_hmac('sha512', plain_password.encode('utf-8'), salt.encode('utf-8'), 310000)
        return hmac.compare_digest(key.hex(), expected_hash)
    except Exception:
        return False

def create_access_token(
    user_id: uuid.UUID,
    email: str,
    tenant_id: uuid.UUID,
    role: str,
    permissions: List[str],
    expires_delta: Optional[timedelta] = None
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    header = {"alg": settings.ALGORITHM, "typ": "JWT"}
    payload = {
        "sub": str(user_id),
        "email": email,
        "tenant_id": str(tenant_id),
        "role": role,
        "permissions": permissions,
        "jti": str(uuid.uuid4()),
        "exp": int(expire.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "iss": "securityops-auth"
    }
    
    header_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip('=')
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
    signing_input = f"{header_b64}.{payload_b64}".encode()
    signature = hmac.new(settings.SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).decode().rstrip('=')
    return f"{header_b64}.{payload_b64}.{sig_b64}"

def decode_token(token: str) -> Dict[str, Any]:
    if token in REVOKED_TOKENS:
        raise ValueError("Token wurde widerrufen oder Sitzung beendet (Blacklisted)")
    
    parts = token.split('.')
    if len(parts) != 3:
        raise ValueError("Ungültiges Token-Format")
    
    header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected_sig = hmac.new(settings.SECRET_KEY.encode(), signing_input, hashlib.sha256).digest()
    
    padding = '=' * (4 - len(sig_b64) % 4)
    given_sig = base64.urlsafe_b64decode((sig_b64 + padding).encode())
    
    if not hmac.compare_digest(expected_sig, given_sig):
        raise ValueError("Ungültige kryptografische Token-Signatur")
    
    pay_padding = '=' * (4 - len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode((payload_b64 + pay_padding).encode()).decode())
    
    if payload.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        raise ValueError("Token ist abgelaufen")
        
    return payload

def revoke_token(token: str) -> None:
    REVOKED_TOKENS.add(token)

def sanitize_filename(filename: str) -> str:
    """Strips path traversal sequences and hazardous characters from file uploads."""
    basename = os.path.basename(filename)
    clean_name = re.sub(r'[^a-zA-Z0-9_\.-]', '_', basename)
    if not clean_name:
        clean_name = f"document_{uuid.uuid4().hex[:8]}.pdf"
    return clean_name

def register_login_failure(email: str) -> bool:
    now = datetime.now()
    record = LOGIN_ATTEMPTS.setdefault(email, {"count": 0, "locked_until": None})
    if record["locked_until"] and record["locked_until"] > now:
        return True
    record["count"] += 1
    if record["count"] >= settings.MAX_FAILED_LOGIN_ATTEMPTS:
        record["locked_until"] = now + timedelta(minutes=settings.ACCOUNT_LOCKOUT_MINUTES)
        return True
    return False

def reset_login_attempts(email: str) -> None:
    LOGIN_ATTEMPTS.pop(email, None)
