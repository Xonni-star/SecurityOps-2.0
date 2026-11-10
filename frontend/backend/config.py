# SecurityOps 2.0 - Core Configuration Settings
import os
from typing import List
from pydantic import BaseModel, Field

class Settings(BaseModel):
    PROJECT_NAME: str = "SecurityOps 2.0 Enterprise Backend"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Environment & Host
    ENV: str = os.getenv("ENV", "production")
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "https://securityops.de",
        "https://*.securityops.de"
    ]
    
    # Database (PostgreSQL 16+ Async)
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://secops_admin:SecOpsVault2025Secure@localhost:5432/securityops_v2"
    )
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    
    # Authentication & Cryptography (Argon2id + JWT)
    SECRET_KEY: str = os.getenv("SECRET_KEY", "SEC-OPS-2025-ENTERPRISE-ARGON2-SUPER-SECURE-KEY-VAULT")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8 hours operational shift
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30       # Long-term offline devices
    ARGON2_TIME_COST: int = 3
    ARGON2_MEMORY_COST_KIB: int = 65536      # 64 MiB
    ARGON2_PARALLELISM: int = 4
    
    # Rate Limiting & Brute Force Protection
    RATE_LIMIT_PER_MINUTE: int = 120
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 15
    
    # DIN 77200 & Document Storage Limits
    MAX_FILE_UPLOAD_BYTES: int = 15 * 1024 * 1024  # 15 MB
    ALLOWED_UPLOAD_EXTENSIONS: List[str] = [".pdf", ".png", ".jpg", ".jpeg", ".docx"]
    STORAGE_ROOT: str = os.getenv("STORAGE_ROOT", "/var/lib/securityops/storage")

settings = Settings()
