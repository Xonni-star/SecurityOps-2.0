import React from 'react';
import { Siren, Phone, ShieldAlert, Flame, Radio, Clock, CheckCircle } from 'lucide-react';
import { useSecurityStore } from '../store';

export const AlarmsModule: React.FC = () => {
  const { emergencyPlans, sites, resolveAlarm } = useSecurityStore();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Siren className="w-6 h-6 text-rose-500 animate-pulse" />
            <h1 className="text-xl font-bold text-white">Alarm- & Notfallmanagement</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Reaktionsschemata für BMA, EMA, Bombendrohungen und medizinische Notfälle mit Notfall-Eskalationsketten.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {emergencyPlans.map((plan) => (
          <div key={plan.id} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  {plan.scenario}
                </span>
                <h3 className="text-base font-bold text-white mt-2">{plan.siteName}</h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">Letzte Übung: {plan.lastDrillDate}</span>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Verbindliche Maßnahmenkette:
              </h4>
              <div className="space-y-1.5">
                {plan.chainOfAction.map((step, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 text-xs text-slate-200 font-medium">
                    {step}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                Eskalationskontakte:
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {plan.contacts.map((c, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px]">{c.role}</span>
                      <span className="font-semibold text-slate-200">{c.name}</span>
                    </div>
                    <a
                      href={`tel:${c.phone}`}
                      className="p-2 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/40"
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
