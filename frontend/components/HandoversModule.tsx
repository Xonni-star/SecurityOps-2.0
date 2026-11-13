import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, ClipboardCheck, Clock3, FileText,
  MessageSquareText, Plus, RefreshCw, Search, ShieldAlert, WifiOff, X
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { offlineVault, OutboxMutation } from '../services/indexedDbService';
import { useSecurityStore } from '../store';

type HandoverStatus =
  | 'pending_handover_confirmation'
  | 'pending_takeover_acknowledgement'
  | 'completed';

interface Handover {
  id: string;
  siteId: string;
  siteName: string;
  area?: string | null;
  shiftId?: string | null;
  occurredAt: string;
  generalText: string;
  incidents: string;
  importantNotes: string;
  safetyInformation: string;
  status: HandoverStatus;
  revisionVersion: number;
  clientMutationId: string;
  createdByUserId: string;
  createdByName: string;
  outgoingEmployeeId: string;
  outgoingEmployeeName: string;
  incomingEmployeeId: string;
  incomingEmployeeName: string;
  openTasksCount: number;
  createdTasksCount: number;
  documentCount: number;
}

interface HandoverTask {
  id: string;
  title: string;
  description: string;
  assigned_employee_id: string;
  assigned_employee_name: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at: string | null;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  revision_version: number;
  origin_handover_id: string;
  carried_forward: boolean;
}

interface HandoverEvent {
  id: string;
  action: string;
  details: Record<string, unknown>;
  occurred_at: string;
  actor_name: string;
}

interface HandoverDocument {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
}

interface HandoverListResponse {
  items: Handover[];
  total: number;
  limit: number;
  offset: number;
}

interface DashboardCounts {
  today: number;
  waiting_handover_confirmation: number;
  waiting_takeover_acknowledgement: number;
  open_handovers: number;
  open_tasks: number;
  overdue_tasks: number;
}

interface CreateForm {
  siteId: string;
  area: string;
  shiftId: string;
  occurredAt: string;
  outgoingEmployeeId: string;
  incomingEmployeeId: string;
  generalText: string;
  incidents: string;
  importantNotes: string;
  safetyInformation: string;
  taskTitle: string;
  taskDescription: string;
  taskAssignee: string;
  taskPriority: 'low' | 'normal' | 'high' | 'urgent';
  taskDueAt: string;
}

const emptyForm: CreateForm = {
  siteId: '',
  area: '',
  shiftId: '',
  occurredAt: new Date().toISOString().slice(0, 16),
  outgoingEmployeeId: '',
  incomingEmployeeId: '',
  generalText: '',
  incidents: '',
  importantNotes: '',
  safetyInformation: '',
  taskTitle: '',
  taskDescription: '',
  taskAssignee: '',
  taskPriority: 'normal',
  taskDueAt: ''
};

const statusLabels: Record<HandoverStatus, string> = {
  pending_handover_confirmation: 'Bestätigung der Übergabe offen',
  pending_takeover_acknowledgement: 'Übernahmebestätigung offen',
  completed: 'Abgeschlossen'
};

const eventLabels: Record<string, string> = {
  created: 'Übergabe angelegt',
  updated: 'Entwurf geändert',
  confirmed: 'Übergabe bestätigt',
  acknowledged: 'Übernahme bestätigt',
  question_added: 'Rückfrage dokumentiert',
  correction_added: 'Korrektur dokumentiert',
  task_created: 'Aufgabe angelegt',
  task_updated: 'Aufgabe geändert',
  document_linked: 'DMS-Nachweis verknüpft'
};

function localDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
}

function dateTimeForInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function statusStyle(status: HandoverStatus): string {
  if (status === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'pending_takeover_acknowledgement') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
}

function queueStatusLabel(status: OutboxMutation['status']): string {
  if (status === 'PENDING' || status === 'IN_TRANSIT') return 'Synchronisierung ausstehend';
  if (status === 'CONFLICT') return 'Konflikt';
  if (status === 'FAILED') return 'Fehlgeschlagen';
  return 'Synchronisiert';
}

