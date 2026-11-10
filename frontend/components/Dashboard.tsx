import React from 'react';
import {
  Users,
  MapPin,
  Building2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  CalendarCheck,
  KeyRound,
  FileWarning,
  Sparkles,
  WifiOff,
  RotateCw,
  Building
} from 'lucide-react';
import { store } from '../services/store';
import { ActiveModule } from './Sidebar';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid
} from 'recharts';

interface DashboardProps {
  onNavigate: (module: ActiveModule) => void;
  onOpenAiAssistant: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigate, onOpenAiAssistant }) => {
  const currentTenant = store.getActiveTenant();
  const employees = store.getTenantEmployees();
  const sites = store.getTenantSites();
  const incidents = store.getTenantIncidents();
  const shifts = store.getTenantShifts();
  const keys = store.getTenantKeys();
  const pendingSyncQueue = store.getTenantSyncQueue().filter((q) => q.status === 'pending');

  const activeEmployees = employees.filter((e) => e.status === 'Aktiv').length;
  const openIncidents = incidents.filter((i) => !i.resolved).length;
  const criticalIncidents = incidents.filter((i) => i.priority === 'KRITISCH' && !i.resolved).length;
  const openShifts = shifts.filter((s) => s.status === 'Offen' || s.status === 'Konflikt').length;
  const keysOut = keys.filter((k) => k.status === 'Ausgegeben').length;

  const expiringEmployees = employees.filter((emp) =>
    emp.qualifications.some((q) => !q.isValid)
  );

  const activityData = [
    { hour: '00:00', incidents: 1, guards: 12, patrols: 28 },
    { hour: '04:00', incidents: 2, guards: 12, patrols: 34 },
    { hour: '08:00', incidents: 0, guards: 18, patrols: 18 },
    { hour: '12:00', incidents: 1, guards: 22, patrols: 22 },
    { hour: '16:00', incidents: 1, guards: 20, patrols: 26 },
    { hour: '20:00', incidents: 3, guards: 16, patrols: 40 },
    { hour: '23:59', incidents: 2, guards: 14, patrols: 35 },
  ];

  const siteWorkloadData = sites.map((s) => ({
    name: s.siteCode,
    kontrollpunkte: s.checkpointsCount,
    schluessel: s.keysCount,
    wachpersonal: s.activeGuardsRequired * 2
  }));

  return (
    <div className="space-y-6">
      {/* Tenant Context Bar */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Building className="w-4 h-4 text-brand-400" />
          <span className="text-slate-400">Aktiver Mandant:</span>
          <span className="font-bold text-white text-sm">{currentTenant.name}</span>
          <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-brand-500/10 text-brand-300 border border-brand-500/30">
            RLS-Schema: {currentTenant.rlsSchemaName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-400">Zertifikat: <strong className="text-emerald-400">{currentTenant.din77200CertificateNumber}</strong></span>
          <button
            onClick={() => onNavigate('tenants')}
            className="text-brand-400 hover:text-brand-300 font-semibold"
          >
            Mandanten wechseln / konfigurieren →
          </button>
        </div>
      </div>

      {/* Offline Alert Banner if offline or pending sync items */}
      {store.isOfflineMode && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-rose-200">
            <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              <strong>Offline-Betrieb aktiv:</strong> Alle Wachbucheinträge, Schichtübergaben und Kontrollen werden lokal in IndexedDB zwischengespeichert ({pendingSyncQueue.length} ausstehend).
            </span>
          </div>
          <button
            onClick={() => onNavigate('offlineSync')}
            className="text-xs px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold shrink-0"
          >
            Warteschlange prüfen
          </button>
        </div>
      )}

      {/* Top Banner Alert if Critical Issues exist */}
      {criticalIncidents > 0 && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-rose-950/80 to-slate-900 border border-rose-500/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-lg shadow-rose-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-rose-500 text-white animate-pulse">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">
                Achtung: {criticalIncidents} ungelöster kritischer Sicherheitsvorfall im Wachbuch!
              </h3>
              <p className="text-xs text-rose-200">
                Logistikzentrum Nord: Perimeterschutz-Durchtrennung erfordert Nachkontrolle und Spurensicherung.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate('wachbuch')}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
            >
              Wachbuch öffnen
            </button>
            <button
              onClick={onOpenAiAssistant}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              KI-Lagebericht
            </button>
          </div>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Active Guards */}
        <div
          onClick={() => onNavigate('employees')}
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-500/50 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Sicherheitsmitarbeiter</span>
            <div className="p-2 rounded-lg bg-brand-500/10 text-brand-400 group-hover:scale-110 transition-transform">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{activeEmployees}</span>
            <span className="text-xs text-emerald-400 font-medium">/ {employees.length} gesamt</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {expiringEmployees.length > 0 ? (
              <span className="text-amber-400 font-medium flex items-center gap-1">
                <FileWarning className="w-3 h-3" /> {expiringEmployees.length} Nachweise abgelaufen
              </span>
            ) : (
              <span className="text-emerald-400">Alle § 34a Nachweise gültig</span>
            )}
          </p>
        </div>

        {/* Card 2: Monitored Sites */}
        <div
          onClick={() => onNavigate('sites')}
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-brand-500/50 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Sicherheitsobjekte</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
              <MapPin className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{sites.length}</span>
            <span className="text-xs text-slate-400">Objekte aktiv</span>
          </div>
          <p className="text-[11px] text-cyan-400 mt-1">
            Isolierter Mandantenbestand
          </p>
        </div>

        {/* Card 3: Digital Logbook Incidents */}
        <div
          onClick={() => onNavigate('wachbuch')}
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-rose-500/50 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Offene Vorkommnisse</span>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{openIncidents}</span>
            <span className="text-xs text-rose-400 font-medium">{criticalIncidents} Kritisch</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {pendingSyncQueue.length > 0 ? (
              <span className="text-amber-400 font-medium">{pendingSyncQueue.length} lokale Einträge wartend</span>
            ) : (
              <span>Echtzeit-Synchronisation aktiv</span>
            )}
          </p>
        </div>

        {/* Card 4: Shift Status */}
        <div
          onClick={() => onNavigate('schedule')}
          className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-amber-500/50 transition-all cursor-pointer group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400 font-medium">Schichtstatus Heute</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{shifts.length - openShifts}</span>
            <span className="text-xs text-slate-400">/ {shifts.length} besetzt</span>
          </div>
          <p className="text-[11px] text-amber-400 mt-1">
            {openShifts} Schichten mit Konflikt/offen
          </p>
        </div>
      </div>

      {/* Main Charts & Telemetry Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 24h Security Telemetry Chart */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-sm">24h Einsatz- und Wachgang-Aktivität</h3>
              <p className="text-xs text-slate-400">Kontrollgänge und Vorkommnisse im 24-Stunden-Verlauf</p>
            </div>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              Live-Leitstelle
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="patrolColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2b5ea8" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#2b5ea8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="patrols"
                  name="Kontrollpunkte gescannt"
                  stroke="#38bdf8"
                  fillOpacity={1}
                  fill="url(#patrolColor)"
                />
                <Area
                  type="monotone"
                  dataKey="incidents"
                  name="Ereignismeldungen"
                  stroke="#f43f5e"
                  fill="#f43f5e"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Object Workload BarChart */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-white text-sm mb-1">Objekt-Infrastruktur</h3>
            <p className="text-xs text-slate-400 mb-4">Kontrollpunkte & Schlüsselvolumen je Objekt</p>
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={siteWorkloadData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#f8fafc',
                      fontSize: '12px'
                    }}
                  />
                  <Bar dataKey="kontrollpunkte" name="NFC/QR Kontrollpunkte" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="schluessel" name="Schlüssel im Bestand" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Schlüssel zurzeit im Umlauf:</span>
            <span className="font-bold text-amber-400">{keysOut} Bunde</span>
          </div>
        </div>
      </div>
    </div>
  );
};
