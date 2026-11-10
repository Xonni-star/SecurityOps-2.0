import React, { useState } from 'react';
import {
  CalendarDays,
  AlertCircle,
  Plus,
  Clock,
  UserCheck,
  ShieldCheck,
  CheckCircle,
  AlertTriangle
} from 'lucide-react';
import { store } from '../services/store';
import { Shift } from '../types';

export const ScheduleModule: React.FC = () => {
  const [selectedSiteFilter, setSelectedSiteFilter] = useState<string>('Alle');
  const [showAddShiftModal, setShowAddShiftModal] = useState<boolean>(false);

  // New shift form state
  const [date, setDate] = useState('2025-05-13');
  const [shiftType, setShiftType] = useState<Shift['shiftType']>('Frühschicht (06:00 - 14:00)');
  const [siteId, setSiteId] = useState(store.sites[0]?.id || '');
  const [requiredQualification, setRequiredQualification] = useState('Sachkundeprüfung § 34a');

  const shifts = store.shifts.filter((s) => {
    return selectedSiteFilter === 'Alle' || s.siteId === selectedSiteFilter;
  });

  const handleCreateShift = (e: React.FormEvent) => {
    e.preventDefault();
    const site = store.sites.find((s) => s.id === siteId);
    store.addShift({
      date,
      shiftType,
      siteId,
      siteName: site ? site.name : 'Objekt',
      status: 'Offen',
      requiredQualification,
      hours: 8
    });
    setShowAddShiftModal(false);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Dienst- & Schichtplanung</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-200 font-mono">
              Live-Konfliktprüfung
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Mitarbeiterzuweisung mit automatischer Prüfung auf § 34a GewO Gültigkeit, Ersthelfer- und Brandschutznachweise.
          </p>
        </div>

        <button
          onClick={() => setShowAddShiftModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Schicht anlegen</span>
        </button>
      </div>

      {/* Filter by Site */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-400">Objektfilter:</span>
        <select
          value={selectedSiteFilter}
          onChange={(e) => setSelectedSiteFilter(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-slate-200 text-xs"
        >
          <option value="Alle">Alle Einsatzobjekte</option>
          {store.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.siteCode} - {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Shifts Table */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Datum & Schicht</th>
                <th className="p-3.5">Objekt & Anforderung</th>
                <th className="p-3.5">Zugewiesener Wachmann</th>
                <th className="p-3.5">Status & Validierung</th>
                <th className="p-3.5 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {shifts.map((sh) => (
                <tr key={sh.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3.5 font-medium">
                    <div className="text-white font-bold">{sh.shiftType}</div>
                    <div className="text-slate-500 font-mono text-[11px]">Datum: {sh.date}</div>
                  </td>
                  <td className="p-3.5">
                    <div className="text-slate-200 font-medium">{sh.siteName}</div>
                    <div className="text-slate-400 text-[11px]">
                      Soll-Qualifikation: <span className="text-brand-300">{sh.requiredQualification}</span>
                    </div>
                  </td>
                  <td className="p-3.5">
                    <div className="font-semibold text-white">
                      {sh.employeeName || <span className="text-amber-400 italic">Offene Schicht</span>}
                    </div>
                  </td>
                  <td className="p-3.5">
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-flex items-center gap-1 w-fit text-[11px] px-2 py-0.5 rounded font-bold ${
                          sh.status === 'Besetzt'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : sh.status === 'Konflikt'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {sh.status === 'Besetzt' && <CheckCircle className="w-3 h-3" />}
                        {sh.status === 'Konflikt' && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                        {sh.status}
                      </span>
                      {sh.hasConflict && (
                        <span className="text-[10px] text-rose-400 font-medium max-w-xs">
                          {sh.conflictReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3.5 text-right">
                    <select
                      value={sh.employeeId || ''}
                      onChange={(e) => store.assignEmployeeToShift(sh.id, e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg p-1.5 text-slate-200 text-xs cursor-pointer focus:border-brand-500"
                    >
                      <option value="">Mitarbeiter zuweisen...</option>
                      {store.employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName} ({emp.role})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Shift Modal */}
      {showAddShiftModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateShift}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neue Schicht im Dienstplan anlegen</h3>
              <button
                type="button"
                onClick={() => setShowAddShiftModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Datum</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Schichtmodell</label>
              <select
                value={shiftType}
                onChange={(e) => setShiftType(e.target.value as Shift['shiftType'])}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="Frühschicht (06:00 - 14:00)">Frühschicht (06:00 - 14:00)</option>
                <option value="Spätschicht (14:00 - 22:00)">Spätschicht (14:00 - 22:00)</option>
                <option value="Nachtschicht (22:00 - 06:00)">Nachtschicht (22:00 - 06:00)</option>
                <option value="24h Bereitschaft">24h Bereitschaft</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Einsatzobjekt</label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                {store.sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.siteCode} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Geforderte Mindestqualifikation</label>
              <input
                type="text"
                value={requiredQualification}
                onChange={(e) => setRequiredQualification(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddShiftModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
              >
                Schicht speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
