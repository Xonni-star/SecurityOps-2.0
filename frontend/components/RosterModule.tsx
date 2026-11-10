import React, { useState } from 'react';
import {
  CalendarDays,
  Plus,
  AlertTriangle,
  UserCheck,
  CheckCircle2,
  Clock,
  Shield,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { QualificationType, Shift } from '../types';

export const RosterModule: React.FC = () => {
  const { shifts, sites, employees, assignShiftEmployee, addShift } = useSecurityStore();

  const [filterSiteId, setFilterSiteId] = useState('ALL');
  const [selectedShiftForAssign, setSelectedShiftForAssign] = useState<Shift | null>(null);

  const filteredShifts = shifts.filter((sh) => {
    return filterSiteId === 'ALL' || sh.siteId === filterSiteId;
  });

  const handleAssign = (empId: string) => {
    if (!selectedShiftForAssign) return;
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;

    // Check qualifications
    const hasRequiredQual = emp.qualifications.some(
      (q) => q.type === selectedShiftForAssign.requiredQualification && q.verified
    );

    if (!hasRequiredQual) {
      const confirmOverride = window.confirm(
        `Achtung: ${emp.firstName} ${emp.lastName} besitzt nicht die geforderte Qualifikation "${selectedShiftForAssign.requiredQualification}"! Trotzdem zuweisen?`
      );
      if (!confirmOverride) return;
    }

    assignShiftEmployee(selectedShiftForAssign.id, emp.id, `${emp.firstName} ${emp.lastName}`);
    setSelectedShiftForAssign(null);
  };

  const handleExportRoster = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(shifts, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `dienstplan_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="space-y-6">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Dienstplanung & Schichtzuteilung</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Konfliktfreie Schichtbesetzung mit automatischer § 34a GewO Qualifikationsprüfung und ArbZG-Audit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportRoster}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Plan Exportieren</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs">
        <span className="text-slate-400 font-medium">Objektfilter:</span>
        <select
          value={filterSiteId}
          onChange={(e) => setFilterSiteId(e.target.value)}
          className="bg-slate-800 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 focus:outline-none"
        >
          <option value="ALL">Alle Objekte anzeigen</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Shift Roster Table */}
      <div className="bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800 font-semibold">
              <tr>
                <th className="p-3.5">Objekt & Posten</th>
                <th className="p-3.5">Datum & Uhrzeit</th>
                <th className="p-3.5">Schichtart</th>
                <th className="p-3.5">Geforderte Qualifikation</th>
                <th className="p-3.5">Eingeteilte Wachkraft</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredShifts.map((shift) => (
                <tr key={shift.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3.5">
                    <div className="font-semibold text-slate-200">{shift.siteName}</div>
                    <div className="text-[10px] text-slate-500">ID: {shift.id}</div>
                  </td>

                  <td className="p-3.5">
                    <div className="font-mono text-slate-200">{shift.date}</div>
                    <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {shift.startTime} - {shift.endTime} Uhr
                    </div>
                  </td>

                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {shift.type}
                    </span>
                  </td>

                  <td className="p-3.5">
                    <span className="text-[11px] text-blue-400 font-medium flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      {shift.requiredQualification}
                    </span>
                  </td>

                  <td className="p-3.5">
                    {shift.employeeName ? (
                      <div className="flex items-center gap-1.5 font-medium text-slate-200">
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                        {shift.employeeName}
                      </div>
                    ) : (
                      <span className="text-rose-400 font-semibold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Nicht besetzt!
                      </span>
                    )}
                    {shift.conflictReason && (
                      <div className="text-[10px] text-amber-400 mt-1 max-w-xs">{shift.conflictReason}</div>
                    )}
                  </td>

                  <td className="p-3.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      shift.status === 'Besetzt'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : shift.status === 'Offen'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {shift.status}
                    </span>
                  </td>

                  <td className="p-3.5 text-right">
                    <button
                      onClick={() => setSelectedShiftForAssign(shift)}
                      className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-500/30 font-medium transition"
                    >
                      {shift.employeeName ? 'Umplanen' : 'Zuweisen'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assignment Modal */}
      {selectedShiftForAssign && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Wachkraft für Schicht zuweisen</h3>
              <button onClick={() => setSelectedShiftForAssign(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="my-4 text-xs space-y-2 p-3 rounded-xl bg-slate-800/60 border border-slate-700">
              <div>Objekt: <strong className="text-slate-200">{selectedShiftForAssign.siteName}</strong></div>
              <div>Datum: <strong className="text-slate-200">{selectedShiftForAssign.date} ({selectedShiftForAssign.startTime} - {selectedShiftForAssign.endTime})</strong></div>
              <div className="text-blue-400 font-semibold">Gefordert: {selectedShiftForAssign.requiredQualification}</div>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Verfügbare Mitarbeiter:</div>
              {employees.map((emp) => {
                const hasQual = emp.qualifications.some((q) => q.type === selectedShiftForAssign.requiredQualification && q.verified);
                const isUnavailable = emp.status === 'Krank' || emp.status === 'Urlaub';

                return (
                  <div
                    key={emp.id}
                    className={`p-3 rounded-xl border flex items-center justify-between text-xs transition ${
                      isUnavailable
                        ? 'opacity-50 bg-slate-900 border-slate-800'
                        : 'bg-slate-800/40 border-slate-700 hover:border-blue-500'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-200">{emp.firstName} {emp.lastName}</div>
                      <div className="text-[10px] text-slate-400">
                        Status: <span className={emp.status === 'Aktiv' ? 'text-emerald-400' : 'text-amber-400'}>{emp.status}</span> • Std: {emp.weeklyHours}h/Wo
                      </div>
                      <div className="text-[10px] mt-0.5">
                        {hasQual ? (
                          <span className="text-emerald-400 font-medium">✓ Qualifiziert</span>
                        ) : (
                          <span className="text-rose-400">✗ Fehlende Qualifikation</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleAssign(emp.id)}
                      disabled={isUnavailable}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-30"
                    >
                      Einteilen
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
