import React, { useState, useEffect } from 'react';
import {
  Shield,
  Bell,
  Sparkles,
  Terminal,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Search,
  Building,
  Wifi,
  WifiOff,
  RotateCw
} from 'lucide-react';
import { store } from '../services/store';
import { UserRole } from '../types';

interface HeaderProps {
  onOpenAiAssistant: () => void;
  onOpenArchitectureModal: () => void;
  globalSearch: string;
  setGlobalSearch: (s: string) => void;
  onOpenOfflineQueue: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenAiAssistant,
  onOpenArchitectureModal,
  globalSearch,
  setGlobalSearch,
  onOpenOfflineQueue
}) => {
  const [currentTime, setCurrentTime] = useState('');
  const [role, setRole] = useState<UserRole>(store.activeRole);
  const [showNotifMenu, setShowNotifMenu] = useState(false);
  const activeTenant = store.getActiveTenant();
  const notifications = store.getTenantNotifications();
  const unreadCount = notifications.filter((n) => !n.read).length;
  const pendingSyncCount = store.getTenantSyncQueue().filter((q) => q.status === 'pending').length;

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRole = e.target.value as UserRole;
    setRole(newRole);
    store.setActiveRole(newRole);
  };

  const handleTenantChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    store.setActiveTenantId(e.target.value);
  };

  return (
    <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 flex items-center justify-between gap-4">
      {/* Brand logo & Live System status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-lg shadow-brand-900/40 border border-brand-400/20">
          <Shield className="w-5 h-5 text-brand-100" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg tracking-tight text-white">SecurityOps</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-500/20 border border-brand-400/30 text-brand-200 font-mono font-semibold">
              2.0 MULTI-TENANT
            </span>
          </div>
          <p className="text-[11px] text-slate-400 hidden sm:block">
            DIN 77200 • § 34a GewO • Offline First Leitstand
          </p>
        </div>
      </div>

      {/* Global Quick Search */}
      <div className="hidden md:flex flex-1 max-w-md relative items-center">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Mitarbeiter, Objekte, Wachbuch, Aktenzeichen suchen..."
          value={globalSearch}
          onChange={(e) => setGlobalSearch(e.target.value)}
          className="w-full bg-slate-950/80 border border-slate-800 text-sm text-slate-200 rounded-lg pl-9 pr-3 py-1.5 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all placeholder:text-slate-500"
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Multi-Tenant Organization Switcher */}
        <div className="flex items-center bg-slate-950 border border-brand-500/30 rounded-lg px-2.5 py-1 text-xs">
          <Building className="w-3.5 h-3.5 text-brand-400 mr-1.5 shrink-0" />
          <select
            value={store.activeTenantId}
            onChange={handleTenantChange}
            aria-label="Aktiven Mandanten auswählen"
            className="bg-transparent text-xs text-brand-200 font-bold focus:outline-none cursor-pointer max-w-[140px] truncate"
          >
            {store.tenants.map((t) => (
              <option key={t.id} value={t.id} className="bg-slate-900 text-slate-100">
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* Offline Simulation Toggle & Sync Status Pill */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => store.toggleOfflineSimulation()}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              store.isOfflineMode
                ? 'bg-rose-950/80 border-rose-600 text-rose-300 animate-pulse'
                : 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
            }`}
            title="Klicken um Offline-Modus (U-Bahn / Bunker / Funkausfall) zu simulieren"
          >
            {store.isOfflineMode ? (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden xl:inline">OFFLINE SIMULIERT</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden xl:inline">ONLINE</span>
              </>
            )}
          </button>

          {/* Sync Queue Inspector Button */}
          <button
            onClick={onOpenOfflineQueue}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs border ${
              pendingSyncCount > 0
                ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                : 'bg-slate-800 border-slate-700 text-slate-300'
            }`}
            title="Offline-Warteschlange & Synchronisationsstatus einsehen"
          >
            <RotateCw className={`w-3.5 h-3.5 ${store.isSyncing ? 'animate-spin text-brand-400' : ''}`} />
            <span className="font-mono font-bold">{pendingSyncCount}</span>
          </button>
        </div>

        {/* Live Clock */}
        <div className="hidden 2xl:flex flex-col text-right font-mono text-xs border-r border-slate-800 pr-3">
          <span className="text-slate-300 font-semibold">{currentTime.split(', ')[1]}</span>
          <span className="text-[10px] text-slate-500">{currentTime.split(', ')[0]}</span>
        </div>

        {/* AI Security Copilot Button */}
        <button
          onClick={onOpenAiAssistant}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-brand-600 hover:from-indigo-500 hover:to-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-950 transition-all border border-indigo-400/30 group"
          title="KI-Sicherheitsassistent öffnen"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span className="hidden sm:inline">KI-Assistent</span>
        </button>

        {/* Backend & DB Architecture blueprint modal button */}
        <button
          onClick={onOpenArchitectureModal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
          title="Python FastAPI, PostgreSQL & Docker Architektur"
        >
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden xl:inline">Architektur & RLS</span>
        </button>

        {/* Role Switcher (RBAC simulation) */}
        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
          <span className="text-[11px] text-slate-400 mr-2 hidden sm:inline">Rolle:</span>
          <select
            value={role}
            onChange={handleRoleChange}
            aria-label="Aktive Benutzerrolle auswählen"
            className="bg-transparent text-xs text-brand-300 font-medium focus:outline-none cursor-pointer"
          >
            {Object.values(UserRole).map((r) => (
              <option key={r} value={r} className="bg-slate-900 text-slate-100">
                {r}
              </option>
            ))}
          </select>
        </div>

        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifMenu(!showNotifMenu)}
            className="relative p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            title="Mitteilungszentrale"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-slate-900">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifMenu && (
            <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-3 z-50">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {activeTenant.code} • Ereignisse
                </span>
                <button
                  onClick={() => store.markAllNotificationsRead()}
                  className="text-[11px] text-brand-400 hover:text-brand-300"
                >
                  Als gelesen markieren
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2 text-center">Keine neuen Mitteilungen</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-2 rounded-lg text-xs border ${
                        n.type === 'alert'
                          ? 'bg-rose-950/40 border-rose-800/60 text-rose-200'
                          : n.type === 'warning'
                          ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                          : 'bg-slate-800/50 border-slate-700 text-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold flex items-center gap-1">
                          {n.type === 'alert' && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                          {n.type === 'warning' && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                          {n.type === 'info' && <CheckCircle className="w-3 h-3 text-cyan-400" />}
                          {n.title}
                        </span>
                        <span className="text-[10px] text-slate-400">{n.timestamp}</span>
                      </div>
                      <p className="text-[11px] opacity-90">{n.message}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Reset Demo State button */}
        <button
          onClick={() => {
            if (confirm('Möchten Sie alle Daten auf den Werkzustand zurücksetzen?')) {
              store.resetDemoData();
            }
          }}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          title="Demo-Daten zurücksetzen"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
