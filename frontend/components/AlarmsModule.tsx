import React from 'react';
import { Siren, PhoneCall, ShieldAlert, Flame, Radio } from 'lucide-react';

export const AlarmsModule: React.FC = () => {
  return (
    <div className="space-y-5">
      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Siren className="w-5 h-5 text-rose-400 animate-pulse" />
            <h2 className="text-base font-bold text-white">Alarm- & Notfallmanagement</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
              Eskalationsmatrix VdS 2172
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Echtzeit-Alarmierungspläne, BMA/EMA-Schnittstellen und Notfallkontakte je Objekt.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: BMA Alarmplan */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
            <Flame className="w-4 h-4" />
            <span>Brandmeldeanlage (BMA) Notfallprotokoll</span>
          </div>
          <ol className="list-decimal list-inside text-xs text-slate-300 space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <li>Eintreffen der BMZ-Meldung am Feuerwehrbedienfeld prüfen.</li>
            <li>Meldergruppe und Meldernummer aus dem Feuerwehrlaufkarten-Schrank entnehmen.</li>
            <li>Parallel Feuerwehrleitstelle telefonisch verifizieren (112).</li>
            <li>Evakuierungsalarm über ELA-Anlage für betroffenen Abschnitt auslösen.</li>
            <li>Feuerwehr an der Hauptpforte mit Generalschlüssel (FSD) empfangen.</li>
          </ol>
          <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200">
            <strong>Wichtig:</strong> Vor Ort niemals selbstständig Brandbekämpfung bei unklarem Rauchaustritt durchführen!
          </div>
        </div>

        {/* Card 2: Einbruch & Überfall (EMA) */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <ShieldAlert className="w-4 h-4" />
            <span>Einbruchmeldeanlage (EMA) & Überfallintervention</span>
          </div>
          <ol className="list-decimal list-inside text-xs text-slate-300 space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
            <li>Signal an VdS-anerkannte Notruf- und Serviceleitstelle (NSL) abgleichen.</li>
            <li>Eigensicherung herstellen! Niemals unbedacht gefährdete Zonen betreten.</li>
            <li>Polizei über Notruf 110 mit Stichwort &apos;Alarmverifikation gewerbliches Objekt&apos; anfordern.</li>
            <li>Revierdienst / Interventionsfahrer zur Außenhautabsicherung heranziehen.</li>
            <li>Detaillierten Eintrag im digitalen Wachbuch mit Kennzeichen und Täterbeschreibung vornehmen.</li>
          </ol>
        </div>
      </div>
    </div>
  );
};
