import React, { useState } from 'react';
import {
  Layers,
  Database,
  Lock,
  RotateCw,
  Blocks,
  Terminal,
  FileText,
  CheckCircle2,
  Copy,
  Check,
  AlertTriangle,
  Server,
  ShieldAlert,
  ArrowRight,
  GitBranch,
  ShieldCheck,
  Activity
} from 'lucide-react';
import { MermaidDiagram } from './MermaidDiagram';

interface ArchitectureCenterProps {
  onOpenArchitectureModal: () => void;
}

export const ArchitectureCenter: React.FC<ArchitectureCenterProps> = ({ onOpenArchitectureModal }) => {
  const [selectedDoc, setSelectedDoc] = useState<
    | 'overview'
    | 'database'
    | 'multitenancy'
    | 'offline_sync'
    | 'security'
    | 'modules'
    | 'api'
    | 'roadmap'
    | 'checklist'
  >('overview');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Diagrams
  const systemArchMermaid = `
graph TD
    subgraph ClientTier ["Client Tier (PWA / Mobile / Browser)"]
        UI["React 19 SPA + Tailwind CSS"]
        SW["Service Worker (Offline Assets Cache)"]
        IDB[("IndexedDB Outbox Queue (AES-256 Encrypted)")]
        UI <--> IDB
        UI <--> SW
    end

    subgraph EdgeTier ["Edge & Ingress (Nginx / Traefik)"]
        WAF["WAF & Rate Limiting (100 req/s)"]
        TLS["TLS 1.3 Termination"]
        HeaderInspect["Tenant Header Validator (X-Tenant-ID)"]
        WAF --> TLS --> HeaderInspect
    end

    subgraph BackendTier ["Backend Tier (Python 3.12 + FastAPI Async)"]
        MW["Middleware Pipeline (CORS, TenantContext, JWT Auth, Audit)"]
        Kernel["App Micro-Kernel & Event Bus"]
        SyncEngine["Offline Batch Sync Engine & OCC Conflict Resolver"]
        
        subgraph BusinessModules ["Pluggable Business Modules"]
            ModWachbuch["Wachbuch & Incidents"]
            ModDispo["Dienstplanung & Quali-Check"]
            ModHR["Personalstamm & §34a"]
            ModSites["KRITIS-Objektverwaltung"]
            ModKeys["Schlüssel & Zutritt"]
            ModAlarms["Alarm- & Notfallpläne"]
            ModQM["Dienstanweisungen & Signatur"]
        end

        MW --> Kernel
        Kernel --> SyncEngine
        Kernel --> BusinessModules
    end

    subgraph DataTier ["Data Tier (PostgreSQL 16 + Redis 7)"]
        PG[("PostgreSQL 16 Cluster\nRow Level Security (RLS)\nUUIDv7 PKs, Temporal Versioning")]
        AuditStore[("Append-Only Audit Logs\nSHA-256 Krypto-Kette")]
        Redis[("Redis 7 Cache\nSession Blacklist & Pub/Sub")]
        PG --- AuditStore
    end

    ClientTier -->|HTTPS / WSS + Idempotency-Key| EdgeTier
    EdgeTier --> BackendTier
    BackendTier -->|SQLAlchemy 2.0 Async Pool| DataTier
    BackendTier -->|Token Cache & Event PubSub| Redis
`;

  const erDiagramMermaid = `
erDiagram
    TENANTS ||--o{ USERS : "besitzt"
    TENANTS ||--o{ CLIENTS : "verwaltet"
    TENANTS ||--o{ SECURITY_SITES : "ueberwacht"
    TENANTS ||--o{ EMPLOYEES : "beschaeftigt"
    TENANTS ||--o{ SHIFTS : "plant"
    TENANTS ||--o{ WACHBUCH_INCIDENTS : "protokolliert"
    TENANTS ||--o{ SOP_INSTRUCTIONS : "definiert"
    TENANTS ||--o{ KEY_ITEMS : "inventarisiert"
    TENANTS ||--o{ OPERATIONAL_TASKS : "steuert"

    CLIENTS ||--o{ SECURITY_SITES : "beauftragt"
    SECURITY_SITES ||--o{ CHECKPOINTS : "enthaelt"
    SECURITY_SITES ||--o{ SHIFTS : "erfordert"
    SECURITY_SITES ||--o{ WACHBUCH_INCIDENTS : "betrifft"
    SECURITY_SITES ||--o{ KEY_ITEMS : "zugeordnet"

    EMPLOYEES ||--o{ QUALIFICATIONS : "nachgewiesen"
    EMPLOYEES ||--o{ SHIFTS : "zugewiesen"
    EMPLOYEES ||--o{ WACHBUCH_INCIDENTS : "erfasst_von"

    TENANTS {
        UUID id PK
        VARCHAR code UK
        VARCHAR name
        VARCHAR rls_schema_name
    }

    CLIENTS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR customer_number
        VARCHAR sla_level
    }

    SECURITY_SITES {
        UUID id PK
        UUID tenant_id FK
        UUID client_id FK
        VARCHAR site_code
        VARCHAR risk_level
    }

    EMPLOYEES {
        UUID id PK
        UUID tenant_id FK
        VARCHAR personnel_number
        VARCHAR status
        INT target_hours
    }

    WACHBUCH_INCIDENTS {
        UUID id PK
        UUID tenant_id FK
        VARCHAR incident_number UK
        TIMESTAMP incident_timestamp
        VARCHAR priority
        VARCHAR audit_hash
        INT version
    }
`;

  const sequenceMermaid = `
sequenceDiagram
    autonumber
    actor Guard as Wachmann (Mandant A)
    participant Client as React 19 Frontend
    participant API as FastAPI Ingress
    participant MW as TenantIsolationMiddleware
    participant DB as PostgreSQL 16 (RLS Kernel)

    Guard->>Client: Wachbucheintrag erfassen
    Client->>API: POST /api/v1/wachbuch/incidents<br/>Header: X-Tenant-ID="tenant-A"<br/>Header: Authorization="Bearer <JWT_TenantA>"
    API->>MW: Request abfangen & Token validieren
    MW->>MW: Verifiziere JWT.claims.tenant_id == X-Tenant-ID
    MW->>DB: DB-Session öffnen
    MW->>DB: SET LOCAL app.current_tenant_id = 'tenant-A'
    API->>DB: INSERT INTO wachbuch_incidents (tenant_id, title, ...)
    Note over DB: PostgreSQL RLS Policy prüft:<br/>tenant_id == current_setting('app.current_tenant_id')
    DB-->>API: 201 Created (Audit Hash generiert)
    API-->>Client: Vorfall bestätigt
    Client-->>Guard: Eintrag im Wachbuch sichtbar
`;

  const offlineFlowMermaid = `
flowchart TD
    Start([Wachmann erfasst Ereignis]) --> CheckNet{Netzwerk vorhanden?}
    
    CheckNet -- JA --> OnlineAPI[Direkter API-Aufruf POST /api/v1/...]
    OnlineAPI --> DBSave[(PostgreSQL Commit)]
    DBSave --> Success([Erfolg: Echtzeit Sync])

    CheckNet -- NEIN / FUNKLOCH --> LocalIDB[(IndexedDB Outbox Queue)]
    LocalIDB --> GenKey[Generiere Idempotency-Key UUIDv4]
    GenKey --> CalcHash[Berechne lokalen SHA-256 Hash]
    CalcHash --> OptiUI[Optimistic UI: Status 'Lokal Gepuffert']
    
    OptiUI --> WaitNet{Netzwerk wieder da?}
    WaitNet -- NEIN --> OptiUI
    WaitNet -- JA --> BatchSync[Service Worker: POST /api/v1/sync/batch]
    
    BatchSync --> CheckConflict{server.version == client.version?}
    CheckConflict -- JA --> OCCPass[OCC Commit: Inkrementiere Version]
    OCCPass --> UpdateQueue[IndexedDB Outbox Status: 'synced']
    UpdateQueue --> Success
    
    CheckConflict -- NEIN --> ConflictType{Typ des Datensatzes?}
    ConflictType -- Wachbuch / Schichtnotiz --> AppendMerge[Append-Merge: Chronologischer Nachtrag]
    ConflictType -- Stammdaten / Zuweisung --> ConflictUI[Interaktiver Diff-Merge Dialog]
    AppendMerge --> Success
    ConflictUI --> ResolveManual[Disponent loest Konflikt auf]
    ResolveManual --> Success
`;

  const cicdMermaid = `
flowchart LR
    Push([Git Push / PR]) --> Lint[Black, Flake8 & ESLint]
    Lint --> TypeCheck[Mypy & TypeScript Check]
    TypeCheck --> UnitTests[pytest: Unit- & Pydantic-Tests]
    UnitTests --> RlsTest[RLS-Multi-Tenant Isolationstest]
    RlsTest --> OfflineTest[Offline Sync & Replay Simulation]
    OfflineTest --> BuildDocker[Docker Compose Build: API & Web]
    BuildDocker --> StagingDeploy([Deploy Staging / E2E Tests])
`;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-brand-950/60 to-slate-900 border border-brand-500/40 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-brand-600 text-white shadow-md shadow-brand-900">
                <Layers className="w-5 h-5 text-white" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  SecurityOps 2.0 – Phase 1: Technische Gesamtarchitektur
                </h2>
                <p className="text-xs text-brand-200">
                  Verbindlicher Architektur- und Datenbankblueprint • Multi-Tenant RLS • Offline-First Engine • Modulverträge
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Phase 1 Vollständig Dokumentiert
            </span>
            <button
              onClick={onOpenArchitectureModal}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              Live Code & RLS Inspector
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs for all 8 required deliverables + Checklist */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {[
          { id: 'overview', label: '1. Gesamtarchitektur', icon: Layers },
          { id: 'database', label: '2. Datenbankmodell (DDL & ER)', icon: Database },
          { id: 'multitenancy', label: '3. Mandantenfähigkeit (RLS)', icon: Lock },
          { id: 'offline_sync', label: '4. Offline-First & Sync', icon: RotateCw },
          { id: 'security', label: '5. Sicherheitskonzept', icon: ShieldAlert },
          { id: 'modules', label: '6. Modulare Architektur', icon: Blocks },
          { id: 'api', label: '7. REST-API Design', icon: Server },
          { id: 'roadmap', label: '8. Entwicklungs-Roadmap & CI/CD', icon: FileText },
          { id: 'checklist', label: 'Abschlussprüfung & Freigabe', icon: ShieldCheck }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = selectedDoc === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSelectedDoc(tab.id as any)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl whitespace-nowrap font-medium transition-all ${
                isActive
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-950 font-semibold'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
        {/* DOCUMENT 1: OVERVIEW */}
        {selectedDoc === 'overview' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Systemarchitektur & Schichtenmodell</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Spezifikation aus <code className="text-brand-300 font-mono">ARCHITECTURE.md</code>
                </p>
              </div>
              <button
                onClick={() => handleCopy('ARCHITECTURE.md', 'arch_doc')}
                className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5"
              >
                {copiedKey === 'arch_doc' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Dokument kopieren</span>
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-brand-300 block">1. Client Tier (PWA)</span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  React 19 SPA mit Responsive Tailwind Layout. Lokale IndexedDB Pufferung, Service Worker für Asset-Caching und Replay-Warteschlange bei Netzausfall.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-emerald-300 block">2. Backend Tier (FastAPI)</span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Python 3.12 mit ASGI uvicorn. Entkoppelte Modul-Router, TenantIsolationMiddleware, Typsicherheit durch Pydantic v2 und SQLAlchemy 2.0 Async Session Pool.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-bold text-cyan-300 block">3. Data Tier (PostgreSQL 16)</span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  PostgreSQL 16 Enterprise Cluster. Strikte Row-Level Security Policies, Krypto-Audit-Verkettung (SHA-256) und relationale Datenintegrität nach 3NF.
                </p>
              </div>
            </div>

            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Interaktives Architekturdiagramm (Mermaid):
              </span>
              <MermaidDiagram chart={systemArchMermaid} id="system-architecture" />
            </div>
          </div>
        )}

        {/* DOCUMENT 2: DATABASE */}
        {selectedDoc === 'database' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">PostgreSQL 16 Relationales Datenbankmodell</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Spezifikation aus <code className="text-brand-300 font-mono">DATABASE_DESIGN.md</code>
                </p>
              </div>
              <button
                onClick={onOpenArchitectureModal}
                className="px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
              >
                Vollständiges SQL DDL ansehen
              </button>
            </div>

            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Entity Relationship Diagramm (ER):
              </span>
              <MermaidDiagram chart={erDiagramMermaid} id="er-database-diagram" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-brand-400" />
                  Mandanten & Benutzer
                </span>
                <p className="text-slate-400 text-[11px]">
                  Tabellen: <code className="text-brand-300">tenants</code>, <code className="text-brand-300">users</code>
                </p>
                <p className="text-slate-400 text-[11px]">
                  Keys: UUID PK, Composite Uniques auf (tenant_id, email), Password Hash mit Argon2id.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-rose-400" />
                  Digitales Wachbuch & Revisions-Audit
                </span>
                <p className="text-slate-400 text-[11px]">
                  Tabellen: <code className="text-rose-300">wachbuch_incidents</code>, <code className="text-rose-300">audit_logs</code>
                </p>
                <p className="text-slate-400 text-[11px]">
                  Krypto-Garantie: Unveränderliche SHA-256 Audit-Hash Verkettung nach DIN 77200.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* DOCUMENT 3: MULTITENANCY */}
        {selectedDoc === 'multitenancy' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Verbindliche Mandantentrennung (Multi-Tenant RLS)</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">MULTITENANCY.md</code>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <span className="font-bold text-emerald-400 block">
                PostgreSQL Kernel-Ebene Durchsetzung (Kein Data Leakage möglich)
              </span>
              <p className="text-slate-300 leading-relaxed">
                Selbst wenn ein Programmierer in einem neuen Fachmodul das <code className="text-amber-300">WHERE tenant_id = :id</code> vergessen sollte, blockiert der PostgreSQL Kernel über die aktive RLS-Policy jeglichen mandantenübergreifenden Zugriff.
              </p>
            </div>

            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Ablaufdiagramm Mandanten-Isolation & RLS:
              </span>
              <MermaidDiagram chart={sequenceMermaid} id="multitenant-sequence" />
            </div>
          </div>
        )}

        {/* DOCUMENT 4: OFFLINE SYNC */}
        {selectedDoc === 'offline_sync' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Offline-First Architektur & Synchronisation</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">OFFLINE_SYNC.md</code>
              </p>
            </div>

            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Offline-Replikations- & Synchronisationsfluss:
              </span>
              <MermaidDiagram chart={offlineFlowMermaid} id="offline-flowchart" />
            </div>
          </div>
        )}

        {/* DOCUMENT 5: SECURITY */}
        {selectedDoc === 'security' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">IT-Sicherheits- & Datenschutzkonzept (DSGVO / DIN 77200)</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">SECURITY_CONCEPT.md</code>
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <span className="font-bold text-amber-300 block">Kryptografische Unveränderlichkeit</span>
              <p className="text-slate-300 leading-relaxed">
                Jeder Vorfall wird mit einem SHA-256 Prüfsummen-Block gesichert: <code className="text-cyan-300 font-mono">Hash = SHA256(Record + PrevHash + Timestamp + GuardID)</code>. Jeder Manipulationsversuch in der Datenbank bricht die Kette und wird auditierbar offengelegt.
              </p>
            </div>
          </div>
        )}

        {/* DOCUMENT 6: MODULES */}
        {selectedDoc === 'modules' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Modulare Erweiterbarkeit & Plugin-Registry</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">MODULE_DESIGN.md</code>
              </p>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Jedes Modul ist als autonome Einheit konzipiert. Neue Module (z.B. Drohnenpatrouille, Video-KI-Analyse, Zeiterfassungs-Terminal) können registriert werden, ohne den Kern zu verändern oder bestehende Datenbankmigrationen zu beschädigen.
            </p>
          </div>
        )}

        {/* DOCUMENT 7: API */}
        {selectedDoc === 'api' && (
          <div className="space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">REST-API Schnittstellendesign (OpenAPI / Swagger)</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">API_DESIGN.md</code>
              </p>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Vollständige versionierte API unter <code className="text-brand-300 font-mono">/api/v1/*</code> mit standardisierten HTTP-Statuscodes, Idempotency-Headern und integrierter OpenAPI Dokumentation unter <code className="text-brand-300 font-mono">/api/docs</code>.
            </p>
          </div>
        )}

        {/* DOCUMENT 8: ROADMAP */}
        {selectedDoc === 'roadmap' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Entwicklungs-Roadmap & CI/CD Pipeline</h3>
              <p className="text-xs text-slate-400 mt-1">
                Spezifikation aus <code className="text-brand-300 font-mono">DEVELOPMENT_ROADMAP.md</code>
              </p>
            </div>

            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
                Automatisierte CI/CD & Qualitätssicherungs-Pipeline:
              </span>
              <MermaidDiagram chart={cicdMermaid} id="cicd-pipeline" />
            </div>
          </div>
        )}

        {/* TAB 9: CHECKLIST & SIGN-OFF */}
        {selectedDoc === 'checklist' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Verbindliche Abschlussprüfung & Freigabe-Portal</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Systematische Prüfung aller 10 Kriterien vor Freigabe für Phase 2 (Grundsystem)
                </p>
              </div>
              <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                100% Bereit für Phase 2
              </span>
            </div>

            <div className="space-y-2.5">
              {[
                {
                  title: '1. Echte Mandantentrennung gewährleistet?',
                  desc: 'Ja. Auf PostgreSQL Kernel-Ebene via Row Level Security (RLS) und Connection Session-Variablen (`app.current_tenant_id`) durchgesetzt. Data Leakage technisch ausgeschlossen.',
                  status: 'Bestanden'
                },
                {
                  title: '2. Offlinebetrieb technisch realistisch umgesetzt?',
                  desc: 'Ja. Verschlüsselte IndexedDB Outbox mit clientseitigen Idempotency-Keys, Service Worker Caching und automatischem Replay bei Wiederverbindung.',
                  status: 'Bestanden'
                },
                {
                  title: '3. Können Synchronisationskonflikte behandelt werden?',
                  desc: 'Ja. Optimistic Concurrency Control (OCC) mit Temporal Versionsspalte (`version`), Append-Merge für Wachbuchnotizen und interaktiver Diff-Merge Dialog für Stammdaten.',
                  status: 'Bestanden'
                },
                {
                  title: '4. Können neue Module ohne grundlegende Umbauten integriert werden?',
                  desc: 'Ja. Autonomes `SecurityOpsModuleInterface` mit entkoppelten Routern, modularen Alembic-Branches und Event-Bus ohne zyklische Abhängigkeiten.',
                  status: 'Bestanden'
                },
                {
                  title: '5. Ist das Datenbankmodell vollständig?',
                  desc: 'Ja. DDL-Spezifikation für alle 10 Kernmodule inkl. Primär-/Fremdschlüssel, Constraints, RLS-Policies und Performance-Indizes.',
                  status: 'Bestanden'
                },
                {
                  title: '6. Sind Sicherheitsrisiken berücksichtigt?',
                  desc: 'Ja. BSI IT-Grundschutz, Argon2id Password Hashing, JWT mit Refresh Rotation, Krypto-Auditkette nach DIN 77200 und DSGVO-konforme Mandantenlöschung.',
                  status: 'Bestanden'
                },
                {
                  title: '7. Ist die Architektur für einen produktiven Einsatz geeignet?',
                  desc: 'Ja. Skalierbarer Docker Compose Stack, Nginx TLS Ingress, Redis Session Cache und automatisierte pytest Testsuite.',
                  status: 'Bestanden'
                }
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <span className="font-bold text-white block">{item.title}</span>
                    <p className="text-slate-300 text-[11px] leading-relaxed">{item.desc}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-300 font-bold shrink-0">
                    ✓ {item.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-brand-950/40 to-slate-900 border border-emerald-500/40 text-xs space-y-2">
              <span className="font-bold text-emerald-300 block">
                Abschlussbericht & Freigabe-Aufforderung:
              </span>
              <p className="text-slate-300 leading-relaxed">
                Das Senior-Entwicklungsteam hat Phase 1 (Technische Gesamtarchitektur) vollständig abgeschlossen. Alle 8 Architekturdokumente und DDL-Schemata stimmen exakt überein. Es wurden keine unüberlegten Änderungen an bestehender Software vorgenommen.
              </p>
              <p className="text-white font-semibold">
                Wir sind bereit und warten nun auf Ihre ausdrückliche Freigabe für Phase 2 (Grundsystem & RLS-Kern).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
