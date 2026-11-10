import React from 'react';
import { FileCheck2, CheckCircle2, Shield, Users, BookOpen } from 'lucide-react';
import { useSecurityStore } from '../store';

export const SOPModule: React.FC = () => {
  const { sops, acknowledgeSOP } = useSecurityStore();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <FileCheck2 className="w-6 h-6 text-blue-400" />
          <h1 className="text-xl font-bold text-white">Dienstanweisungen & Qualitätsmanagement (QM)</h1>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Objektbezogene und allgemeine Dienstanweisungen nach DIN 77200 mit digitaler Lesebestätigung.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sops.map((sop) => (
          <div key={sop.id} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-blue-400 font-bold">
                  {sop.sopNumber}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">v{sop.version}</span>
              </div>

              <h3 className="font-bold text-slate-200 text-sm mt-3">{sop.title}</h3>
              <p className="text-xs text-slate-400 mt-1">Kategorie: {sop.category}</p>

              <div className="my-3 p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-300 leading-relaxed max-h-28 overflow-y-auto">
                {sop.content}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-slate-400">Lesebestätigungen:</span>
                <span className="font-semibold text-slate-200">{sop.signedCount} / {sop.totalRequired}</span>
              </div>

              <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mb-3">
                <div
                  className="bg-blue-500 h-full rounded-full"
                  style={{ width: `${(sop.signedCount / sop.totalRequired) * 100}%` }}
                />
              </div>

              <button
                onClick={() => acknowledgeSOP(sop.id)}
                className="w-full py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold transition"
              >
                Gelesen & Verstanden quittieren
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
