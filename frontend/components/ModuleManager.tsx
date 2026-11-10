import React from 'react';
import {
  Sliders,
  CheckCircle2,
  Package,
  Layers,
  Lock,
  X,
  Code2,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';
import { useSecurityStore } from '../store';

interface ModuleManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModuleManager: React.FC<ModuleManagerProps> = ({ isOpen, onClose }) => {
  const { modules, toggleModule, getCurrentTenant } = useSecurityStore();
  const tenant = getCurrentTenant();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0b1329] border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-[#0f172a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                Modulare System-Erweiterungen (Plugin Registry)
              </h3>
              <p className="text-[11px] text-slate-400">
                Mandant: <strong className="text-slate-200">{tenant.name}</strong> • Entkoppelte Micro-Services
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modules List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
          <p className="text-slate-400 mb-2">
            Alle Fachmodule sind über standardisierte Lifecycle-Schnittstellen entkoppelt. Das Aktivieren oder Deaktivieren erfolgt ohne Beeinträchtigung anderer Systemteile.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {modules.map((mod) => (
              <div
                key={mod.id}
                className={`p-4 rounded-xl border flex flex-col justify-between transition ${
                  mod.enabled
                    ? 'bg-slate-900/90 border-slate-700'
                    : 'bg-slate-950/60 border-slate-800/80 opacity-75'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-200 text-sm">{mod.name}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
                          v{mod.version}
                        </span>
                      </div>
                      <span className="text-[10px] text-blue-400 font-medium">{mod.category}</span>
                    </div>

                    {mod.isCore ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Core
                      </span>
                    ) : (
                      <button
                        onClick={() => toggleModule(mod.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                          mod.enabled
                            ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                            : 'bg-blue-600 text-white hover:bg-blue-500'
                        }`}
                      >
                        {mod.enabled ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Abhängigkeiten: {mod.dependencies.length > 0 ? mod.dependencies.join(', ') : 'Keine'}</span>
                  <span className={mod.enabled ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                    {mod.enabled ? '● Aktiv' : '○ Inaktiv'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-[#0a0f1d] flex items-center justify-between text-xs text-slate-400">
          <span>Plugin Interface: <code>ISecurityModuleRegistry (OpenAPI 3.1)</code></span>
          <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-200">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
