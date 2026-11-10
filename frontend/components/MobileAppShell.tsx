import React, { useState } from 'react';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Radio,
  FileCheck2,
  Users,
  Wifi,
  WifiOff,
  Bell,
  ArrowRightLeft,
  ChevronRight,
  ShieldAlert,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Menu,
  Lock,
  Unlock,
  Fingerprint,
  Monitor
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { MobileMyDuty } from './MobileMyDuty';
import { MobilePatrolScanner } from './MobilePatrolScanner';
import { MobileShiftHandover } from './MobileShiftHandover';
import { GuardBookModule } from './GuardBookModule';
import { SOPModule } from './SOPModule';
import { TasksModule } from './TasksModule';
import { UserRole, KioskOperatingMode } from '../types';

export const MobileAppShell: React.FC = () => {
  const {
    currentUserName,
    currentUserRole,
    getCurrentTenant,
    isOnline,
    toggleNetworkSimulation,
    getTenantGuardBook,
    getTenantTasks,
    setActiveTab,
    currentKioskMode,
    isKioskLocked,
    setKioskMode,
    activeStationProfile,
    authenticateWithBiometrics
  } = useSecurityStore();

  const tenant = getCurrentTenant();
  const guardBook = getTenantGuardBook();
  const tasks = getTenantTasks();

  const [activeMobileView, setActiveMobileView] = useState<'home' | 'duty' | 'guardbook' | 'patrol' | 'handover' | 'sop' | 'tasks'>('home');
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  const unreadIncidents = guardBook.filter((g) => g.priority === 'Kritisch' && !g.resolved).length;
  const openTasks = tasks.filter((t) => t.status !== 'Erledigt').length;

  const isViewAllowed = (viewId: string) => {
    // If kiosk profile specifies allowed views, filter; otherwise default to all
    if (activeStationProfile && activeStationProfile.allowedViews.length > 0) {
      return activeStationProfile.allowedViews.includes(viewId);
    }
    return true;
  };

  const handleUnlockKiosk = (e: React.FormEvent) => {
    e.preventDefault();
    const success = setKioskMode(KioskOperatingMode.STANDARD, adminPinInput);
    if (success) {
      setIsPinModalOpen(false);
      setAdminPinInput('');
      setPinError(false);
    } else {
      setPinError(true);
    }
  };

  return (
    <div className={`max-w-md mx-auto min-h-[calc(100vh-6rem)] flex flex-col justify-between font-sans ${isKioskLocked ? 'select-none' : ''}`}>
      {/* Kiosk Mode Permanent Status Badge (When active) */}
      {isKioskLocked && (
        <div className="mb-2 p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <span className="font-bold block leading-tight">Kiosk-Modus aktiv: {currentKioskMode}</span>
              <span className="text-[10px] text-amber-400/80">Profil: {activeStationProfile.name} • LockTaskMode</span>
            </div>
          </div>
          <button
            onClick={() => setIsPinModalOpen(true)}
            className="px-2 py-1 rounded bg-amber-600/30 hover:bg-amber-600/40 text-amber-200 text-[10px] font-bold border border-amber-500/40 flex items-center gap-1"
          >
            <Unlock className="w-3 h-3" />
            <span>PIN</span>
          </button>
        </div>
      )}

      {/* Mobile Top Header Banner */}
      <div className="mb-4 p-3 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
        <div>
          <span className="text-[10px] text-slate-400 font-mono block leading-none">{tenant.name}</span>
          <div className="font-extrabold text-sm text-white mt-1 truncate max-w-[190px]">{currentUserName}</div>
          <span className="text-[10px] text-blue-400 font-medium">{currentUserRole}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => authenticateWithBiometrics()}
            className="p-2 rounded-xl bg-slate-800 text-blue-400 hover:bg-slate-700"
            title="Biometrische Verifikation"
          >
            <Fingerprint className="w-4 h-4" />
          </button>

          <button
            onClick={toggleNetworkSimulation}
            className={`p-2 rounded-xl flex items-center gap-1 text-[11px] font-semibold transition ${
              isOnline ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/20 text-rose-400 animate-pulse'
            }`}
            title="Netzwerk umschalten"
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main View Switcher */}
      <div className="flex-1">
        {activeMobileView === 'home' && (
          <div className="space-y-4 pb-20 text-xs">
            {/* Quick Status Cards Scoped to Station Profile */}
            <div className="grid grid-cols-2 gap-3">
              {isViewAllowed('duty') && (
                <div
                  onClick={() => setActiveMobileView('duty')}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-blue-500 transition"
                >
                  <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 w-fit mb-2">
                    <CalendarDays className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-white text-sm">Mein Dienst</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Schichten & Tausch</div>
                </div>
              )}

              {isViewAllowed('patrol') && (
                <div
                  onClick={() => setActiveMobileView('patrol')}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-blue-500 transition"
                >
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 w-fit mb-2">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-white text-sm">Kontrollgang</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">QR & NFC Scanner</div>
                </div>
              )}

              {isViewAllowed('guardbook') && (
                <div
                  onClick={() => setActiveMobileView('guardbook')}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-blue-500 transition relative"
                >
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 w-fit mb-2">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-white text-sm">Wachbuch</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Ereignisse erfassen</div>
                  {unreadIncidents > 0 && (
                    <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                  )}
                </div>
              )}

              {isViewAllowed('handover') && (
                <div
                  onClick={() => setActiveMobileView('handover')}
                  className="p-4 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-blue-500 transition"
                >
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 w-fit mb-2">
                    <FileCheck2 className="w-5 h-5" />
                  </div>
                  <div className="font-bold text-white text-sm">Schichtwechsel</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Übergabeprotokoll</div>
                </div>
              )}
            </div>

            {/* Quick Action Links */}
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="font-bold text-slate-300 block mb-1">Weitere Funktionen:</span>

              {isViewAllowed('tasks') && (
                <div
                  onClick={() => setActiveMobileView('tasks')}
                  className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/70"
                >
                  <span>Meine Aufgaben</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                    {openTasks}
                  </span>
                </div>
              )}

              {isViewAllowed('sop') && (
                <div
                  onClick={() => setActiveMobileView('sop')}
                  className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/70"
                >
                  <span>Dienstanweisungen & QM</span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              )}

              {!isKioskLocked && (
                <div
                  onClick={() => setActiveTab('dashboard')}
                  className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/70 text-blue-400 font-semibold"
                >
                  <span>Zurück zur Desktop-Leitstelle</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              )}
            </div>
          </div>
        )}

        {activeMobileView === 'duty' && isViewAllowed('duty') && <MobileMyDuty />}
        {activeMobileView === 'patrol' && isViewAllowed('patrol') && <MobilePatrolScanner />}
        {activeMobileView === 'handover' && isViewAllowed('handover') && <MobileShiftHandover />}
        {activeMobileView === 'guardbook' && isViewAllowed('guardbook') && <GuardBookModule />}
        {activeMobileView === 'sop' && isViewAllowed('sop') && <SOPModule />}
        {activeMobileView === 'tasks' && isViewAllowed('tasks') && <TasksModule />}
      </div>

      {/* Sticky Mobile Bottom Navigation Bar (WCAG AA Compliant Touch-Targets) */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-[#0f172a]/95 backdrop-blur-md border-t border-slate-800 flex items-center justify-around px-2 z-40 max-w-md mx-auto">
        <button
          onClick={() => setActiveMobileView('home')}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-semibold transition ${
            activeMobileView === 'home' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className="w-4 h-4 mb-0.5" />
          <span>Home</span>
        </button>

        {isViewAllowed('duty') && (
          <button
            onClick={() => setActiveMobileView('duty')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-semibold transition ${
              activeMobileView === 'duty' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CalendarDays className="w-4 h-4 mb-0.5" />
            <span>Dienst</span>
          </button>
        )}

        {isViewAllowed('patrol') && (
          <button
            onClick={() => setActiveMobileView('patrol')}
            className="flex flex-col items-center justify-center -top-3 relative px-3 py-2 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 ring-2 ring-[#0a0f1d]"
          >
            <Radio className="w-5 h-5" />
            <span className="text-[9px] font-bold mt-0.5">Scan</span>
          </button>
        )}

        {isViewAllowed('guardbook') && (
          <button
            onClick={() => setActiveMobileView('guardbook')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-semibold transition ${
              activeMobileView === 'guardbook' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4 mb-0.5" />
            <span>Wachbuch</span>
          </button>
        )}

        {isViewAllowed('handover') && (
          <button
            onClick={() => setActiveMobileView('handover')}
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-semibold transition ${
              activeMobileView === 'handover' ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCheck2 className="w-4 h-4 mb-0.5" />
            <span>Übergabe</span>
          </button>
        )}
      </nav>

      {/* Kiosk Mode Exit PIN Dialog */}
      {isPinModalOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-amber-500/40 rounded-2xl max-w-sm w-full p-5 shadow-2xl text-xs space-y-4">
            <div className="flex items-center gap-2 text-amber-400 font-bold">
              <Lock className="w-5 h-5" />
              <h3 className="text-sm text-white">Administrator-PIN erforderlich</h3>
            </div>
            <p className="text-slate-400 text-[11px]">
              Geben Sie die autorisierte Leitstellen-PIN ein, um den LockTask Kiosk-Modus zu beenden (Standard: <code>7720</code>):
            </p>

            <form onSubmit={handleUnlockKiosk} className="space-y-3">
              <input
                type="password"
                maxLength={6}
                autoFocus
                value={adminPinInput}
                onChange={(e) => { setAdminPinInput(e.target.value); setPinError(false); }}
                placeholder="PIN eingeben..."
                className="w-full bg-slate-800 text-center tracking-widest text-lg font-mono border border-slate-700 rounded-xl p-2.5 text-white"
              />

              {pinError && (
                <div className="text-rose-400 text-center font-bold text-[11px]">
                  Falsche Administrator-PIN!
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPinModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold"
                >
                  Kiosk entsperren
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
