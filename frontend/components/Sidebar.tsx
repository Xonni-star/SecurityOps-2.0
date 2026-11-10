import React from 'react';
import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  CalendarDays,
  BookOpenCheck,
  FileCheck2,
  Siren,
  KeyRound,
  CheckSquare2,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Building,
  RotateCw,
  Blocks,
  Layers,
  Database,
  Server
} from 'lucide-react';
import { store } from '../services/store';

export type ActiveModule =
  | 'dashboard'
  | 'clients'
  | 'sites'
  | 'employees'
  | 'schedule'
  | 'wachbuch'
  | 'sops'
  | 'alarms'
  | 'keys'
  | 'tasks'
  | 'reports'
  | 'tenants'
  | 'offlineSync'
  | 'modules'
  | 'architecture'
  | 'databaseExplorer'
  | 'backendExplorer';

interface SidebarProps {
  activeModule: ActiveModule;
  setActiveModule: (m: ActiveModule) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}

interface NavItem {
  id: ActiveModule;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeColor?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  setActiveModule,
  collapsed,
  setCollapsed
}) => {
  const pendingSync = store.getTenantSyncQueue().filter((q) => q.status === 'pending').length;

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard & Leitstand', icon: LayoutDashboard },
    { id: 'backendExplorer', label: 'Phase 3: Backend & API', icon: Server, badge: 'Phase 3', badgeColor: 'bg-indigo-500' },
    { id: 'databaseExplorer', label: 'Phase 2: DB & RLS Labor', icon: Database, badge: 'Phase 2', badgeColor: 'bg-emerald-500' },
    { id: 'wachbuch', label: 'Digitales Wachbuch', icon: BookOpenCheck, badge: 'LIVE', badgeColor: 'bg-rose-500' },
    { id: 'schedule', label: 'Dienst- & Schichtplanung', icon: CalendarDays },
    { id: 'employees', label: 'Personal & §34a Quali', icon: Users, badge: 'Ablauf', badgeColor: 'bg-amber-500' },
    { id: 'sites', label: 'Objektverwaltung (KRITIS)', icon: MapPin },
    { id: 'clients', label: 'Kundenstamm & Verträge', icon: Building2 },
    { id: 'sops', label: 'Dienstanweisungen (QM)', icon: FileCheck2 },
    { id: 'alarms', label: 'Alarm- & Notfallpläne', icon: Siren },
    { id: 'keys', label: 'Schlüssel & Zutritt', icon: KeyRound },
    { id: 'tasks', label: 'Aufgaben & Maßnahmen', icon: CheckSquare2 },
    { id: 'reports', label: 'Berichte & Audit-Export', icon: BarChart3 },
    { id: 'tenants', label: 'Mandantenverwaltung (RLS)', icon: Building, badge: 'Multi-Tenant', badgeColor: 'bg-brand-500' },
    {
      id: 'offlineSync',
      label: 'Offline-First Warteschlange',
      icon: RotateCw,
      badge: pendingSync > 0 ? `${pendingSync} Wartend` : undefined,
      badgeColor: 'bg-amber-500'
    },
    { id: 'modules', label: 'Modul-Manager & Registry', icon: Blocks, badge: 'Plugin API', badgeColor: 'bg-indigo-500' },
    { id: 'architecture', label: 'Phase 1: Gesamtarchitektur', icon: Layers, badge: 'Blueprint', badgeColor: 'bg-slate-700' }
  ];

  return (
    <aside
      className={`relative bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col justify-between shrink-0 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Top Navigation Links */}
      <div className="p-2 space-y-1 overflow-y-auto max-h-[calc(100vh-130px)]">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveModule(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all group ${
                isActive
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50 font-semibold'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-4 h-4 shrink-0 transition-transform group-hover:scale-110 ${
                  isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />
              {!collapsed && (
                <div className="flex-1 flex items-center justify-between text-left truncate">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-bold text-white ml-2 ${
                        item.badgeColor || 'bg-brand-500'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer Info & Collapse Toggle */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
        {!collapsed && (
          <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 mb-2 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Mandant: {store.getActiveTenant().code}</span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              {store.getActiveTenant().name}
            </p>
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors"
          title={collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};
