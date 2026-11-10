import React from 'react';
import {
  Shield,
  Sparkles,
  Bell,
  Search,
  Wifi,
  WifiOff,
  RefreshCw,
  Building,
  Sliders,
  Sun,
  Moon,
  Menu,
  Smartphone,
  Monitor
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { UserRole } from '../types';

interface NavbarProps {
  onOpenCopilot: () => void;
  onOpenNotifications: () => void;
  onOpenSyncManager: () => void;
  onOpenModuleManager: () => void;
  onOpenGlobalSearch: () => void;
  onToggleMobileMenu?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenCopilot,
  onOpenNotifications,
  onOpenSyncManager,
  onOpenModuleManager,
  onOpenGlobalSearch,
  onToggleMobileMenu
}) => {
  const {
    currentUserRole,
    setCurrentUserRole,
    notifications,
    getTenantNotificationDeliveries,
    tenants,
    currentTenantId,
    setCurrentTenantId,
    isOnline,
    toggleNetworkSimulation,
    syncQueue,
    theme,
    toggleTheme,
    activeTab,
    setActiveTab
  } = useSecurityStore();

  const deliveries = getTenantNotificationDeliveries();
  const unreadDeliveries = deliveries.filter((d) => !d.read).length;
  const pendingSyncs = syncQueue.filter((q) => q.status === 'pending').length;

  return (
    <header className="h-16 border-b border-slate-800 bg-[#0a0f1d]/95 dark:bg-[#0a0f1d]/95 light:bg-white backdrop-blur-md sticky top-0 z-30 px-3 md:px-6 flex items-center justify-between gap-2 sm:gap-3 transition-colors">
      {/* Mobile Menu & Brand */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white md:hidden"
            aria-label="Menü öffnen"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20 ring-1 ring-white/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-base sm:text-lg tracking-wider text-white">
                SECURITY<span className="text-blue-400">OPS</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                2.0
              </span>
            </div>
            <p className="text-[9px] text-slate-400 tracking-tight hidden lg:block">
              DIN 77200 & § 34a GewO Enterprise Core
            </p>
          </div>
        </div>

        {/* Multi-Tenant Switcher */}
        <div className="hidden sm:flex items-center gap-1.5 ml-2 pl-3 border-l border-slate-800">
          <Building className="w-3.5 h-3.5 text-blue-400" />
          <div className="text-left">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block leading-none">
              Mandant
            </span>
            <select
              value={currentTenantId}
              onChange={(e) => setCurrentTenantId(e.target.value)}
              className="bg-transparent text-xs text-slate-200 font-semibold focus:outline-none cursor-pointer max-w-[150px] md:max-w-[180px] truncate"
              aria-label="Mandant auswählen"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id} className="bg-slate-900 text-slate-200">
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Global Quick Search (Ctrl+K) */}
      <div
        onClick={onOpenGlobalSearch}
        className="hidden xl:flex items-center relative max-w-xs w-full mx-2 cursor-pointer group"
      >
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-hover:text-blue-400 transition-colors" />
        <div className="w-full bg-slate-900/90 text-xs text-slate-400 pl-9 pr-3 py-1.5 rounded-lg border border-slate-800 group-hover:border-blue-500/50 flex items-center justify-between">
          <span>Objekte, Wachkräfte, Vorfälle...</span>
          <kbd className="px-1.5 py-0.2 rounded bg-slate-800 text-[10px] font-mono text-slate-400">Ctrl+K</kbd>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Toggle Mobile App Shell vs Desktop Workspace */}
        <button
          onClick={() => setActiveTab(activeTab === 'mobile_app' ? 'dashboard' : 'mobile_app')}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
            activeTab === 'mobile_app'
              ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
              : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
          }`}
          title="Zwischen Desktop-Leitstelle und Mobiler Mitarbeiter-App wechseln"
        >
          {activeTab === 'mobile_app' ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5 text-blue-400" />}
          <span className="hidden sm:inline">{activeTab === 'mobile_app' ? 'Desktop-Modus' : 'Mitarbeiter-App'}</span>
        </button>

        <button
          onClick={onOpenGlobalSearch}
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 xl:hidden transition"
          title="Globale Suche"
        >
          <Search className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
          title={`Wechseln zu ${theme === 'dark' ? 'Light Mode' : 'Dark Mode'}`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
        </button>

        <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-lg p-1">
          <button
            onClick={toggleNetworkSimulation}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold transition ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 animate-pulse'
            }`}
          >
            {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{isOnline ? 'Online' : 'Offline'}</span>
          </button>

          <button
            onClick={onOpenSyncManager}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800 text-slate-300 text-xs font-mono"
            title="Offline-Sync"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pendingSyncs > 0 ? 'text-amber-400 animate-spin' : 'text-slate-400'}`} />
            {pendingSyncs > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-black text-[10px] font-bold">
                {pendingSyncs}
              </span>
            )}
          </button>
        </div>

        <button
          onClick={onOpenCopilot}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-blue-600/20 to-purple-600/20 hover:from-blue-600/30 hover:to-purple-600/30 border border-blue-500/40 text-blue-300 text-xs font-semibold shadow-sm transition-all"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden md:inline">KI-Assistent</span>
        </button>

        <button
          onClick={onOpenNotifications}
          className="relative p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 transition"
          title="Benachrichtigungscenter"
        >
          <Bell className="w-4 h-4" />
          {unreadDeliveries > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-[10px] font-bold flex items-center justify-center text-white ring-2 ring-[#0a0f1d]">
              {unreadDeliveries}
            </span>
          )}
        </button>

        <div className="hidden sm:flex items-center gap-1.5 bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1">
          <div className="text-right">
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400 block leading-tight">
              Rolle
            </span>
            <span className="text-xs font-semibold text-blue-300 truncate max-w-[100px] block">
              {currentUserRole}
            </span>
          </div>
          <select
            value={currentUserRole}
            onChange={(e) => setCurrentUserRole(e.target.value as UserRole)}
            className="bg-transparent text-xs text-slate-200 font-medium focus:outline-none cursor-pointer"
          >
            {Object.values(UserRole).map((role) => (
              <option key={role} value={role} className="bg-slate-900 text-slate-200">
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
};
