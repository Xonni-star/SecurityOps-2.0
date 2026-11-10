import React from 'react';
import { KeyRound, ArrowRightLeft, ShieldAlert, CheckCircle2, UserCheck } from 'lucide-react';
import { store } from '../services/store';

export const KeysModule: React.FC = () => {
  const keys = store.keys;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Schlüssel- & Zutrittsmedienverwaltung</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-200 font-mono">
              Generalschlüssel
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Lückenlose Dokumentation von Schlüsselausgaben, Rückgaben, Transpondern und Schließrechten.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {keys.map((k) => (
          <div
            key={k.id}
            className={`p-5 rounded-2xl bg-slate-900 border transition-all ${
              k.status === 'Ausgegeben' ? 'border-amber-500/50' : 'border-slate-800'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-xs font-bold text-slate-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                {k.keyNumber}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold ${
                  k.status === 'Im Tresor'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300 animate-pulse'
                }`}
              >
                {k.status}
              </span>
            </div>

            <h3 className="font-bold text-white text-sm mb-1">{k.bundleLabel}</h3>
            <p className="text-xs text-brand-300 mb-3">{k.siteName}</p>

            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-1 mb-3">
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400">Aktueller Inhaber:</span>
                <span className="font-bold text-white">{k.currentHolder || 'Sicherheitstresor'}</span>
              </div>
              {k.issuedAt && (
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>Ausgegeben um:</span>
                  <span>{k.issuedAt}</span>
                </div>
              )}
            </div>

            <div className="mb-4">
              <span className="text-[11px] font-bold text-slate-400 block mb-1">Berechtigte Türen:</span>
              <div className="flex flex-wrap gap-1">
                {k.doorAccess.map((d, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
              {k.status === 'Ausgegeben' ? (
                <button
                  onClick={() => store.updateKeyStatus(k.id, 'Im Tresor')}
                  className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  Rückgabe im Tresor quittieren
                </button>
              ) : (
                <button
                  onClick={() => store.updateKeyStatus(k.id, 'Ausgegeben', 'Timo Kranz (Wachhabender)')}
                  className="w-full py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
                >
                  An Schichtleiter ausgeben
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
