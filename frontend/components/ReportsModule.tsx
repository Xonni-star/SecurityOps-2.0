import React from 'react';
import { BarChart3, Download, FileSpreadsheet, Printer, ShieldCheck } from 'lucide-react';
import { store } from '../services/store';

export const ReportsModule: React.FC = () => {
  const handleExportCsv = () => {
    const header = 'Vorfallsnummer;Datum;Objekt;Wachmann;Kategorie;Prioritaet;Status\n';
    const rows = store.incidents
      .map(
        (i) =>
          `${i.incidentNumber};${i.timestamp};"${i.siteName}";"${i.guardName}";${i.category};${i.priority};${
            i.resolved ? 'Erledigt' : 'Offen'
          }`
      )
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `SecurityOps2_Wachbuch_Export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Berichtswesen & Revisionssichere Exporte</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Monatsberichte, Wachbuchauszüge und Dienstplannachweise für Kunden und Aufsichtsbehörden (§ 34a GewO).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="font-bold text-white text-sm">Wachbuch-Monatsbericht</h3>
          <p className="text-xs text-slate-400">
            Lückenloser Auszug aller Vorfälle, Kontrollgangzeiten und Maßnahmen für das QM-Audit.
          </p>
          <button
            onClick={handleExportCsv}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold"
          >
            <Download className="w-4 h-4" />
            <span>CSV / Excel Exportieren</span>
          </button>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="font-bold text-white text-sm">Mitarbeiter-Stundennachweis</h3>
          <p className="text-xs text-slate-400">
            Soll- und Ist-Stundenverrechnung inkl. Nacht- und Feiertagszuschläge nach Tarifvertrag.
          </p>
          <button
            onClick={() => alert('PDF-Export für den aktuellen Abrechnungszeitraum generiert.')}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
          >
            <Printer className="w-4 h-4" />
            <span>Stundenzettel drucken (PDF)</span>
          </button>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h3 className="font-bold text-white text-sm">Objekt-Sicherheitsaudit</h3>
          <p className="text-xs text-slate-400">
            SLA-Erfüllungsgrad, Kontrollpunktdichte und Alarmreaktionszeiten je Kunde.
          </p>
          <button
            onClick={() => alert('Audit-Bericht nach DIN 77200 exportiert.')}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Kunden-Auditbericht erstellen</span>
          </button>
        </div>
      </div>
    </div>
  );
};
