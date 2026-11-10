# backend/app/core/config.py
"""
Zentrale Konfiguration für SecurityOps 2.0 (Phase 3)
Verwendet Pydantic Settings für typsichere Umgebungsvariablen.
"""

from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "SecurityOps 2.0 Enterprise Backend"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    
    # Datenbank
    DATABASE_URL: str = "postgresql+asyncpg://secops_admin:SecOps2025Secret!@localhost:5432/securityops2"
    ENABLE_POSTGRES_RLS: bool = True
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 10
    
    # JWT & Kryptografie
    JWT_SECRET_KEY: str = "secops2_enterprise_jwt_super_secret_kdf_2025_prod_key"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Argon2id Parameter (BSI TR-02102-1)
    ARGON2_TIME_COST: int = 3
    ARGON2_MEMORY_COST: int = 65536  # 64 MiB
    ARGON2_PARALLELISM: int = 4
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]
    
    # Uploads & Storage
    STORAGE_LOCAL_DIR: str = "/var/data/securityops_storage"
    MAX_UPLOAD_SIZE_MB: int = 25

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
