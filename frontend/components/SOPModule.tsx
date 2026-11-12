import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Archive, BookOpen, CheckCircle2, Clock3, FileCheck2, History,
  Plus, RefreshCw, Send, Users, X
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { SOPAssignment, SOPDocument, SOPVersion } from '../types';
import { useSecurityStore } from '../store';

type View = 'instructions' | 'dashboard' | 'reports';
type Filters = { query: string; status: string; due: 'all' | 'due' | 'overdue'; siteId: string; customerId: string };
type SOPForm = Pick<SOPDocument, 'sopNumber' | 'title' | 'category' | 'content' | 'siteId' | 'customerId' | 'mandatoryAcknowledgment'> & {
  description: string;
  effectiveFrom: string;
  effectiveUntil: string;
  dmsDocumentId: string;
};

const blankForm: SOPForm = {
  sopNumber: '', title: '', category: 'Allgemeine Dienstanweisung',
  description: '', content: '', siteId: '', customerId: '',
  effectiveFrom: '', effectiveUntil: '', dmsDocumentId: '', mandatoryAcknowledgment: true
};

const statusLabel: Record<string, string> = {
  draft: 'Entwurf', in_review: 'Zur Prüfung', changes_requested: 'Änderungen angefordert',
  reviewed: 'Geprüft', approved: 'Freigegeben', published: 'Veröffentlicht',
  withdrawn: 'Zurückgezogen', archived: 'Archiviert'
};

const normalizeStatus = (status?: string) => (status || 'published').toLowerCase().replaceAll(' ', '_');
const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('de-DE') : '–';

const mapVersion = (row: any): SOPVersion => ({
  id: row.id,
  version: row.version ?? row.version_number ?? '',
  title: row.title,
  content: row.content,
  changeReason: row.changeReason ?? row.change_reason ?? '',
  createdAt: row.createdAt ?? row.created_at ?? '',
  createdBy: row.createdBy ?? row.created_by_name ?? row.created_by
});

const mapAssignment = (row: any): SOPAssignment => ({
  id: row.id,
  type: row.type ?? row.target_type,
  targetId: row.targetId ?? row.target_id,
  targetName: row.targetName ?? row.target_name,
  status: row.status,
  dueAt: row.dueAt ?? row.due_at,
  acknowledgedAt: row.acknowledgedAt ?? row.acknowledged_at,
  employeeId: row.employeeId ?? row.employee_id,
  employeeName: row.employeeName ?? row.employee_name
});

