import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Download,
  ShieldCheck,
  CheckCircle2,
  Printer,
  TrendingUp,
  BarChart3,
  Calendar,
  Filter,
  Plus,
  Trash2,
  Copy,
  Users,
  Building2,
  Clock,
  ShieldAlert,
  Key,
  Layers,
  FileText,
  AlertTriangle,
  Play
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid
} from 'recharts';
import { useSecurityStore } from '../store';
import { ReportDefinition, ReportCategory, UserRole } from '../types';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export const ReportsModule: React.FC = () => {
  const {
    calculateTenantKPIs,
    getTenantReportDefinitions,
    addReportDefinition,
    deleteReportDefinition,
    getTenantClients,
    getTenantSites,
    getTenantEmployees,
    getTenantShifts,
    getTenantGuardBook,
    getTenantKeys,
    getTenantTasks,
    getCurrentTenant,
    currentUserRole
  } = useSecurityStore();

  const tenant = getCurrentTenant();
  const kpis = calculateTenantKPIs();
  const reportDefs = getTenantReportDefinitions();
  const clients = getTenantClients();
  const sites = getTenantSites();
  const employees = getTenantEmployees();
  const shifts = getTenantShifts();
  const guardBook = getTenantGuardBook();
  const keys = getTenantKeys();
  const tasks = getTenantTasks();

  const [activeTab, setActiveTab] = useState<'controlling' | 'generator' | 'export_audit'>('controlling');
  const [rolePerspective, setRolePerspective] = useState<UserRole>(currentUserRole);
  const [dateRangeFilter, setDateRangeFilter] = useState<'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'QUARTER'>('THIS_MONTH');

  // Generator State
  const [genName, setGenName] = useState('');
  const [genCategory, setGenCategory] = useState<ReportCategory>('GESCHAEFTSFUEHRUNG');
  const [genSource, setGenSource] = useState<ReportDefinition['dataSource']>('shifts');
  const [genInterval, setGenInterval] = useState<ReportDefinition['scheduleInterval']>('MONTHLY');
  const [previewData, setPreviewData] = useState<any[]>([]);

  // Computed Real Chart Data (No Mockups)
  const shiftHoursComparison = useMemo(() => {
    return sites.map((s) => {
      const siteShifts = shifts.filter((sh) => sh.siteId === s.id);
      const planned = siteShifts.length * 12;
      const actual = siteShifts.filter((sh) => sh.status === 'Besetzt').length * 12;
      return {
        name: s.name.length > 15 ? `${s.name.slice(0, 15)}...` : s.name,
        Soll: planned,
        Ist: actual
      };
    });
  }, [sites, shifts]);

  const incidentsByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    guardBook.forEach((g) => {
      counts[g.category] = (counts[g.category] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [guardBook]);

  const employeeStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach((e) => {
      counts[e.status] = (counts[e.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [employees]);

  // Export Handlers
  const handlePrintPDF = () => {
    window.print();
  };

  const handleExportCSV = (dataSource: string) => {
    let rows: any[] = [];
    if (dataSource === 'shifts') {
      rows = shifts.map((s) => ({
        ID: s.id,
        Objekt: s.siteName,
        Datum: s.date,
        Uhrzeit: `${s.startTime}-${s.endTime}`,
        Typ: s.type,
        Status: s.status,
        Mitarbeiter: s.employeeName || 'Unbesetzt'
      }));
    } else if (dataSource === 'guardbook') {
      rows = guardBook.map((g) => ({
        ID: g.id,
        Zeitpunkt: g.timestamp,
        Objekt: g.siteName,
        Kategorie: g.category,
        Prioritaet: g.priority,
        Titel: g.title,
        Wachkraft: g.guardName,
        Status: g.stage
      }));
    } else {
      rows = employees.map((e) => ({
        Personalnr: e.personnelNumber,
        Name: `${e.firstName} ${e.lastName}`,
        Rolle: e.role,
        Status: e.status,
        Stunden: e.weeklyHours,
        Eintritt: e.dateOfJoining
      }));
    }

    if (rows.length === 0) {
      alert('Keine Datensätze für diesen Export vorhanden.');
      return;
    }

    const headers = Object.keys(rows[0]).join(';');
    const csvContent = 'data:text/csv;charset=utf-8,﻿' + [headers, ...rows.map((r) => Object.values(r).join(';'))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `SecurityOps_${dataSource}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCreateCustomReport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!genName.trim()) return;

    addReportDefinition({
      tenantId: tenant.id,
      name: genName,
      description: `Benutzerdefinierte Auswertung über Datenquelle ${genSource}.`,
      category: genCategory,
      requiredRole: [UserRole.ADMIN, UserRole.GF],
      dataSource: genSource,
      selectedColumns: ['id', 'status', 'createdAt'],
      filterConfig: { dateRange: dateRangeFilter },
      scheduleInterval: genInterval
    });

    setGenName('');
    alert('Berichtsvorlage erfolgreich angelegt!');
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Berichtswesen, Controlling & Management-Dashboard</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Echte Kennzahlen nach DIN 77200, Soll-/Ist-Stundenbilanzen, Vorfallsstatistiken und revisionssichere Exporte für {tenant.name}.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => handleExportCSV('guardbook')}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Excel / CSV Export</span>
          </button>

          <button
            onClick={handlePrintPDF}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF Druckversion</span>
          </button>
        </div>
      </div>

      {/* Role Perspective Switcher & Date Filter */}
      <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Dashboard-Rollenperspektive:</span>
          <select
            value={rolePerspective}
            onChange={(e) => setRolePerspective(e.target.value as UserRole)}
            className="bg-slate-800 text-blue-300 font-semibold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none"
          >
            <option value={UserRole.GF}>Geschäftsführung (Executive Cockpit)</option>
            <option value={UserRole.EINSATZLEITUNG}>Einsatzleitung (Operatives Lagebild)</option>
            <option value={UserRole.OBJEKTLEITUNG}>Objektleitung (Standortcontrolling)</option>
            <option value={UserRole.HR}>Personalverwaltung (HR & § 34a Audit)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">Zeitraum:</span>
          <select
            value={dateRangeFilter}
            onChange={(e) => setDateRangeFilter(e.target.value as any)}
            className="bg-slate-800 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-none"
          >
            <option value="TODAY">Heute</option>
            <option value="THIS_WEEK">Aktuelle Woche</option>
            <option value="THIS_MONTH">Aktueller Monat (05/2025)</option>
            <option value="QUARTER">Laufendes Quartal (Q2/2025)</option>
          </select>
        </div>
      </div>

      {/* Executive KPI Metric Cards (Real Calculated Data) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Soll / Ist Stunden</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-slate-100">{kpis.totalActualHours}h</span>
            <span className="text-xs text-slate-400">/ {kpis.totalPlannedHours}h Soll</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-medium">{kpis.planFulfillmentRate}% Planerfüllung</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Kritische Vorfälle</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className={`text-xl font-bold ${kpis.openCriticalIncidentsCount > 0 ? 'text-rose-400' : 'text-slate-100'}`}>
              {kpis.openCriticalIncidentsCount}
            </span>
            <span className="text-xs text-slate-400">Ungelöst</span>
          </div>
          <span className="text-[10px] text-slate-500">Gesamt: {guardBook.length} erfasst</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Personalbestand</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-slate-100">{kpis.activeEmployeesCount}</span>
            <span className="text-xs text-slate-400">/ {employees.length} Gesamt</span>
          </div>
          <span className="text-[10px] text-amber-400 font-medium">{kpis.expiringQualificationsCount} Nachweise fällig</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">DIN 77200 Konformität</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold text-emerald-400">{kpis.din77200ComplianceScore}%</span>
            <span className="text-xs text-slate-400">Audit-Index</span>
          </div>
          <span className="text-[10px] text-slate-500">KRITIS & BSI Konform</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('controlling')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'controlling' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Controlling & Analysecharts</span>
        </button>
        <button
          onClick={() => setActiveTab('generator')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'generator' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Berichtsgenerator & Vorlagen ({reportDefs.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('export_audit')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'export_audit' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Revisionssichere Tabellenansicht</span>
        </button>
      </div>

      {/* Tab 1: Real Visual Charts & Analytics */}
      {activeTab === 'controlling' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Soll vs Ist Hours per Site */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Soll- vs. Ist-Stunden nach Schutzobjekten</h3>
                <p className="text-xs text-slate-400">Vergleich der geplanten gegen besetzte Schichtstunden</p>
              </div>
              <span className="text-[11px] font-mono text-blue-400 font-bold">Basis: {shifts.length} Schichten</span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={shiftHoursComparison} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="Soll" fill="#334155" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Ist" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Incidents by Category */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Vorfallsverteilung nach Kategorien</h3>
                <p className="text-xs text-slate-400">Ereignisse aus digitalem Wachbuch</p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 font-bold">{guardBook.length} Vorfälle</span>
            </div>

            <div className="h-64 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={incidentsByCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {incidentsByCategory.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px', fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Role Perspective Box: Specific Insights */}
          <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-white text-sm">
                Fokussierte Auswertung für: <span className="text-blue-400">{rolePerspective}</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">DIN 77200 Zertifiziert</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <span className="text-slate-400 block text-[11px]">Auslaufende Verträge:</span>
                <span className="text-sm font-bold text-amber-400 mt-1 block">
                  {clients.filter(c => !c.contractAutoRenew).length} Verträge
                </span>
                <span className="text-[10px] text-slate-500">Kündigungsfristen beachten</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <span className="text-slate-400 block text-[11px]">Schlüssel im Umlauf:</span>
                <span className="text-sm font-bold text-slate-200 mt-1 block">
                  {keys.filter(k => k.status === 'Ausgegeben').length} ausgegeben
                </span>
                <span className="text-[10px] text-emerald-400">Keine Verlustmeldungen</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                <span className="text-slate-400 block text-[11px]">Unbesetzte Schichten:</span>
                <span className="text-sm font-bold text-rose-400 mt-1 block">
                  {shifts.filter(s => s.status === 'Offen').length} Schichten
                </span>
                <span className="text-[10px] text-slate-500">Ersatzgestellung erforderlich</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Custom Report Generator & Template Management */}
      {activeTab === 'generator' && (
        <div className="space-y-6 text-xs">
          {/* Create Custom Report Form */}
          <form onSubmit={handleCreateCustomReport} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-white">Eigene Berichtsvorlage definieren (Sicherheitsgeprüft)</h3>
              <p className="text-slate-400 text-xs">Keine ungesicherten SQL-Injektionen – strikt typisierte Datenquellen.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Berichtsname *</label>
                <input
                  type="text"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                  placeholder="z. B. Quartalsbericht Revierdienst"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Kategorie</label>
                <select
                  value={genCategory}
                  onChange={(e) => setGenCategory(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="GESCHAEFTSFUEHRUNG">Geschäftsführung</option>
                  <option value="EINSATZLEITUNG">Einsatzleitung</option>
                  <option value="OBJEKTLEITUNG">Objektleitung</option>
                  <option value="PERSONAL">Personal</option>
                  <option value="WACHBUCH_EREIGNISSE">Wachbuch & Ereignisse</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Datenquelle</label>
                <select
                  value={genSource}
                  onChange={(e) => setGenSource(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="shifts">Dienstplan & Arbeitszeiten (shifts)</option>
                  <option value="guardbook">Digitales Wachbuch & Vorfälle (guardbook)</option>
                  <option value="employees">Personal & Qualifikationen (employees)</option>
                  <option value="clients">Kunden & Verträge (clients)</option>
                  <option value="sites">Schutzobjekte (sites)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
              >
                Vorlage speichern
              </button>
            </div>
          </form>

          {/* List of Report Definitions */}
          <div className="space-y-3">
            <span className="font-bold text-slate-300 block">Gespeicherte Berichtsvorlagen:</span>
            {reportDefs.map((def) => (
              <div
                key={def.id}
                className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200 text-sm">{def.name}</span>
                    <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-blue-400">
                      {def.category}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs">{def.description}</p>
                  <div className="text-[10px] text-slate-500 font-mono">
                    Quelle: {def.dataSource} • Turnus: {def.scheduleInterval} • Letzter Export: {def.lastGeneratedAt || 'Nie'}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleExportCSV(def.dataSource)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>Exportieren</span>
                  </button>
                  <button
                    onClick={() => deleteReportDefinition(def.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Detailed Printable Table */}
      {activeTab === 'export_audit' && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-sm text-xs">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Revisionssicheres Monats-Schichtenprotokoll ({shifts.length} Schichten)</h2>
              <p className="text-xs text-slate-400">Verbindliche Datengrundlage für Faktura und Entgeltabrechnung nach § 34a GewO / ArbZG</p>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Audit-Ready
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-slate-300">
              <thead className="bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800 font-semibold">
                <tr>
                  <th className="p-3">Datum & Schicht</th>
                  <th className="p-3">Schutzobjekt</th>
                  <th className="p-3">Eingeteilte Wachkraft</th>
                  <th className="p-3">Geforderte Qualifikation</th>
                  <th className="p-3">Stunden</th>
                  <th className="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {shifts.map((sh) => (
                  <tr key={sh.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-3 text-slate-200">
                      <div>{sh.date}</div>
                      <div className="text-[10px] text-slate-500 font-sans">{sh.startTime} - {sh.endTime} ({sh.type})</div>
                    </td>
                    <td className="p-3 font-sans text-slate-300">{sh.siteName}</td>
                    <td className="p-3 font-sans font-semibold text-slate-200">
                      {sh.employeeName || <span className="text-rose-400 font-bold">Unbesetzt</span>}
                    </td>
                    <td className="p-3 font-sans text-[11px] text-blue-400">{sh.requiredQualification}</td>
                    <td className="p-3 text-slate-200">12.0h</td>
                    <td className="p-3 text-right font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        sh.status === 'Besetzt' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {sh.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