export const HandoversModule: React.FC = () => {
  const {
    authUser, currentTenantId, isOnline, isSyncing, triggerManualSync,
    getTenantSites, getTenantEmployees, getTenantShifts, getTenantDocuments
  } = useSecurityStore();
  const sites = getTenantSites();
  const employees = getTenantEmployees();
  const shifts = getTenantShifts();
  const documents = getTenantDocuments();
  const permissions = authUser?.permissions ?? [];
  const canCreate = permissions.includes('handovers:create');
  const canUpdate = permissions.includes('handovers:update');
  const canConfirm = permissions.includes('handovers:confirm');
  const canManageTasks = permissions.includes('handovers:tasks');
  const canManage = permissions.includes('handovers:manage');
  const canReadDocuments = permissions.includes('documents:read');

  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<DashboardCounts>({
    today: 0, waiting_handover_confirmation: 0, waiting_takeover_acknowledgement: 0,
    open_handovers: 0, open_tasks: 0, overdue_tasks: 0
  });
  const [selectedId, setSelectedId] = useState('');
  const [tasks, setTasks] = useState<HandoverTask[]>([]);
  const [events, setEvents] = useState<HandoverEvent[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<HandoverDocument[]>([]);
  const [localMutations, setLocalMutations] = useState<OutboxMutation[]>([]);
  const [filter, setFilter] = useState({ search: '', siteId: '', status: '', openTasks: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState({
    area: '', generalText: '', incidents: '', importantNotes: '', safetyInformation: ''
  });
  const [taskForm, setTaskForm] = useState({
    title: '', description: '', assignedEmployeeId: '', priority: 'normal' as HandoverTask['priority'], dueAt: ''
  });
  const [noteText, setNoteText] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = handovers.find(handover => handover.id === selectedId);
  const selectedOutgoingEmployee = employees.find(employee => employee.id === selected?.outgoingEmployeeId);
  const selectedIncomingEmployee = employees.find(employee => employee.id === selected?.incomingEmployeeId);
  const canConfirmHandover = Boolean(canConfirm && selectedOutgoingEmployee?.email &&
    selectedOutgoingEmployee.email.toLowerCase() === authUser?.email.toLowerCase());
  const canAcknowledgeHandover = Boolean(canConfirm && selectedIncomingEmployee?.email &&
    selectedIncomingEmployee.email.toLowerCase() === authUser?.email.toLowerCase());

  const listQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: '50', offset: String(page * 50) });
    if (filter.search) params.set('search', filter.search);
    if (filter.siteId) params.set('siteId', filter.siteId);
    if (filter.status) params.set('status', filter.status);
    if (filter.openTasks) params.set('openTasks', filter.openTasks);
    if (filter.from) params.set('from', filter.from);
    if (filter.to) params.set('to', filter.to);
    return params.toString();
  }, [filter, page]);

  const refreshLocalMutations = useCallback(async () => {
    if (!currentTenantId) return;
    try {
      const records = await offlineVault.getOutbox(currentTenantId, 'handover');
      setLocalMutations(records.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
      setStorageError('');
    } catch (loadError) {
      setStorageError(loadError instanceof Error ? loadError.message : 'Lokaler Übergabespeicher ist nicht verfügbar.');
    }
  }, [currentTenantId]);

  const refreshList = useCallback(async () => {
    if (!permissions.includes('handovers:read')) return;
    setError('');
    const siteQuery = filter.siteId ? `?siteId=${encodeURIComponent(filter.siteId)}` : '';
    try {
      const [list, dashboard] = await Promise.all([
        apiClient.get<HandoverListResponse>(`/handovers?${listQuery}`),
        apiClient.get<DashboardCounts>(`/handovers/dashboard${siteQuery}`)
      ]);
      setHandovers(list.items);
      setTotal(list.total);
      setCounts(dashboard);
      setSelectedId(current => list.items.some(item => item.id === current) ? current : (list.items[0]?.id || ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Übergaben konnten nicht geladen werden.');
    }
  }, [filter.siteId, listQuery, permissions]);

  const refreshDetails = useCallback(async (handoverId: string) => {
    if (!handoverId) {
      setTasks([]);
      setEvents([]);
      setLinkedDocuments([]);
      return;
    }
    try {
      const [taskResult, eventResult, documentResult] = await Promise.all([
        apiClient.get<HandoverTask[]>(`/handovers/${handoverId}/tasks`),
        apiClient.get<{ items: HandoverEvent[] }>(`/handovers/${handoverId}/events?limit=50`),
        canReadDocuments ? apiClient.get<HandoverDocument[]>(`/handovers/${handoverId}/documents`) : Promise.resolve([])
      ]);
      setTasks(taskResult);
      setEvents(eventResult.items);
      setLinkedDocuments(documentResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Details zur Übergabe konnten nicht geladen werden.');
    }
  }, [canReadDocuments]);

  useEffect(() => {
    void refreshList();
    void refreshLocalMutations();
  }, [refreshList, refreshLocalMutations, isSyncing]);

  useEffect(() => {
    void refreshDetails(selectedId);
  }, [refreshDetails, selectedId, isSyncing]);

  useEffect(() => {
    setForm(current => ({
      ...current,
      siteId: current.siteId || sites[0]?.id || '',
      outgoingEmployeeId: current.outgoingEmployeeId || employees[0]?.id || '',
      incomingEmployeeId: current.incomingEmployeeId || employees.find(item => item.id !== employees[0]?.id)?.id || '',
      taskAssignee: current.taskAssignee || employees[0]?.id || ''
    }));
  }, [employees, sites]);

  const submitHandover = async (event: FormEvent) => {
    event.preventDefault();
    if (!authUser || !form.siteId || !form.outgoingEmployeeId || !form.incomingEmployeeId) {
      setError('Objekt und beide beteiligten Mitarbeitenden müssen ausgewählt sein.');
      return;
    }
    if (form.outgoingEmployeeId === form.incomingEmployeeId) {
      setError('Übergebende und übernehmende Person müssen verschieden sein.');
      return;
    }
    const clientMutationId = crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    const payload = {
      siteId: form.siteId,
      area: form.area || null,
      shiftId: form.shiftId || null,
      occurredAt: new Date(form.occurredAt).toISOString(),
      outgoingEmployeeId: form.outgoingEmployeeId,
      incomingEmployeeId: form.incomingEmployeeId,
      generalText: form.generalText,
      incidents: form.incidents,
      importantNotes: form.importantNotes,
      safetyInformation: form.safetyInformation,
      capturedAt,
      clientMutationId,
      tasks: form.taskTitle.trim() ? [{
        title: form.taskTitle.trim(),
        description: form.taskDescription,
        assignedEmployeeId: form.taskAssignee || form.incomingEmployeeId,
        priority: form.taskPriority,
        dueAt: form.taskDueAt ? new Date(form.taskDueAt).toISOString() : null
      }] : []
    };

    setBusy(true);
    setError('');
    setNotice('');
    try {
      await offlineVault.enqueueMutation({
        id: clientMutationId,
        tenantId: currentTenantId,
        userId: authUser.id,
        entityType: 'handover',
        action: 'CREATE',
        payload,
        occurredAt: capturedAt,
        baseVersion: 1
      });
      setNotice(isOnline
        ? 'Lokal gespeichert. Die Serverbestätigung steht noch aus.'
        : 'Offline in der IndexedDB gespeichert. Die Serverbestätigung steht noch aus.');
      setForm({ ...emptyForm, siteId: form.siteId, occurredAt: new Date().toISOString().slice(0, 16) });
      setIsCreateOpen(false);
      await refreshLocalMutations();
      if (isOnline) {
        await triggerManualSync();
        await refreshList();
        await refreshLocalMutations();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Übergabe konnte nicht sicher lokal gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (type: 'confirm' | 'acknowledge') => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/handovers/${selected.id}/${type}`, {
        clientMutationId: crypto.randomUUID(),
        capturedAt: new Date().toISOString()
      });
      setNotice(type === 'confirm' ? 'Übergabe wurde vom Server bestätigt.' : 'Übernahme wurde vom Server bestätigt.');
      await refreshList();
      await refreshDetails(selected.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Bestätigung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/handovers/${selected.id}`, {
        expectedVersion: selected.revisionVersion,
        area: editFields.area || null,
        generalText: editFields.generalText,
        incidents: editFields.incidents,
        importantNotes: editFields.importantNotes,
        safetyInformation: editFields.safetyInformation
      });
      setIsEditing(false);
      setNotice('Übergabeänderung wurde als neue Revision gespeichert.');
      await refreshList();
      await refreshDetails(selected.id);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Änderung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const addTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !taskForm.title.trim() || !taskForm.assignedEmployeeId) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/handovers/${selected.id}/tasks`, {
        title: taskForm.title.trim(),
        description: taskForm.description,
        assignedEmployeeId: taskForm.assignedEmployeeId,
        priority: taskForm.priority,
        dueAt: taskForm.dueAt ? new Date(taskForm.dueAt).toISOString() : null
      });
      setTaskForm({ title: '', description: '', assignedEmployeeId: '', priority: 'normal', dueAt: '' });
      setNotice('Aufgabe wurde serverseitig angelegt und bleibt objektbezogen offen.');
      await refreshList();
      await refreshDetails(selected.id);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Aufgabe konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const updateTask = async (task: HandoverTask) => {
    const nextStatus = task.status === 'open' ? 'in_progress' : task.status === 'in_progress' ? 'done' : null;
    if (!selected || !nextStatus) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/handover-tasks/${task.id}`, {
        expectedVersion: task.revision_version,
        status: nextStatus
      });
      await refreshList();
      await refreshDetails(selected.id);
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'Aufgabenstatus konnte nicht aktualisiert werden.');
    } finally {
      setBusy(false);
    }
  };

  const addNote = async (type: 'questions' | 'corrections') => {
    if (!selected || !noteText.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/handovers/${selected.id}/${type}`, { text: noteText.trim() });
      setNoteText('');
      setNotice(type === 'questions' ? 'Rückfrage wurde in der Historie dokumentiert.' : 'Korrektur wurde in der Historie dokumentiert; bestätigte Inhalte bleiben unverändert.');
      await refreshDetails(selected.id);
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : 'Eintrag konnte nicht dokumentiert werden.');
    } finally {
      setBusy(false);
    }
  };

  const linkDocument = async () => {
    if (!selected || !documentId) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/handovers/${selected.id}/documents`, { documentId });
      setDocumentId('');
      setNotice('Bestehendes DMS-Dokument wurde ohne Dateiduplikat verknüpft.');
      await refreshList();
      await refreshDetails(selected.id);
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : 'DMS-Verknüpfung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const retrySync = async () => {
    setBusy(true);
    try {
      await triggerManualSync();
      await refreshList();
      await refreshLocalMutations();
    } finally {
      setBusy(false);
    }
  };

  if (!permissions.includes('handovers:read')) {
    return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">Für das Übergabemanagement fehlt die Berechtigung <code>handovers:read</code>.</div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-blue-300">
            <ClipboardCheck className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-wide">Übergabemanagement</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">Übergaben & offene Punkte</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Objektbezogene Protokolle mit getrennten Bestätigungen, fortgeführten Aufgaben und unveränderlicher Historie.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void retrySync()} disabled={!isOnline || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50">
            {isOnline ? <RefreshCw className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            Synchronisieren
          </button>
          {canCreate && <button type="button" onClick={() => setIsCreateOpen(value => !value)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500">
            <Plus className="h-4 w-4" /> Neue Übergabe
          </button>}
        </div>
      </header>

      <div className={`rounded-xl border px-3 py-2 text-xs ${isOnline ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
        {isOnline
          ? 'Online. Neue Erfassungen werden zuerst lokal gesichert und erst nach API-Quittung als synchronisiert angezeigt.'
          : 'Offline. Neue Erfassungen bleiben in der IndexedDB und sind noch nicht serverseitig bestätigt.'}
        {' '}Es ist kein externer E-Mail- oder Push-Dienst konfiguriert.
      </div>

      {(error || storageError) && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error || storageError}</span>
      </div>}
      {notice && <div role="status" className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">{notice}</div>}

      <section aria-label="Übergabe-Kennzahlen" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Heute', counts.today, 'text-blue-300'],
          ['Offene Übergaben', counts.open_handovers, 'text-amber-300'],
          ['Bestätigung Übergabe', counts.waiting_handover_confirmation, 'text-indigo-300'],
          ['Offene Aufgaben', counts.open_tasks, 'text-cyan-300'],
          ['Überfällige Aufgaben', counts.overdue_tasks, 'text-rose-300']
        ].map(([label, value, color]) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-[11px] text-slate-400">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
        </div>)}
      </section>

      {isCreateOpen && <form onSubmit={submitHandover} className="space-y-4 rounded-2xl border border-blue-500/30 bg-slate-900/80 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-white">Übergabe erfassen</h2>
          <button type="button" onClick={() => setIsCreateOpen(false)} aria-label="Formular schließen" className="rounded p-1 text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-slate-300">Objekt *
            <select required value={form.siteId} onChange={event => setForm({ ...form, siteId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
              <option value="">Objekt wählen</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-300">Bereich
            <input value={form.area} onChange={event => setForm({ ...form, area: event.target.value })} maxLength={150} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-300">Datum und Uhrzeit *
            <input required type="datetime-local" value={form.occurredAt} onChange={event => setForm({ ...form, occurredAt: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-300">Übergebende Person *
            <select required value={form.outgoingEmployeeId} onChange={event => setForm({ ...form, outgoingEmployeeId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
              <option value="">Person wählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-300">Übernehmende Person *
            <select required value={form.incomingEmployeeId} onChange={event => setForm({ ...form, incomingEmployeeId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
              <option value="">Person wählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-300">Dienst (optional)
            <select value={form.shiftId} onChange={event => setForm({ ...form, shiftId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
              <option value="">Kein Dienst zugeordnet</option>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.shiftDate} · {shift.startTime}–{shift.endTime}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {([
            ['generalText', 'Allgemeiner Übergabetext'],
            ['incidents', 'Besondere Vorkommnisse'],
            ['importantNotes', 'Wichtige Hinweise'],
            ['safetyInformation', 'Sicherheitsrelevante Informationen']
          ] as const).map(([field, label]) => <label key={field} className="text-xs text-slate-300">{label}
            <textarea rows={3} value={form[field]} onChange={event => setForm({ ...form, [field]: event.target.value })} maxLength={10000} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
          </label>)}
        </div>
        <details className="rounded-xl border border-slate-800 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-200">Offene Aufgabe mit dieser Übergabe anlegen (optional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-300">Bezeichnung
              <input value={form.taskTitle} onChange={event => setForm({ ...form, taskTitle: event.target.value })} maxLength={255} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-300">Zuständig
              <select value={form.taskAssignee} onChange={event => setForm({ ...form, taskAssignee: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
                <option value="">Übernehmende Person verwenden</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-300">Priorität
              <select value={form.taskPriority} onChange={event => setForm({ ...form, taskPriority: event.target.value as CreateForm['taskPriority'] })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm">
                <option value="low">Niedrig</option><option value="normal">Normal</option><option value="high">Hoch</option><option value="urgent">Dringend</option>
              </select>
            </label>
            <label className="text-xs text-slate-300">Fälligkeit
              <input type="datetime-local" value={form.taskDueAt} onChange={event => setForm({ ...form, taskDueAt: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-300 sm:col-span-2">Beschreibung
              <textarea rows={2} value={form.taskDescription} onChange={event => setForm({ ...form, taskDescription: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm" />
            </label>
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">Lokale Erfassung erfolgt vor dem Versand. Ohne API-Quittung bleibt der Status ausstehend.</span>
          <button type="submit" disabled={busy || !canCreate || !sites.length || employees.length < 2}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Speichern…' : 'Übergabe lokal sichern'}
          </button>
        </div>
      </form>}

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60">
        <div className="grid gap-2 border-b border-slate-800 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="relative sm:col-span-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
            <input aria-label="Übergaben durchsuchen" placeholder="Objekt, Person, Text…" value={filter.search} onChange={event => { setPage(0); setFilter({ ...filter, search: event.target.value }); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm" />
          </label>
          <select aria-label="Nach Objekt filtern" value={filter.siteId} onChange={event => { setPage(0); setFilter({ ...filter, siteId: event.target.value }); }} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
            <option value="">Alle Objekte</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <select aria-label="Nach Status filtern" value={filter.status} onChange={event => { setPage(0); setFilter({ ...filter, status: event.target.value }); }} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
            <option value="">Alle Status</option><option value="pending_handover_confirmation">Übergabebestätigung offen</option><option value="pending_takeover_acknowledgement">Übernahmebestätigung offen</option><option value="completed">Abgeschlossen</option>
          </select>
          <select aria-label="Nach offenen Aufgaben filtern" value={filter.openTasks} onChange={event => { setPage(0); setFilter({ ...filter, openTasks: event.target.value }); }} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm">
            <option value="">Alle Aufgabenstände</option><option value="true">Mit offenen Aufgaben</option><option value="false">Ohne offene Aufgaben</option>
          </select>
          <div className="flex gap-2 lg:col-span-6">
            <label className="flex-1 text-[10px] text-slate-500">Von <input type="date" value={filter.from} onChange={event => { setPage(0); setFilter({ ...filter, from: event.target.value }); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200" /></label>
            <label className="flex-1 text-[10px] text-slate-500">Bis <input type="date" value={filter.to} onChange={event => { setPage(0); setFilter({ ...filter, to: event.target.value }); }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200" /></label>
          </div>
        </div>

        <div className="grid min-h-[24rem] lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.4fr)]">
          <div className="divide-y divide-slate-800 lg:border-r lg:border-slate-800">
            {handovers.map(handover => <button key={handover.id} type="button" onClick={() => { setSelectedId(handover.id); setIsEditing(false); }}
              className={`w-full p-4 text-left transition hover:bg-slate-800/50 ${selectedId === handover.id ? 'bg-blue-500/10' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-white">{handover.siteName}{handover.area ? ` · ${handover.area}` : ''}</div>
                  <div className="mt-1 text-xs text-slate-400">{localDateTime(handover.occurredAt)}</div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[10px] ${statusStyle(handover.status)}`}>{statusLabels[handover.status]}</span>
              </div>
              <div className="mt-2 text-xs text-slate-300">{handover.outgoingEmployeeName} → {handover.incomingEmployeeName}</div>
              <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
                <span>{handover.openTasksCount} offen am Objekt</span><span>{handover.documentCount} Nachweise</span>
              </div>
            </button>)}
            {!handovers.length && <div className="p-6 text-center text-sm text-slate-500">{error ? 'Übergaben sind nicht verfügbar.' : 'Keine Übergaben für diese Filter.'}</div>}
            <div className="flex items-center justify-between p-3 text-xs text-slate-500">
              <span>{total} Treffer · Seite {page + 1}</span>
              <div className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage(current => current - 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Zurück</button>
                <button type="button" disabled={(page + 1) * 50 >= total} onClick={() => setPage(current => current + 1)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Weiter</button>
              </div>
            </div>
          </div>

          <div className="min-w-0 p-4">
            {!selected && <div className="flex h-full min-h-64 items-center justify-center text-sm text-slate-500">Übergabe auswählen, um Protokoll und Aufgaben zu sehen.</div>}
            {selected && <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500">Übergabe vom {localDateTime(selected.occurredAt)}</div>
                  <h2 className="mt-1 text-lg font-bold text-white">{selected.siteName}{selected.area ? ` · ${selected.area}` : ''}</h2>
                  <div className="mt-1 text-xs text-slate-400">Erstellt von {selected.createdByName} · Revision {selected.revisionVersion}</div>
                </div>
                <span className={`rounded-full border px-2.5 py-1.5 text-xs ${statusStyle(selected.status)}`}>{statusLabels[selected.status]}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
                  <div className="text-[11px] text-slate-500">Übergebende Person</div><div className="mt-1 text-slate-200">{selected.outgoingEmployeeName}</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm">
                  <div className="text-[11px] text-slate-500">Übernehmende Person</div><div className="mt-1 text-slate-200">{selected.incomingEmployeeName}</div>
                </div>
              </div>

              {isEditing ? <form onSubmit={saveEdit} className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="text-xs text-amber-200">Entwurf ändern – jede Änderung wird als neue Revision protokolliert.</div>
                <input aria-label="Bereich bearbeiten" value={editFields.area} onChange={event => setEditFields({ ...editFields, area: event.target.value })} placeholder="Bereich" className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                {([
                  ['generalText', 'Allgemeiner Übergabetext'],
                  ['incidents', 'Besondere Vorkommnisse'],
                  ['importantNotes', 'Wichtige Hinweise'],
                  ['safetyInformation', 'Sicherheitsinformationen']
                ] as const).map(([field, label]) => <label key={field} className="block text-xs text-slate-400">{label}
                  <textarea rows={2} value={editFields[field]} onChange={event => setEditFields({ ...editFields, [field]: event.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm text-slate-200" />
                </label>)}
                <div className="flex gap-2"><button disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold">Änderung speichern</button><button type="button" onClick={() => setIsEditing(false)} className="rounded border border-slate-700 px-3 py-1.5 text-xs">Abbrechen</button></div>
              </form> : <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['generalText', 'Allgemeiner Übergabetext'],
                  ['incidents', 'Besondere Vorkommnisse'],
                  ['importantNotes', 'Wichtige Hinweise'],
                  ['safetyInformation', 'Sicherheitsrelevante Informationen']
                ] as const).map(([field, label]) => <div key={field} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <div className="text-[11px] font-medium text-slate-500">{label}</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{selected[field] || '–'}</p>
                </div>)}
              </div>}

              {selected.status === 'pending_handover_confirmation' && <div className="flex flex-wrap gap-2">
                {canUpdate && <button type="button" onClick={() => {
                  setEditFields({ area: selected.area || '', generalText: selected.generalText, incidents: selected.incidents, importantNotes: selected.importantNotes, safetyInformation: selected.safetyInformation });
                  setIsEditing(true);
                }} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200">Entwurf bearbeiten</button>}
                {canConfirmHandover && <button type="button" disabled={busy || !isOnline} onClick={() => void confirm('confirm')} className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Übergabe bestätigen</button>}
                {canConfirm && !canConfirmHandover && <span className="self-center text-xs text-slate-500">Bestätigung nur durch das zugeordnete Mitarbeiterkonto.</span>}
              </div>}
              {selected.status === 'pending_takeover_acknowledgement' && <div className="flex flex-wrap gap-2">
                {canAcknowledgeHandover && <button type="button" disabled={busy || !isOnline} onClick={() => void confirm('acknowledge')} className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Übernahme bestätigen</button>}
                {canConfirm && !canAcknowledgeHandover && <span className="self-center text-xs text-slate-500">Übernahmebestätigung nur durch das zugeordnete Mitarbeiterkonto.</span>}
              </div>}

              <section className="space-y-3 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><CalendarClock className="h-4 w-4 text-cyan-300" />Offene Aufgaben am Objekt</h3>
                  <span className="text-xs text-slate-500">{tasks.filter(task => ['open', 'in_progress'].includes(task.status)).length} offen</span>
                </div>
                {tasks.map(task => <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-200">
                      <span>{task.title}</span>
                      {task.carried_forward && <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">Weitergeführt</span>}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{task.priority}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{task.assigned_employee_name}{task.due_at ? ` · fällig ${localDateTime(task.due_at)}` : ''} · {task.status}</div>
                    {task.description && <p className="mt-1 text-xs text-slate-400">{task.description}</p>}
                  </div>
                  {canManageTasks && task.status !== 'done' && task.status !== 'cancelled' &&
                    <button type="button" disabled={busy || !isOnline} onClick={() => void updateTask(task)} className="rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 disabled:opacity-50">
                      {task.status === 'open' ? 'In Bearbeitung' : 'Erledigt'}
                    </button>}
                </div>)}
                {!tasks.length && <div className="text-xs text-slate-500">Keine Aufgaben mit dieser Übergabe verknüpft.</div>}
                {canManageTasks && isOnline && <form onSubmit={addTask} className="grid gap-2 rounded-xl border border-slate-800 p-3 sm:grid-cols-2">
                  <input required aria-label="Aufgabenbezeichnung" placeholder="Aufgabe anlegen…" value={taskForm.title} onChange={event => setTaskForm({ ...taskForm, title: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                  <select required aria-label="Aufgabenzuständige Person" value={taskForm.assignedEmployeeId} onChange={event => setTaskForm({ ...taskForm, assignedEmployeeId: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm">
                    <option value="">Zuständige Person wählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
                  </select>
                  <input aria-label="Aufgabenbeschreibung" placeholder="Beschreibung" value={taskForm.description} onChange={event => setTaskForm({ ...taskForm, description: event.target.value })} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                  <div className="flex gap-2">
                    <select aria-label="Aufgabenpriorität" value={taskForm.priority} onChange={event => setTaskForm({ ...taskForm, priority: event.target.value as HandoverTask['priority'] })} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-sm">
                      <option value="low">Niedrig</option><option value="normal">Normal</option><option value="high">Hoch</option><option value="urgent">Dringend</option>
                    </select>
                    <input aria-label="Aufgabenfälligkeit" type="datetime-local" value={taskForm.dueAt} onChange={event => setTaskForm({ ...taskForm, dueAt: event.target.value })} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-sm" />
                    <button disabled={busy} className="rounded bg-cyan-700 px-3 text-xs font-semibold text-white">Hinzufügen</button>
                  </div>
                </form>}
              </section>

              {canReadDocuments && <section className="space-y-2 border-t border-slate-800 pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><FileText className="h-4 w-4 text-blue-300" />DMS-Nachweise</h3>
                {linkedDocuments.map(document => <div key={document.id} className="text-xs text-slate-300">{document.title} <span className="text-slate-600">({document.mime_type}, {document.size_bytes} Bytes)</span></div>)}
                {!linkedDocuments.length && <div className="text-xs text-slate-500">Keine Dokumente verknüpft.</div>}
                {canManage && documents.length > 0 && <div className="flex gap-2">
                  <select aria-label="DMS-Dokument auswählen" value={documentId} onChange={event => setDocumentId(event.target.value)} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs">
                    <option value="">Vorhandenes DMS-Dokument auswählen</option>{documents.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
                  </select>
                  <button type="button" disabled={!documentId || busy || !isOnline} onClick={() => void linkDocument()} className="rounded border border-slate-700 px-3 text-xs disabled:opacity-50">Verknüpfen</button>
                </div>}
              </section>}

              <section className="space-y-2 border-t border-slate-800 pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><MessageSquareText className="h-4 w-4 text-amber-300" />Rückfrage oder Korrektur</h3>
                {canConfirm && <div className="flex gap-2">
                  <input aria-label="Rückfrage oder Korrekturtext" value={noteText} onChange={event => setNoteText(event.target.value)} placeholder="Nachvollziehbaren Eintrag hinzufügen…" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 p-2 text-xs" />
                  <button type="button" disabled={!noteText.trim() || busy || !isOnline} onClick={() => void addNote('questions')} className="rounded border border-slate-700 px-2.5 text-xs">Rückfrage</button>
                  {canManage && <button type="button" disabled={!noteText.trim() || busy || !isOnline} onClick={() => void addNote('corrections')} className="rounded border border-amber-500/30 px-2.5 text-xs text-amber-200">Korrektur</button>}
                </div>}
              </section>

              <section className="space-y-3 border-t border-slate-800 pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Clock3 className="h-4 w-4 text-slate-400" />Protokollhistorie</h3>
                {events.map(item => <div key={item.id} className="border-l border-slate-700 pl-3">
                  <div className="text-xs font-medium text-slate-200">{eventLabels[item.action] || item.action}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{localDateTime(item.occurred_at)} · {item.actor_name}</div>
                  {typeof item.details.text === 'string' && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{item.details.text}</p>}
                </div>)}
                {!events.length && <div className="text-xs text-slate-500">Noch keine Historie verfügbar.</div>}
              </section>
            </div>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><ShieldAlert className="h-4 w-4 text-amber-300" />Lokale Übergabesynchronisierung</h2>
          <span className="text-xs text-slate-500">{localMutations.length} lokale Einträge</span>
        </div>
        {localMutations.map(mutation => <div key={mutation.id} className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-slate-800 pt-3 text-xs">
          <div>
            <div className="text-slate-200">{queueStatusLabel(mutation.status)} · {localDateTime(mutation.occurredAt)}</div>
            <div className="mt-1 text-slate-500">Client-ID {mutation.id} · Versuch {mutation.retryCount}</div>
            {mutation.errorMessage && <div className="mt-1 text-rose-300">{mutation.errorMessage}</div>}
            {mutation.status === 'CONFLICT' && <div className="mt-1 text-amber-200">Der Serverdatensatz wurde nicht überschrieben. Konflikt prüfen und gegebenenfalls eine neue Korrektur erfassen.</div>}
          </div>
          {mutation.status === 'FAILED' && <button type="button" disabled={!isOnline || busy} onClick={() => void retrySync()} className="rounded border border-slate-700 px-2 py-1 text-slate-200 disabled:opacity-50">Erneut versuchen</button>}
        </div>)}
        {!localMutations.length && <p className="mt-2 text-xs text-slate-500">Keine ausstehenden, fehlgeschlagenen oder konfliktbehafteten Übergaben.</p>}
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-600"><Clock3 className="h-3 w-3" />Eintrag im Serverprotokoll bedeutet synchronisiert; lokal gespeicherte Daten gelten ausdrücklich nicht als bestätigt.</p>
      </section>
    </div>
  );
};