export const SOPModule: React.FC = () => {
  const sops = useSecurityStore((state) => state.sops);
  const loadTenantData = useSecurityStore((state) => state.loadTenantData);
  const acknowledgeSOP = useSecurityStore((state) => state.acknowledgeSOP);
  const authUser = useSecurityStore((state) => state.authUser);
  const isOnline = useSecurityStore((state) => state.isOnline);
  const sites = useSecurityStore((state) => state.sites);
  const clients = useSecurityStore((state) => state.clients);
  const employees = useSecurityStore((state) => state.employees);
  const documents = useSecurityStore((state) => state.documents);
  const [view, setView] = useState<View>('instructions');
  const [filters, setFilters] = useState<Filters>({ query: '', status: 'all', due: 'all', siteId: '', customerId: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<SOPVersion[]>([]);
  const [assignments, setAssignments] = useState<SOPAssignment[]>([]);
  const [form, setForm] = useState<SOPForm>(blankForm);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [targetType, setTargetType] = useState<SOPAssignment['type']>('site');
  const [targetId, setTargetId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [reportFilters, setReportFilters] = useState({ customerId: '', siteId: '', employeeId: '', from: '', to: '', status: '' });
  const [reportRows, setReportRows] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [browserOnline, setBrowserOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [confirmationChecks, setConfirmationChecks] = useState<Record<string, boolean>>({});

  const permissions = authUser?.permissions || [];
  const can = (permission: string) => permissions.includes('sop:manage') ||
    permissions.includes('sop:*') || permissions.includes(permission);
  const canManage = ['sop:create', 'sop:update', 'sop:submit', 'sop:review', 'sop:approve', 'sop:publish', 'sop:assign', 'sop:archive']
    .some(can);
  const viewTabs: View[] = permissions.includes('sop:manage')
    ? ['instructions', 'dashboard', 'reports']
    : ['instructions', 'dashboard'];
  const selected = sops.find((sop) => sop.id === selectedId) || null;

  const reload = async () => {
    await loadTenantData();
  };

  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnline(true);
    };
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (view === 'dashboard' && can('sop:read')) {
      apiClient.get<any[]>('/sops/reminders').then(setReminders).catch((reason) => setError(reason.message || 'Erinnerungen konnten nicht geladen werden.'));
    }
  }, [view]);

  useEffect(() => {
    if (selectedId) {
      apiClient.get<any[]>(`/sops/${selectedId}/versions`)
        .then((rows) => setVersions(rows.map(mapVersion)))
        .catch((reason) => setError(reason.message || 'Der Versionsverlauf konnte nicht geladen werden.'));
      if (can('sop:assign') || can('sop:read')) {
        apiClient.get<any[]>(`/sops/${selectedId}/assignments`)
          .then((rows) => setAssignments(rows.map(mapAssignment)))
          .catch((reason) => setError(reason.message || 'Zuweisungen konnten nicht geladen werden.'));
      }
    } else {
      setVersions([]);
      setAssignments([]);
    }
  }, [selectedId]);

  const filteredSops = useMemo(() => {
    const now = Date.now();
    return sops.filter((sop) => {
      const text = `${sop.title} ${sop.sopNumber} ${sop.content}`.toLowerCase();
      const due = sop.dueAt ? new Date(sop.dueAt).getTime() : null;
      return (!filters.query || text.includes(filters.query.toLowerCase())) &&
        (filters.status === 'all' || normalizeStatus(sop.status) === filters.status) &&
        (!filters.siteId || sop.siteId === filters.siteId) &&
        (!filters.customerId || sop.customerId === filters.customerId) &&
        (filters.due === 'all' || (due !== null && (filters.due === 'overdue' ? due < now : due >= now)));
    });
  }, [sops, filters]);

  const runRequest = async (request: () => Promise<unknown>, success: string, refresh = true) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request();
      if (refresh) await reload();
      setNotice(success);
      return true;
    } catch (reason: any) {
      setError(reason?.message || 'Die Aktion ist fehlgeschlagen.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openSOP = (sop: SOPDocument) => {
    setSelectedId(sop.id);
    setNotice('');
    setError('');
  };

  const startNew = () => {
    setEditorOpen(true);
    setEditingId(null);
    setForm(blankForm);
    setChangeReason('');
  };

  const editSOP = (sop: SOPDocument) => {
    setEditorOpen(true);
    setEditingId(sop.id);
    setForm({
      sopNumber: sop.sopNumber, title: sop.title, category: sop.category,
      description: sop.description || '', content: sop.content, siteId: sop.siteId || '', customerId: sop.customerId || '',
      effectiveFrom: (sop.effectiveFrom || sop.effectiveDate || '').slice(0, 10),
      effectiveUntil: (sop.effectiveUntil || '').slice(0, 10),
      dmsDocumentId: sop.dmsDocumentId || '',
      mandatoryAcknowledgment: sop.mandatoryAcknowledgment
    });
    setChangeReason('');
  };

  const saveSOP = async (event: React.FormEvent) => {
    event.preventDefault();
    let saved = false;
    if (editingId && normalizeStatus(sops.find((sop) => sop.id === editingId)?.status) !== 'draft') {
      if (!changeReason.trim()) {
        setError('Für eine neue Version ist ein Änderungsgrund erforderlich.');
        return;
      }
      saved = await runRequest(
        () => apiClient.post(`/sops/${editingId}/versions`, { ...form, changeReason: changeReason.trim() }),
        'Neue Version wurde gespeichert.'
      );
    } else if (editingId) {
      saved = await runRequest(() => apiClient.patch(`/sops/${editingId}`, form), 'Entwurf wurde gespeichert.');
    } else {
      saved = await runRequest(() => apiClient.post('/sops', form), 'Dienstanweisung wurde als Entwurf angelegt.');
    }
    if (saved) {
      setEditingId(null);
      setForm(blankForm);
      setEditorOpen(false);
    }
  };

  const submitWorkflow = (action: string, body?: unknown, label = 'Workflow-Aktion abgeschlossen.') =>
    runRequest(() => apiClient.post(`/sops/${selected!.id}/${action}`, body ?? {}), label);

  const addAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || (targetType !== 'tenant' && !targetId)) return;
    await runRequest(
      () => apiClient.post(`/sops/${selected.id}/assignments`, {
        targets: [{ type: targetType, id: targetType === 'tenant' ? undefined : targetId }],
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {})
      }),
      'Zuweisung wurde gespeichert.'
    );
    try {
      setAssignments(await apiClient.get<SOPAssignment[]>(`/sops/${selected.id}/assignments`));
    } catch (reason: any) {
      setError(reason?.message || 'Zuweisungen konnten nicht aktualisiert werden.');
    }
  };

  const loadReport = async (event: React.FormEvent) => {
    event.preventDefault();
    const params = new URLSearchParams();
    Object.entries(reportFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    await runRequest(async () => setReportRows(await apiClient.get<any[]>(`/sops/reports${query ? `?${query}` : ''}`)), 'Bericht aktualisiert.', false);
  };

  const targetOptions = targetType === 'employee'
    ? employees.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}` }))
    : targetType === 'site'
      ? sites.map((item) => ({ id: item.id, name: item.name }))
      : clients.map((item) => ({ id: item.id, name: item.companyName }));

  const downloadLinkedDocument = async (documentId: string) => {
    const document = documents.find((item) => item.id === documentId && !item.archivedAt);
    if (!document) {
      setError('Das verknüpfte DMS-Dokument ist nicht verfügbar oder wurde archiviert.');
      return;
    }
    try {
      setError('');
      const blob = await apiClient.downloadFile(`/documents/${document.id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason: any) {
      setError(reason?.message || 'DMS-Dokument konnte nicht heruntergeladen werden.');
    }
  };

  const dueCounts = useMemo(() => {
    const now = Date.now();
    return {
      due: sops.filter((sop) => sop.dueAt && new Date(sop.dueAt).getTime() >= now && sop.currentUserAcknowledgment !== 'confirmed').length,
      overdue: sops.filter((sop) => sop.dueAt && new Date(sop.dueAt).getTime() < now && sop.currentUserAcknowledgment !== 'confirmed').length
    };
  }, [sops]);

  return (
    <main className="space-y-5 text-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileCheck2 className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Dienstanweisungen & Qualitätsmanagement</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">Verbindliche, versionierte Dienstanweisungen mit nachvollziehbarer Kenntnisnahme.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewTabs.map((tab) => (
            <button key={tab} onClick={() => { setView(tab); setError(''); }} className={`rounded-lg px-3 py-2 text-xs ${view === tab ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
              {tab === 'instructions' ? 'Anweisungen' : tab === 'dashboard' ? 'Mitarbeiter-Dashboard' : 'Berichte'}
            </button>
          ))}
          <button onClick={() => void reload()} disabled={busy} aria-label="Aktualisieren" className="rounded-lg bg-slate-800 p-2 text-slate-300 disabled:opacity-50"><RefreshCw className="h-4 w-4" /></button>
          {can('sop:create') && view === 'instructions' && <button onClick={startNew} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white"><Plus className="h-4 w-4" /> Neue Anweisung</button>}
        </div>
      </header>

      {(!isOnline || !browserOnline) && <div role="status" className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-200">Offline-Modus: Kenntnisnahmen werden nur lokal vorgemerkt und erst nach erfolgreicher Synchronisierung serverseitig bestätigt.</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-3 text-xs text-emerald-200">{notice}</div>}
      {error && <div role="alert" className="rounded-lg border border-red-700/50 bg-red-950/30 p-3 text-xs text-red-200">{error}</div>}

      {view === 'instructions' && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <input aria-label="Suche" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Titel, Nummer oder Inhalt suchen" className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm md:col-span-2" />
            <select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
              <option value="all">Alle Status</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select aria-label="Frist" value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value as Filters['due'] })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
              <option value="all">Alle Fristen</option><option value="due">Fällig</option><option value="overdue">Überfällig</option>
            </select>
            <select aria-label="Objekt filtern" value={filters.siteId} onChange={(event) => setFilters({ ...filters, siteId: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
              <option value="">Alle Objekte</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Kunde filtern" value={filters.customerId} onChange={(event) => setFilters({ ...filters, customerId: event.target.value })} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="">Alle Kunden</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}
            </select>
            <span className="rounded-full bg-amber-950/50 px-3 py-2 text-xs text-amber-200">Fällig: {dueCounts.due}</span>
            <span className="rounded-full bg-red-950/50 px-3 py-2 text-xs text-red-200">Überfällig: {dueCounts.overdue}</span>
          </div>

          {editorOpen && (editingId || can('sop:create')) && (
            <form onSubmit={saveSOP} className="rounded-xl border border-blue-800/50 bg-slate-900 p-4">
                  <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{editingId ? 'Dienstanweisung bearbeiten / versionieren' : 'Neue Dienstanweisung'}</h2><button type="button" onClick={() => { setEditingId(null); setForm(blankForm); setEditorOpen(false); }} aria-label="Formular schließen"><X className="h-4 w-4" /></button></div>
              <div className="grid gap-3 md:grid-cols-2">
                <input required aria-label="Anweisungsnummer" placeholder="Nummer, z. B. DA-OBJ-01" value={form.sopNumber} onChange={(event) => setForm({ ...form, sopNumber: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                <input required aria-label="Titel" placeholder="Titel" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                <select aria-label="Kategorie" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as SOPDocument['category'] })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm">
                  {['Objektbezogen', 'Allgemeine Dienstanweisung', 'Notfall-SOP', 'Arbeitssicherheit'].map((category) => <option key={category}>{category}</option>)}
                </select>
                <div className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.mandatoryAcknowledgment} onChange={(event) => setForm({ ...form, mandatoryAcknowledgment: event.target.checked })} /> Kenntnisnahme verpflichtend</div>
                <select aria-label="Kunde" value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm"><option value="">Allgemein / kein Kunde</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}</select>
                <select aria-label="Objekt" value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm"><option value="">Kein Objekt</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
                <textarea required aria-label="Inhalt" placeholder="Inhalt der Dienstanweisung" rows={5} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm md:col-span-2" />
                <textarea aria-label="Beschreibung" placeholder="Beschreibung / Zweck" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm md:col-span-2" />
                <label className="text-xs text-slate-400">Gültig ab<input aria-label="Gültig ab" type="date" value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" /></label>
                <label className="text-xs text-slate-400">Gültig bis<input aria-label="Gültig bis" type="date" value={form.effectiveUntil} onChange={(event) => setForm({ ...form, effectiveUntil: event.target.value })} className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" /></label>
                <label className="text-xs text-slate-400 md:col-span-2">Verknüpftes DMS-Dokument
                  <select aria-label="DMS-Dokument" value={form.dmsDocumentId} onChange={(event) => setForm({ ...form, dmsDocumentId: event.target.value })} className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200">
                    <option value="">Kein Dokument verknüpfen</option>
                    {documents.filter((document) => !document.archivedAt).map((document) => <option key={document.id} value={document.id}>{document.title} · {document.fileName}</option>)}
                  </select>
                  {!documents.some((document) => !document.archivedAt) && <span className="mt-1 block text-[11px]">Keine aktiven DMS-Dokumente im aktuellen Benutzerkontext verfügbar.</span>}
                </label>
                {editingId && normalizeStatus(sops.find((sop) => sop.id === editingId)?.status) !== 'draft' && <input required aria-label="Änderungsgrund" placeholder="Änderungsgrund für neue Version" value={changeReason} onChange={(event) => setChangeReason(event.target.value)} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm md:col-span-2" />}
              </div>
              <div className="mt-3 flex gap-2"><button disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-xs font-semibold disabled:opacity-50">Speichern</button><button type="button" onClick={() => { setEditingId(null); setForm(blankForm); setEditorOpen(false); }} className="rounded bg-slate-800 px-4 py-2 text-xs">Abbrechen</button></div>
            </form>
          )}

          {filteredSops.length === 0 ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">Keine Dienstanweisungen für diese Auswahl vorhanden.</div> :
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredSops.map((sop) => {
                const ack = sop.currentUserAcknowledgment || 'unacknowledged';
                return <article key={sop.id} className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
                  <div>
                    <div className="flex items-center justify-between"><span className="rounded bg-slate-800 px-2 py-1 font-mono text-[10px] font-bold text-blue-300">{sop.sopNumber}</span><span className="text-xs text-slate-400">v{sop.version} · {statusLabel[normalizeStatus(sop.status)] || sop.status}</span></div>
                    <h2 className="mt-3 text-sm font-bold">{sop.title}</h2>
                    <p className="mt-1 text-xs text-slate-400">{sop.category}{sop.siteId ? ` · ${sites.find((site) => site.id === sop.siteId)?.name || 'Objekt'}` : ''}{sop.customerId ? ` · ${clients.find((client) => client.id === sop.customerId)?.companyName || 'Kunde'}` : ''}</p>
                    {sop.description && <p className="mt-2 text-xs text-slate-300">{sop.description}</p>}
                    <div className="my-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs leading-relaxed text-slate-300">{sop.content}</div>
                    <p className="flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3.5 w-3.5" /> Frist: {dateLabel(sop.dueAt)} · Gültig: {dateLabel(sop.effectiveFrom || sop.effectiveDate)}{sop.effectiveUntil ? ` bis ${dateLabel(sop.effectiveUntil)}` : ''}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                    <span className={`flex items-center gap-1 text-xs ${ack === 'confirmed' ? 'text-emerald-300' : ack === 'pending' ? 'text-amber-300' : ack === 'stale' ? 'text-red-300' : 'text-slate-400'}`}>
                      {ack === 'confirmed' ? <CheckCircle2 className="h-4 w-4" /> : ack === 'pending' ? <Clock3 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                      {ack === 'confirmed' ? `Serverbestätigt${sop.acknowledgedAt ? ` · ${dateLabel(sop.acknowledgedAt)}` : ''}` : ack === 'pending' ? 'Offline vorgemerkt – Synchronisierung ausstehend' : ack === 'stale' ? 'Revision geändert – bitte erneut bestätigen' : 'Noch nicht bestätigt'}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openSOP(sop)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs">Details & Verlauf</button>
                      {can('sop:update') && ['draft', 'changes_requested'].includes(normalizeStatus(sop.status)) && <button onClick={() => editSOP(sop)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs">Bearbeiten</button>}
                      {can('sop:update') && normalizeStatus(sop.status) !== 'draft' && normalizeStatus(sop.status) !== 'archived' && <button onClick={() => editSOP(sop)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs">Neue Version</button>}
                      {ack !== 'confirmed' && ack !== 'pending' && sop.mandatoryAcknowledgment && <div className="flex flex-col items-start gap-2">
                        <label className="flex max-w-sm items-start gap-2 text-xs text-slate-200">
                          <input type="checkbox" checked={Boolean(confirmationChecks[sop.id])} onChange={(event) => setConfirmationChecks({ ...confirmationChecks, [sop.id]: event.target.checked })} />
                          <span>Ich habe diese Dienstanweisung gelesen und zur Kenntnis genommen.</span>
                        </label>
                        <button disabled={busy || !confirmationChecks[sop.id]} onClick={() => { setConfirmationChecks({ ...confirmationChecks, [sop.id]: false }); void acknowledgeSOP(sop.id); }} className="rounded-lg border border-blue-500/30 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-200 disabled:opacity-50">Kenntnisnahme bestätigen</button>
                      </div>}
                    </div>
                  </div>
                </article>;
              })}
            </div>}
        </section>
      )}

      {view === 'dashboard' && <section className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">Zugewiesene Anweisungen</p><p className="mt-2 text-2xl font-bold">{sops.length}</p></div>
          <div className="rounded-xl border border-amber-800/50 bg-slate-900 p-4"><p className="text-xs text-amber-300">Fällige Bestätigungen</p><p className="mt-2 text-2xl font-bold">{dueCounts.due}</p></div>
          <div className="rounded-xl border border-red-800/50 bg-slate-900 p-4"><p className="text-xs text-red-300">Überfällige Bestätigungen</p><p className="mt-2 text-2xl font-bold">{dueCounts.overdue}</p></div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-blue-300" /> Kenntnisnahmen & Erinnerungen</h2><button onClick={() => void apiClient.get<any[]>('/sops/reminders').then(setReminders).catch((reason) => setError(reason.message))} className="rounded bg-slate-800 px-3 py-1.5 text-xs">Erinnerungen aktualisieren</button></div>
          {reminders.length ? <div className="divide-y divide-slate-800">{reminders.map((item, index) => <div key={item.id || index} className="flex flex-wrap justify-between gap-2 py-3 text-xs"><span>{item.sop_title ?? item.title ?? 'Dienstanweisung'} · {item.employee_name ?? item.employeeName ?? 'Mitarbeiter'}</span><span className="text-amber-300">{item.status ?? (item.due_at ? `Frist ${dateLabel(item.due_at)}` : 'Offen')}</span></div>)}</div> : <p className="text-xs text-slate-400">Keine offenen Erinnerungen gemeldet.</p>}
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Meine Kenntnisnahmen</h2>
          <div className="divide-y divide-slate-800">{sops.map((sop) => <div key={sop.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
            <button onClick={() => openSOP(sop)} className="text-left font-medium hover:text-blue-300">{sop.sopNumber} · {sop.title}</button>
            <span className={sop.currentUserAcknowledgment === 'confirmed' ? 'text-emerald-300' : sop.currentUserAcknowledgment === 'pending' ? 'text-amber-300' : 'text-slate-400'}>
              {sop.currentUserAcknowledgment === 'confirmed' ? 'Serverbestätigt' : sop.currentUserAcknowledgment === 'pending' ? 'Offline vorgemerkt' : 'Offen'}
            </span>
            <span className="text-slate-400">Frist {dateLabel(sop.dueAt)}</span>
          </div>)}
            {!sops.length && <p className="py-2 text-xs text-slate-400">Keine zugewiesenen Dienstanweisungen.</p>}
          </div>
        </div>
      </section>}

      {view === 'reports' && <section className="space-y-4">
        <form onSubmit={loadReport} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-3">
          <select aria-label="Bericht Kunde" value={reportFilters.customerId} onChange={(event) => setReportFilters({ ...reportFilters, customerId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">Alle Kunden</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.companyName}</option>)}</select>
          <select aria-label="Bericht Objekt" value={reportFilters.siteId} onChange={(event) => setReportFilters({ ...reportFilters, siteId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">Alle Objekte</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
          <select aria-label="Bericht Mitarbeiter" value={reportFilters.employeeId} onChange={(event) => setReportFilters({ ...reportFilters, employeeId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">Alle Mitarbeiter</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select>
          <input aria-label="Von" type="date" value={reportFilters.from} onChange={(event) => setReportFilters({ ...reportFilters, from: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
          <input aria-label="Bis" type="date" value={reportFilters.to} onChange={(event) => setReportFilters({ ...reportFilters, to: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
          <select aria-label="Bericht Status" value={reportFilters.status} onChange={(event) => setReportFilters({ ...reportFilters, status: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-xs"><option value="">Alle Status</option><option value="acknowledged">Bestätigt</option><option value="pending">Offen</option><option value="overdue">Überfällig</option></select>
          <button disabled={busy} className="flex items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-xs font-semibold md:col-span-3"><BookOpen className="h-4 w-4" /> Bericht laden</button>
        </form>
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
          {reportRows.length ? <table className="w-full text-left text-xs"><thead className="bg-slate-800 text-slate-300"><tr>{['Dienstanweisung', 'Mitarbeiter', 'Objekt / Kunde', 'Status', 'Bestätigt am', 'Frist'].map((head) => <th key={head} className="p-3">{head}</th>)}</tr></thead><tbody>{reportRows.map((row, index) => <tr key={row.assignment_id || row.id || index} className="border-t border-slate-800"><td className="p-3">{row.sop_title ?? row.title ?? '–'}</td><td className="p-3">{row.employee_name ?? row.employeeName ?? '–'}</td><td className="p-3">{row.site_name ?? row.customer_name ?? '–'}</td><td className="p-3">{row.status ?? '–'}</td><td className="p-3">{dateLabel(row.acknowledged_at ?? row.acknowledgedAt)}</td><td className="p-3">{dateLabel(row.due_at ?? row.dueAt)}</td></tr>)}</tbody></table> : <p className="p-6 text-center text-xs text-slate-400">Filter auswählen und Bericht laden.</p>}
        </div>
      </section>}

      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={`Details ${selected.title}`}>
        <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-4"><div><p className="font-mono text-xs text-blue-300">{selected.sopNumber} · v{selected.version}</p><h2 className="mt-1 text-lg font-bold">{selected.title}</h2></div><button onClick={() => setSelectedId(null)} aria-label="Details schließen" className="rounded bg-slate-800 p-2"><X className="h-4 w-4" /></button></div>
          <div className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-sm leading-relaxed">{selected.content}</div>
          {selected.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{selected.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>Gültig ab {dateLabel(selected.effectiveFrom || selected.effectiveDate)}</span>
            {selected.effectiveUntil && <span>bis {dateLabel(selected.effectiveUntil)}</span>}
            {selected.dmsDocumentId && (() => {
              const document = documents.find((item) => item.id === selected.dmsDocumentId && !item.archivedAt);
              return document
                ? <button onClick={() => void downloadLinkedDocument(document.id)} className="rounded bg-blue-600/20 px-3 py-1.5 text-blue-200">DMS-Dokument öffnen: {document.title}</button>
                : <span className="text-amber-300">Verknüpftes DMS-Dokument nicht verfügbar.</span>;
            })()}
          </div>
          {canManage && <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-800 pb-4">
            {['draft', 'changes_requested'].includes(normalizeStatus(selected.status)) && can('sop:submit') && <button onClick={() => void submitWorkflow('submit', undefined, 'Zur Prüfung eingereicht.')} className="flex items-center gap-1 rounded bg-blue-700 px-3 py-2 text-xs"><Send className="h-3 w-3" /> Zur Prüfung</button>}
            {normalizeStatus(selected.status) === 'in_review' && can('sop:review') && <><input aria-label="Prüfkommentar" placeholder="Prüfkommentar" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} className="rounded bg-slate-950 px-2 text-xs" /><button onClick={() => void submitWorkflow('review', { decision: 'reviewed', comment: reviewComment }, 'Prüfung abgeschlossen.')} className="rounded bg-emerald-700 px-3 py-2 text-xs">Als geprüft markieren</button><button onClick={() => void submitWorkflow('review', { decision: 'changes_requested', comment: reviewComment }, 'Änderungen angefordert.')} className="rounded bg-amber-700 px-3 py-2 text-xs">Änderungen anfordern</button></>}
            {normalizeStatus(selected.status) === 'reviewed' && can('sop:approve') && <button onClick={() => void submitWorkflow('approve', undefined, 'Dienstanweisung freigegeben.')} className="rounded bg-emerald-700 px-3 py-2 text-xs">Freigeben</button>}
            {normalizeStatus(selected.status) === 'approved' && can('sop:publish') && <button onClick={() => void submitWorkflow('publish', undefined, 'Dienstanweisung veröffentlicht.')} className="rounded bg-blue-700 px-3 py-2 text-xs">Veröffentlichen</button>}
            {normalizeStatus(selected.status) === 'published' && can('sop:publish') && <button onClick={() => void submitWorkflow('withdraw', undefined, 'Dienstanweisung zurückgezogen.')} className="rounded bg-amber-700 px-3 py-2 text-xs">Zurückziehen</button>}
            {!['archived', 'withdrawn'].includes(normalizeStatus(selected.status)) && can('sop:archive') && <button onClick={() => void submitWorkflow('archive', undefined, 'Dienstanweisung archiviert.')} className="flex items-center gap-1 rounded bg-slate-700 px-3 py-2 text-xs"><Archive className="h-3 w-3" /> Archivieren</button>}
          </div>}
          {can('sop:assign') && <div className="mt-4 rounded-lg border border-slate-800 p-3"><h3 className="mb-2 text-sm font-semibold">Zuweisungen</h3><form onSubmit={addAssignment} className="flex flex-wrap gap-2">
            <select aria-label="Zuweisungstyp" value={targetType} onChange={(event) => { setTargetType(event.target.value as SOPAssignment['type']); setTargetId(''); }} className="rounded bg-slate-950 p-2 text-xs">{(['employee', 'site', 'customer', 'tenant'] as const).map((type) => <option key={type} value={type}>{type === 'employee' ? 'Mitarbeiter' : type === 'site' ? 'Objekt' : type === 'customer' ? 'Kunde' : 'Mandant'}</option>)}</select>
            {targetType !== 'tenant' && <select required aria-label="Ziel" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="min-w-40 rounded bg-slate-950 p-2 text-xs"><option value="">Ziel auswählen</option>{targetOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>}
            <input aria-label="Zuweisungsfrist" type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded bg-slate-950 p-2 text-xs" /><button className="rounded bg-blue-700 px-3 py-2 text-xs">Zuweisen</button>
          </form>
          <div className="mt-3 space-y-1 text-xs text-slate-400">{assignments.map((assignment) => <div key={assignment.id} className="flex justify-between gap-3"><span>{assignment.targetName || assignment.employeeName || `${assignment.type} ${assignment.targetId || ''}`}</span><span>{assignment.status || 'Offen'} · Frist {dateLabel(assignment.dueAt)}</span></div>)}{!assignments.length && <p>Noch keine Zuweisungen geladen.</p>}</div></div>}
          <div className="mt-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Versionen & Änderungsverlauf</h3><div className="space-y-2">{versions.map((version) => <div key={version.id} className="rounded-lg border border-slate-800 p-3 text-xs"><div className="flex justify-between"><strong>Version {version.version}</strong><span className="text-slate-400">{dateLabel(version.createdAt)} · {version.createdBy || ''}</span></div><p className="mt-1 text-slate-300">{version.changeReason}</p></div>)}{!versions.length && <p className="text-xs text-slate-400">Keine Versionen geladen.</p>}</div></div>
        </section>
      </div>}
    </main>
  );
};
