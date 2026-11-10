import React from 'react';
import { Blocks, CheckCircle2, ShieldCheck, Terminal, Layers, ArrowUpRight, Power } from 'lucide-react';
import { store } from '../services/store';

export const ModuleRegistryView: React.FC = () => {
  const modules = store.modules;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Blocks className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">Modulare Systemerweiterbarkeit & Plugin-Registry</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
              Versionierte APIs (/api/v1/*)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Integrierte Fachmodule, Schnittstellenverträge und dynamisch erweiterbare Geschäftslogik ohne Kern-Regression.
          </p>
        </div>
      </div>

      {/* Architecture Principle Box */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs space-y-2">
        <div className="flex items-center gap-2 text-brand-300 font-bold">
          <Layers className="w-4 h-4" />
          <span>Architekturprinzip: Lose Kopplung mit einheitlichem RBAC & Schema-Hooks</span>
        </div>
        <p className="text-slate-300 leading-relaxed">
          Jedes Modul implementiert das <code className="bg-slate-950 px-1 rounded text-emerald-400 font-mono">SecurityOpsModuleDefinition</code> Interface mit unabhängigen Alembic-Migrationen, FastAPI Routern und Event-Hooks (<code className="bg-slate-950 px-1 rounded text-cyan-400 font-mono">on_incident_created</code>, <code className="bg-slate-950 px-1 rounded text-cyan-400 font-mono">on_shift_conflict</code>).
        </p>
      </div>

      {/* Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((mod) => (
          <div
            key={mod.id}
            className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-xs font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {mod.code}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    mod.status === 'Aktiv'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mod.status}
                </span>
              </div>

              <h3 className="font-bold text-white text-sm mb-1">{mod.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-3">{mod.description}</p>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1 font-mono text-[11px]">
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">API Prefix:</span>
                  <span className="text-brand-300">{mod.apiEndpointPrefix}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">Version:</span>
                  <span>v{mod.version}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">Typ:</span>
                  <span>{mod.isCore ? 'Systemkern (Mandatory)' : 'Erweiterung (Pluggable)'}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Autor: {mod.author}</span>
              {!mod.isCore && (
                <button
                  onClick={() => store.toggleModuleStatus(mod.id)}
                  className={`text-xs px-2.5 py-1 rounded font-semibold flex items-center gap-1 ${
                    mod.status === 'Aktiv'
                      ? 'bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900'
                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  <span>{mod.status === 'Aktiv' ? 'Deaktivieren' : 'Aktivieren'}</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
