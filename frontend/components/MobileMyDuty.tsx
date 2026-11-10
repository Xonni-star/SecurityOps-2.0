import React, { useState } from 'react';
import {
  CalendarDays,
  Clock,
  MapPin,
  Phone,
  ShieldCheck,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  Plus,
  Send,
  User
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Shift, UserRole } from '../types';

export const MobileMyDuty: React.FC = () => {
  const {
    getTenantShifts,
    getTenantSites,
    getTenantEmployees,
    getTenantShiftSwaps,
    addShiftSwapRequest,
    currentUserId,
    currentUserName,
    getCurrentTenant
  } = useSecurityStore();

  const shifts = getTenantShifts();
  const sites = getTenantSites();
  const employees = getTenantEmployees();
  const shiftSwaps = getTenantShiftSwaps();
  const tenant = getCurrentTenant();

  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [selectedShiftForSwap, setSelectedShiftForSwap] = useState<Shift | null>(null);
  const [targetEmployeeId, setTargetEmployeeId] = useState(employees[0]?.id || '');
  const [swapReason, setSwapReason] = useState('');

  // Find shifts belonging to current logged in guard
  const myShifts = shifts.filter((s) => s.employeeId === currentUserId || s.employeeName?.includes('Sabine Becker'));
  const todayShift = myShifts[0] || shifts[0];
  const upcomingShifts = myShifts.slice(1);

  // Active object for today
  const activeSite = sites.find((s) => s.id === todayShift?.siteId) || sites[0];

  const handleOpenSwapModal = (shift: Shift) => {
    setSelectedShiftForSwap(shift);
    setIsSwapModalOpen(true);
  };

  const handleSendSwap = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShiftForSwap) return;
    const target = employees.find((e) => e.id === targetEmployeeId);

    addShiftSwapRequest({
      shiftId: selectedShiftForSwap.id,
      requestingEmployeeId: currentUserId,
      requestingEmployeeName: currentUserName,
      targetEmployeeId: targetEmployeeId,
      targetEmployeeName: target ? `${target.firstName} ${target.lastName}` : 'Kollege',
      reason: swapReason || 'Persönlicher Tauschwunsch'
    });

    setIsSwapModalOpen(false);
    setSwapReason('');
  };

  return (
    <div className="space-y-4 pb-20">
      {/* Current Active Shift Highlight */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-900/60 via-slate-900 to-slate-950 border border-blue-500/30 shadow-xl text-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            Aktiver Dienst Heute
          </span>
          <span className="font-mono text-slate-400">{todayShift?.date}</span>
        </div>

        <div>
          <h2 className="text-base font-extrabold text-white">{activeSite?.name}</h2>
          <p className="text-slate-300 text-[11px] flex items-center gap-1 mt-0.5">
            <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate">{activeSite?.address}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Dienstzeit:</span>
            <span className="font-mono font-bold text-slate-100 text-xs mt-0.5 block flex items-center gap-1">
              <Clock className="w-3 h-3 text-blue-400" />
              {todayShift?.startTime} - {todayShift?.endTime} Uhr
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Posten & Art:</span>
            <span className="font-bold text-slate-100 text-xs mt-0.5 block truncate">
              {todayShift?.type}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px]">
          <span className="text-slate-400">Objektleiter: {activeSite?.siteManagerName}</span>
          <a
            href="tel:+491729012344"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold"
          >
            <Phone className="w-3 h-3" />
            <span>Anrufen</span>
          </a>
        </div>
      </div>

      {/* Quick Shift Swap Requests */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-slate-200">
            <ArrowRightLeft className="w-4 h-4 text-blue-400" />
            <span>Diensttausch & Vertretungsanträge</span>
          </div>
          <button
            onClick={() => handleOpenSwapModal(todayShift)}
            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span>Tausch anfragen</span>
          </button>
        </div>

        <div className="space-y-2">
          {shiftSwaps.length === 0 ? (
            <div className="text-slate-500 text-[11px] py-2 text-center">Keine offenen Tauschanfragen vorhanden.</div>
          ) : (
            shiftSwaps.map((swap) => (
              <div
                key={swap.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold text-slate-200">
                    {swap.requestingEmployeeName} ➔ {swap.targetEmployeeName}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Grund: {swap.reason} ({swap.requestedAt})</div>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  swap.status === 'BESTAETIGT'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : swap.status === 'ABGELEHNT'
                    ? 'bg-rose-500/10 text-rose-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {swap.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Upcoming Shifts Roster */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
        <h3 className="font-bold text-slate-200 flex items-center gap-1.5">
          <CalendarDays className="w-4 h-4 text-blue-400" />
          <span>Kommende Schichten ({upcomingShifts.length + 1})</span>
        </h3>

        <div className="space-y-2">
          {myShifts.map((sh) => (
            <div
              key={sh.id}
              className="p-3 rounded-xl bg-slate-800/30 border border-slate-800 flex items-center justify-between"
            >
              <div>
                <span className="font-semibold text-slate-200 block">{sh.siteName}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {sh.date} • {sh.startTime} - {sh.endTime} ({sh.type})
                </span>
              </div>

              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                {sh.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Shift Swap Modal */}
      {isSwapModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-sm w-full p-5 shadow-2xl text-xs space-y-4">
            <h3 className="text-sm font-bold text-white">Diensttausch anfragen</h3>
            <p className="text-slate-400 text-[11px]">
              Tauschpartner für Schicht am {selectedShiftForSwap?.date} ({selectedShiftForSwap?.siteName}) auswählen:
            </p>

            <form onSubmit={handleSendSwap} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1">Kollege auswählen</label>
                <select
                  value={targetEmployeeId}
                  onChange={(e) => setTargetEmployeeId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  {employees.filter(e => e.id !== currentUserId).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} ({emp.role})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Begründung für Einsatzleitung</label>
                <input
                  type="text"
                  value={swapReason}
                  onChange={(e) => setSwapReason(e.target.value)}
                  placeholder="z. B. Tausch wegen Terminkollision"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSwapModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-semibold flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Anfrage senden</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
