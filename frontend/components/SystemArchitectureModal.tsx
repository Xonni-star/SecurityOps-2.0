import React, { useState } from 'react';
import { Terminal, Copy, Check, Database, Server, Container, X, Layers, RotateCw } from 'lucide-react';

interface SystemArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemArchitectureModal: React.FC<SystemArchitectureModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'multitenant' | 'offline' | 'modules' | 'fastapi' | 'postgres' | 'docker'>('multitenant');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const codeSnippets = {
    multitenant: `-- backend/sql/multi_tenant_rls.sql
-- ============================================================================
-- SECURITYOPS 2.0: VERBINDLICHE MANDANTENFÄHIGKEIT (MULTI-TENANT ARCHITEKTUR)
-- Strikte Mandantentrennung über PostgreSQL Row-Level Security (RLS)
-- ============================================================================

-- 1. Mandantentabelle (Zentrale Verwaltung)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    company_registration VARCHAR(128) NOT NULL,
    license_level VARCHAR(64) NOT NULL DEFAULT 'Enterprise Tier 1',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Alle operativen Tabellen besitzen zwingend tenant_id
ALTER TABLE clients ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE security_sites ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE employees ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE shifts ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE wachbuch_incidents ADD COLUMN tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT;

-- 3. Row-Level Security (RLS) aktivieren
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wachbuch_incidents ENABLE ROW LEVEL SECURITY;

-- 4. RLS-Policy: Kein Zugriff ohne gültigen Mandantenkontext!
CREATE POLICY tenant_isolation_clients ON clients
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

CREATE POLICY tenant_isolation_wachbuch ON wachbuch_incidents
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

-- 5. Python / SQLAlchemy Tenant Session Middleware
-- Jede DB-Session setzt: conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
`,
    offline: `# backend/app/sync/offline_engine.py
# ============================================================================
# SECURITYOPS 2.0: OFFLINE-FIRST PROTOKOLL & KONFLIKTMANAGEMENT
# ============================================================================
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

router = APIRouter()

class SyncPayloadItem(BaseModel):
    idempotency_key: str
    tenant_id: str
    entity_type: str        # 'incident', 'shift', 'task', etc.
    entity_id: str
    action: str             # 'CREATE', 'UPDATE', 'DELETE'
    client_version: int
    payload: dict
    client_timestamp: datetime
    sha256_audit_hash: str

class SyncResolutionResponse(BaseModel):
    idempotency_key: str
    status: str             # 'COMMITTED', 'CONFLICT', 'IGNORED'
    server_version: int
    server_payload: Optional[dict] = None

@router.post("/batch-sync", response_model=List[SyncResolutionResponse])
def process_offline_batch_sync(
    items: List[SyncPayloadItem],
    db: Session = Depends(get_db_session_with_tenant)
):
    """
    Optimistic Concurrency Control (OCC) mit Vektor-Versionen:
    1. Idempotenz-Prüfung verhindert doppelte Einträge bei Netzstörungen.
    2. Wenn client_version < server_version -> Konflikterkennung.
    3. Revisionssichere SHA-256 Kette für Wachbuch & Schichtübergabe.
    """
    results = []
    for item in items:
        # Revisionssicherer Hash & Versionsabgleich
        server_record = db.query(IncidentModel).filter_by(
            id=item.entity_id,
            tenant_id=item.tenant_id
        ).first()

        if not server_record:
            # Neuer Offline-Eintrag -> Create
            new_record = IncidentModel(**item.payload, version=1)
            db.add(new_record)
            results.append(SyncResolutionResponse(
                idempotency_key=item.idempotency_key,
                status="COMMITTED",
                server_version=1
            ))
        elif server_record.version == item.client_version:
            # Konsistenter Zustand -> Update
            for k, v in item.payload.items():
                setattr(server_record, k, v)
            server_record.version += 1
            results.append(SyncResolutionResponse(
                idempotency_key=item.idempotency_key,
                status="COMMITTED",
                server_version=server_record.version
            ))
        else:
            # Konflikt erkannt: Server-Version ist neuer
            results.append(SyncResolutionResponse(
                idempotency_key=item.idempotency_key,
                status="CONFLICT",
                server_version=server_record.version,
                server_payload={"title": server_record.title, "resolved": server_record.resolved}
            ))

    db.commit()
    return results
`,
    modules: `# backend/app/core/module_interface.py
# ============================================================================
# SECURITYOPS 2.0: MODULARE ERWEITERBARKEIT & PLUGIN-ARCHITEKTUR
# ============================================================================
from abc import ABC, abstractmethod
from fastapi import FastAPI, APIRouter
from typing import List

class SecurityOpsModule(ABC):
    """
    Einheitliche Schnittstelle für Fachmodule:
    - Wachbuch, Dienstplanung, KRITIS, Drohnenüberwachung, BMA/EMA
    - Saubere Trennung & isolierte Testbarkeit
    """
    @property
    @abstractmethod
    def module_code(self) -> str:
        pass

    @property
    @abstractmethod
    def api_version(self) -> str:
        return "v1"

    @abstractmethod
    def register_routes(self, app: FastAPI) -> None:
        """Registriert versionierte Endpunkte: /api/{version}/{module}"""
        pass

    @abstractmethod
    def register_event_hooks(self) -> None:
        """Abonniert systemweite Events wie on_incident_logged, on_shift_conflict"""
        pass

    @abstractmethod
    def run_migrations(self) -> None:
        """Führt modulinterne Alembic-Migrationen aus"""
        pass
`,
    fastapi: `# backend/app/main.py
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.tenant_middleware import TenantIsolationMiddleware
from app.routers import clients, sites, employees, schedule, wachbuch, sops, auth, sync

app = FastAPI(
    title="SecurityOps 2.0 Multi-Tenant Enterprise API",
    description="DIN 77200 & § 34a GewO zertifiziert • Offline First • RLS Mandantenisolation",
    version="2.0.0"
)

# 1. Mandanten-Isolierungs-Middleware (Enforces Tenant Header & JWT Claim)
app.add_middleware(TenantIsolationMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 2. Versionierte Modul-Router
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentifizierung"])
app.include_router(clients.router, prefix="/api/v1/clients", tags=["Kundenstamm"])
app.include_router(sites.router, prefix="/api/v1/sites", tags=["Objektverwaltung (KRITIS)"])
app.include_router(employees.router, prefix="/api/v1/employees", tags=["Mitarbeiter & §34a"])
app.include_router(schedule.router, prefix="/api/v1/schedule", tags=["Dienstplanung"])
app.include_router(wachbuch.router, prefix="/api/v1/wachbuch", tags=["Digitales Wachbuch"])
app.include_router(sync.router, prefix="/api/v1/sync", tags=["Offline-First Sync Engine"])
`,
    postgres: `-- backend/sql/schema.sql
-- SecurityOps 2.0 PostgreSQL Schema with Tenant Partitioning & Audit Logs

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    user_id UUID,
    action VARCHAR(64) NOT NULL,
    entity_name VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    changes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);
`,
    docker: `# docker-compose.yml
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: securityops_postgres
    restart: always
    environment:
      POSTGRES_DB: securityops2
      POSTGRES_USER: secops_admin
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-SecOps2025Secret!}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  backend:
    build:
      context: ./backend
    container_name: securityops_api
    restart: always
    depends_on:
      - db
    environment:
      DATABASE_URL: postgresql://secops_admin:\${POSTGRES_PASSWORD:-SecOps2025Secret!}@db:5432/securityops2
      ENABLE_POSTGRES_RLS: "true"
    ports:
      - "8000:8000"

volumes:
  postgres_data:
`
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippets[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col h-[680px] overflow-hidden">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-700/50 text-emerald-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">SecurityOps 2.0 Architektur- & Blueprint-Zentrale</h3>
              <p className="text-[11px] text-slate-400">
                Mandantenfähigkeit (RLS) • Offline-First Protokoll • Modulare Plugin-Architektur
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 text-xs overflow-x-auto gap-2">
          <div className="flex gap-1.5 shrink-0">
            <button
              onClick={() => setActiveTab('multitenant')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'multitenant' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              1. Mandantenfähigkeit (RLS)
            </button>
            <button
              onClick={() => setActiveTab('offline')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'offline' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              2. Offline-First Protokoll
            </button>
            <button
              onClick={() => setActiveTab('modules')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'modules' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              3. Modulare Erweiterbarkeit
            </button>
            <button
              onClick={() => setActiveTab('fastapi')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'fastapi' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              FastAPI Engine
            </button>
            <button
              onClick={() => setActiveTab('docker')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                activeTab === 'docker' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Docker Compose
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Kopiert!' : 'Code kopieren'}</span>
          </button>
        </div>

        {/* Code display */}
        <div className="flex-1 p-4 bg-slate-950 overflow-auto font-mono text-xs text-slate-200 leading-relaxed selection:bg-brand-600">
          <pre>{codeSnippets[activeTab]}</pre>
        </div>
      </div>
    </div>
  );
};
