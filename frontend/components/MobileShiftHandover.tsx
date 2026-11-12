import React, { useState } from 'react';
import {
  FileCheck2,
  Key,
  ShieldAlert,
  CheckCircle2,
  Clock,
  ArrowRight,
  Send,
  UserCheck
} from 'lucide-react';
import { useSecurityStore } from '../store';

export const MobileShiftHandover: React.FC = () => {
  const {
    getTenantSites,
    getTenantEmployees,
    getTenantGuardBook,
    getTenantKeys,
    submitShiftHandover,
    currentUserId,
    currentUserName,
    isOnline
  } = useSecurityStore();

  const sites = getTenantSites();
  const employees = getTenantEmployees();
  const guardBook = getTenantGuardBook();
  const keys = getTenantKeys();
  const activeSite = sites[0];

  const [relievingGuardId, setRelievingGuardId] = useState(employees[1]?.id || employees[0]?.id || '');
  const [keysChecked, setKeysChecked] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);

  const openIncidents = guardBook.filter((g) => !g.resolved);
  const issuedKeys = keys.filter((k) => k.status === 'Ausgegeben');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const relievingGuard = employees.find((e) => e.id === relievingGuardId);

    try {
    await submitShiftHandover({
      siteId: activeSite.id,
      siteName: activeSite.name,
      relievedGuardId: currentUserId,
      relievedGuardName: currentUserName,
      relievingGuardId: relievingGuardId,
      relievingGuardName: relievingGuard ? `${relievingGuard.firstName} ${relievingGuard.lastName}` : 'Ablösekraft',
      keyRegisterChecked: keysChecked,
      openIncidentsCount: openIncidents.length,
      remarks: remarks || 'Schicht ordnungsgemäß übergeben.',
      acknowledgedByRelievingGuard: true
    });

    setIsSubmitted(true);
    setTimeout(() => setIsSubmitted(false), 4000);
    } catch {
      alert('Schichtübergabe konnte nicht sicher lokal gespeichert werden. Bitte erneut versuchen.');
    }
  };

  return (
    <div className="space-y-4 pb-20 text-xs">
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800">
        <h2 className="text-sm font-bold text-white">Digitale Schichtübergabe (Wachwechsel)</h2>
        <p className="text-slate-400 text-[11px] mt-0.5">
          Protokollierung offener Vorfälle und Schlüsselbestände für {activeSite?.name}.
        </p>
      </div>

      {isSubmitted && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{isOnline ? 'Schichtübergabe lokal erfasst. Serverbestätigung steht noch aus.' : 'Schichtübergabe offline lokal erfasst. Synchronisierung steht aus.'}</span>
        </div>
      )}

      {/* Checklist Overview */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 text-[10px] block">Offene Vorkommnisse:</span>
          <span className={`text-base font-bold mt-1 block ${openIncidents.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {openIncidents.length} Ereignisse
          </span>
          <span className="text-[10px] text-slate-500">Werden automatisch übergeben</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 text-[10px] block">Schlüssel im Umlauf:</span>
          <span className="text-base font-bold text-slate-100 mt-1 block">
            {issuedKeys.length} Schlüssel
          </span>
          <span className="text-[10px] text-slate-500">Bestand prüfen</span>
        </div>
      </div>

      {/* Handover Form */}
      <form onSubmit={handleSubmit} className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3.5">
        <div>
          <label className="block text-slate-400 mb-1 font-medium">Ablösende Sicherheitskraft *</label>
          <select
            value={relievingGuardId}
            onChange={(e) => setRelievingGuardId(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200"
            required
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.role})</option>
            ))}
          </select>
        </div>

        <label className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between cursor-pointer">
          <div>
            <div className="font-semibold text-slate-200">Schlüsseldepot & Transponder geprüft</div>
            <div className="text-[10px] text-slate-400">Vollständigkeit der Pfortenschlüssel bestätigt</div>
          </div>
          <input
            type="checkbox"
            checked={keysChecked}
            onChange={(e) => setKeysChecked(e.target.checked)}
            className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
          />
        </label>

        <div>
          <label className="block text-slate-400 mb-1 font-medium">Besondere Vorkommnisse / Bemerkungen</label>
          <textarea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="z. B. BMA im Normalzustand, LKW-Spedition erwartet Nachlieferung um 19:30 Uhr..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200"
          />
        </div>

        <button
          type="submit"
          className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow flex items-center justify-center gap-1.5"
        >
          <UserCheck className="w-4 h-4" />
          <span>Übergabe digital quittieren</span>
        </button>
      </form>
    </div>
  );
};
