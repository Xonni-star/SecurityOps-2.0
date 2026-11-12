import React from 'react';
import {
  ShieldAlert,
  Users,
  Building2,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Key,
  ArrowUpRight,
  TrendingUp,
  FileWarning,
  Building
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';
import { useSecurityStore } from '../store';
import { buildActivitySeries, buildScheduledHoursBySite } from '../dashboardMetrics';

export const Dashboard: React.FC = () => {
  const {
    getTenantEmployees,
    getTenantSites,
    getTenantClients,
    getTenantShifts,
    getTenantGuardBook,
    getTenantKeys,
    getCurrentTenant,
    setActiveTab,
    isOnline
  } = useSecurityStore();

  const tenant = getCurrentTenant();
  const employees = getTenantEmployees();
  const sites = getTenantSites();
  const clients = getTenantClients();
  const shifts = getTenantShifts();
  const guardBook = getTenantGuardBook();
  const keys = getTenantKeys();
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayShifts = shifts.filter((shift) => shift.date === todayKey);

  const activeEmployees = employees.filter((e) => e.status === 'Aktiv').length;
  const sickEmployees = employees.filter((e) => e.status === 'Krank').length;
  const criticalIncidents = guardBook.filter((g) => g.priority === 'Kritisch' && !g.resolved);
  const issuedKeys = keys.filter((k) => k.status === 'Ausgegeben').length;
  const keyLossReports = keys.filter((k) => k.status === 'Verlustmeldung').length;

  const activityData = buildActivitySeries(guardBook, now);
  const siteHoursData = buildScheduledHoursBySite(shifts, sites, now);
  const totalPlannedHours = siteHoursData.reduce((sum, site) => sum + site.plannedHours, 0);
  const staffedShiftsToday = todayShifts.filter((shift) => shift.status !== 'Offen').length;

  const expiringQualifications = employees.flatMap((emp) =>
    emp.qualifications
      .filter((q) => {
        const exp = new Date(q.expiryDate).getTime();
        const now = new Date().getTime();
        const daysLeft = (exp - now) / (1000 * 3600 * 24);
        return daysLeft <= 90 || !q.verified;
      })
      .map((q) => ({ employeeName: `${emp.firstName} ${emp.lastName}`, qualification: q }))
  );

  return (
    <div className="space-y-6">
      {/* Top Banner with Active Tenant Identity */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-brand-950 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">{tenant.name}</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              {isOnline ? 'PostgreSQL Live (RLS Aktiv)' : 'Offline Cache aktiv'}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Mandanten-ID: <code className="text-blue-400">{tenant.id}</code> • Bewacherregister: <code className="text-slate-300">{tenant.bwrRegisterId}</code> • Lizenz: {tenant.licenseTier}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setActiveTab('guardbook')}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Wachbucheintrag erfassen</span>
          </button>
          <button
            onClick={() => setActiveTab('roster')}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700 transition flex items-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            <span>Dienstplan öffnen</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Active Guards */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Wachpersonal Mandant</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{activeEmployees}</span>
            <span className="text-xs text-slate-400">/ {employees.length} Gesamt</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
            <span className="text-amber-400 font-medium">{sickEmployees} Krank</span>
            <span>•</span>
            <span>{expiringQualifications.length} Qualifikationshinweise</span>
          </div>
        </div>

        {/* KPI 2: Monitored Sites */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Objekte unter Bewachung</span>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{sites.length}</span>
            <span className="text-xs text-slate-400">Standorte ({clients.length} Mandanten)</span>
          </div>
          <div className={`mt-2 text-[11px] ${tenant.din77200Certified ? 'text-emerald-400' : 'text-slate-400'}`}>
            {tenant.din77200Certified ? 'DIN 77200 Zertifizierung hinterlegt' : 'Keine DIN 77200 Zertifizierung hinterlegt'}
          </div>
        </div>

        {/* KPI 3: Shifts Coverage */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Schichtbesetzung Heute</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{staffedShiftsToday} / {todayShifts.length}</span>
            {todayShifts.some((shift) => shift.status === 'Offen') ? (
              <span className="text-xs text-rose-400 font-semibold">{todayShifts.filter((shift) => shift.status === 'Offen').length} Offen</span>
            ) : (
              <span className="text-xs text-emerald-400 font-semibold">Keine offenen Schichten</span>
            )}
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            Anzeige geplanter Schichten; keine Rechtskonformitätsprüfung
          </div>
        </div>

        {/* KPI 4: Security Hardware & Keys */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Ausgegebene Generalschlüssel</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Key className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{issuedKeys}</span>
            <span className="text-xs text-slate-400">von {keys.length} Medien</span>
          </div>
          <div className={`mt-2 text-[11px] ${keyLossReports > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
            {keyLossReports} Verlustmeldungen
          </div>
        </div>
      </div>

      {/* Critical Alert Bar if alarms exist */}
      {criticalIncidents.length > 0 && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-500/20 text-rose-400 rounded-lg animate-pulse">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-rose-200">
                Achtung: {criticalIncidents.length} ungelöster kritischer Vorfall für diesen Mandanten!
              </h4>
              <p className="text-xs text-rose-300/80">
                {criticalIncidents[0].title} ({criticalIncidents[0].siteName})
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('guardbook')}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow transition"
          >
            Zum Wachbuch
          </button>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                Wachbuchaktivität (letzte 24h)
              </h3>
              <p className="text-xs text-slate-500">Erfasste Kontrollgänge und meldepflichtige Ereignisse aus den Mandantendaten</p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="patrolColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="incidentColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke="#475569" fontSize={11} tickLine={false} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }} />
                <Area type="monotone" dataKey="patrols" name="Kontrollgang-Scans" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#patrolColor)" />
                <Area type="monotone" dataKey="incidents" name="Vorkommnisse" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#incidentColor)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Site Hours Distribution */}
        <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-200">Geplante Schichtstunden heute</h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">Summe der heute hinterlegten Schichtzeiten je Objekt</p>

            <div className="h-48 w-full">
              {siteHoursData.length === 0 ? <p className="pt-12 text-center text-xs text-slate-500">Keine Schichten für heute hinterlegt.</p> : <ResponsiveContainer width="100%" height="100%">
                <BarChart data={siteHoursData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#475569" fontSize={10} tickLine={false} />
                  <YAxis stroke="#475569" fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: '11px' }} />
                  <Bar dataKey="plannedHours" name="Geplante Std." fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-between text-xs text-slate-400">
            <span>Geplante Stunden:</span>
            <span className="font-semibold text-slate-200">{totalPlannedHours.toLocaleString('de-DE')} Std.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
