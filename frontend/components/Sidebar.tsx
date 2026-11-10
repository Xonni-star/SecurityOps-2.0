import React from 'react';
import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  CalendarDays,
  BookOpen,
  FileCheck2,
  Siren,
  KeyRound,
  CheckSquare,
  FileText,
  FileSpreadsheet,
  Code2,
  ChevronRight,
  Zap,
  ShieldCheck,
  Smartphone,
  Award,
  Tablet
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { UserRole } from '../types';

interface SidebarProps {
  onCloseMobileMenu?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onCloseMobileMenu }) => {
  const {
    activeTab,
    setActiveTab,
    getTenantShifts,
    getTenantGuardBook,
    getTenantTasks,
    getTenantKeys,
    getTenantDocuments,
    getTenantMobileDevices,
    currentUserRole
  } = useSecurityStore();

  const shifts = getTenantShifts();
  const guardBook = getTenantGuardBook();
  const tasks = getTenantTasks();
  const keys = getTenantKeys();
  const documents = getTenantDocuments();
  const devices = getTenantMobileDevices();

  const openShiftsCount = shifts.filter((s) => s.status === 'Offen').length;
  const criticalLogsCount = guardBook.filter((g) => g.priority === 'Kritisch' && !g.resolved).length;
  const openTasksCount = tasks.filter((t) => t.status !== 'Erledigt').length;
  const issuedKeysCount = keys.filter((k) => k.status === 'Ausgegeben').length;

  const canAccessRoster = currentUserRole !== UserRole.AUDITOR;
  const canAccessAdmin = currentUserRole === UserRole.ADMIN || currentUserRole === UserRole.GF || currentUserRole === UserRole.EINSATZLEITUNG;

  const menuSections = [
    {
      title: 'MOBIL & EINSATZ',
      items: [
        { id: 'mobile_app', label: 'Mitarbeiter-App (Mobil)', icon: Smartphone, visible: true },
        { id: 'dashboard', label: 'Einsatz-Dashboard', icon: LayoutDashboard, visible: true },
        { id: 'guardbook', label: 'Digitales Wachbuch', icon: BookOpen, badge: criticalLogsCount, badgeColor: 'bg-rose-500', visible: true },
        { id: 'roster', label: 'Dienstplanung (Soll/Ist)', icon: CalendarDays, badge: openShiftsCount, badgeColor: 'bg-amber-500', visible: canAccessRoster },
        { id: 'alarms', label: 'Alarm- & Notfallmanagement', icon: Siren, visible: true },
        { id: 'keys', label: 'Schlüssel & Zutrittsmedien', icon: KeyRound, badge: issuedKeysCount, badgeColor: 'bg-blue-500', visible: true }
      ]
    },
    {
      title: 'STAMMDATEN & OBJEKTE',
      items: [
        { id: 'sites', label: 'Objektverwaltung (Detail-Tabs)', icon: MapPin, visible: true },
        { id: 'clients', label: 'Kunden & Verträge', icon: Building2, visible: true },
        { id: 'employees', label: 'Personal & § 34a GewO', icon: Users, visible: true }
      ]
    },
    {
      title: 'QM & COMPLIANCE',
      items: [
        { id: 'sop', label: 'Dienstanweisungen & QM', icon: FileCheck2, visible: true },
        { id: 'documents', label: 'Dokumentenmanagement (DMS)', icon: FileText, badge: documents.length, badgeColor: 'bg-slate-700', visible: true },
        { id: 'tasks', label: 'Aufgaben & Maßnahmen', icon: CheckSquare, badge: openTasksCount, badgeColor: 'bg-slate-600', visible: true },
        { id: 'automations', label: 'Automatisierung & Watchdog', icon: Zap, visible: true },
        { id: 'reports', label: 'Berichte & DIN 77200', icon: FileSpreadsheet, visible: true }
      ]
    },
    {
      title: 'GERÄTE & RELEASE',
      items: [
        { id: 'mobile_devices', label: 'Mobile Geräte & Kiosk', icon: Tablet, badge: devices.length, badgeColor: 'bg-blue-600', visible: canAccessAdmin },
        { id: 'e2e_acceptance', label: 'E2E-Abnahme & Release 1.0', icon: Award, visible: canAccessAdmin },
        { id: 'security_audit', label: 'Sicherheits-Audit & DSGVO', icon: ShieldCheck, visible: canAccessAdmin },
        { id: 'architecture', label: 'Backend & DB Blueprint', icon: Code2, visible: canAccessAdmin }
      ]
    }
  ];

  const handleSelectTab = (tabId: string) => {
    setActiveTab(tabId);
    if (onCloseMobileMenu) {
      onCloseMobileMenu();
    }
  };

  return (
    <aside className="w-64 border-r border-slate-800 bg-[#0a0f1d] flex flex-col shrink-0 min-h-[calc(100vh-4rem)] p-3">
      <nav className="flex-1 space-y-6 overflow-y-auto pr-1">
        {menuSections.map((sec, idx) => (
          <div key={idx}>
            <div className="px-3 mb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">
              {sec.title}
            </div>
            <div className="space-y-1">
              {sec.items
                .filter((item) => item.visible)
                .map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelectTab(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group ${
                        isActive
                          ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {typeof item.badge === 'number' && item.badge > 0 && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold text-white ${item.badgeColor || 'bg-blue-500'}`}>
                            {item.badge}
                          </span>
                        )}
                        {isActive && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 mt-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 text-[11px]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-slate-400 font-semibold">MDM Flottenstatus</span>
          <span className="text-emerald-400 font-mono font-bold">LockTask Aktiv</span>
        </div>
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div className="bg-emerald-500 h-full w-[100%] rounded-full" />
        </div>
        <p className="text-[10px] text-slate-500 mt-2">Android Enterprise & Apple MDM</p>
      </div>
    </aside>
  );
};
