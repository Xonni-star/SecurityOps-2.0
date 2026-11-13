import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity, Archive, Bell, Clock3, Flame, Phone, Plus, Radio,
  RefreshCw, ShieldAlert, Siren, X
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import {
  AlarmIncident, AlarmIncidentStatus, EmergencyPlan
} from '../types';
import { useSecurityStore } from '../store';

type View = 'incidents' | 'plans' | 'contacts' | 'escalations';
type PlanForm = {
  siteId: string;
  alarmTypeId: string;
  ownerEmployeeId: string;
  effectiveFrom: string;
  effectiveUntil: string;
  chainOfAction: string;
  contacts: string;
};
type IncidentForm = {
  siteId: string;
  alarmTypeId: string;
  emergencyPlanId: string;
  assignedEmployeeId: string;
  severity: AlarmIncident['severity'];
  title: string;
  description: string;
};
type Contact = {
  id: string;
  site_id: string;
  contact_type: string;
  role: string;
  name: string;
  phone: string;
  email?: string | null;
  revision_version: number;
};
type EventItem = {
  id: string;
  action: string;
  details: Record<string, unknown>;
  occurred_at: string;
  actor_name: string;
};
type EventPage = {
  items: EventItem[];
  page: { hasMore: boolean; nextCursor: string | null };
};
type RecentEvent = EventItem & {
  site_name: string;
  title?: string | null;
  incident_number?: number | null;
};
type EscalationRule = {
  id: string;
  name: string;
  is_active: boolean;
  minimum_severity: AlarmIncident['severity'];
  steps: { delayMinutes: number; recipientEmployeeId?: string; channel: string }[];
};
type Notification = {
  id: string;
  channel: string;
  notification_type: string;
  delivery_status: string;
  attempt_count: number;
  last_error?: string | null;
  title?: string;
  incident_number?: number;
};

const blankPlan: PlanForm = {
  siteId: '', alarmTypeId: '', ownerEmployeeId: '', effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveUntil: '', chainOfAction: '', contacts: ''
};
const blankIncident: IncidentForm = {
  siteId: '', alarmTypeId: '', emergencyPlanId: '', assignedEmployeeId: '',
  severity: 'Dringend', title: '', description: ''
};

const severityStyles: Record<AlarmIncident['severity'], string> = {
  Niedrig: 'text-slate-300 bg-slate-700/40 border-slate-600',
  Normal: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  Dringend: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  Kritisch: 'text-rose-300 bg-rose-500/10 border-rose-500/30'
};
const statusLabels: Record<AlarmIncidentStatus, string> = {
  neu: 'Neu',
  bestätigt: 'Bestätigt',
  in_bearbeitung: 'In Bearbeitung',
  eskaliert: 'Eskaliert',
  einsatzkraefte_verstaendigt: 'Einsatzkräfte verständigt',
  massnahmen_eingeleitet: 'Maßnahmen eingeleitet',
  entwarnung: 'Entwarnung',
  abgeschlossen: 'Abgeschlossen',
  archiviert: 'Archiviert'
};
const transitions: Record<AlarmIncidentStatus, AlarmIncidentStatus[]> = {
  neu: ['bestätigt', 'in_bearbeitung', 'eskaliert', 'abgeschlossen'],
  bestätigt: ['in_bearbeitung', 'eskaliert', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  in_bearbeitung: ['eskaliert', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  eskaliert: ['in_bearbeitung', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  einsatzkraefte_verstaendigt: ['massnahmen_eingeleitet', 'entwarnung', 'abgeschlossen'],
  massnahmen_eingeleitet: ['entwarnung', 'abgeschlossen'],
  entwarnung: ['abgeschlossen'],
  abgeschlossen: ['archiviert'],
  archiviert: []
};
const actionLabels: Record<string, string> = {
  plan_created: 'Notfallplan angelegt',
  plan_updated: 'Notfallplan versioniert',
  plan_archived: 'Notfallplan archiviert',
  plan_published: 'Notfallplan veröffentlicht',
  drill_recorded: 'Übung dokumentiert',
  incident_reported: 'Alarm erfasst',
  incident_action_recorded: 'Maßnahme dokumentiert',
  incident_status_changed: 'Status geändert',
  incident_responder_assigned: 'Einsatzkraft zugewiesen',
  incident_responder_unassigned: 'Einsatzkraft entfernt'
};
const dateLabel = (value?: string | null) => value
  ? new Date(value).toLocaleString('de-DE')
  : 'Keine Zeitangabe';
const inputClass = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none';

export const AlarmsModule: React.FC = () => {
  const emergencyPlans = useSecurityStore(state => state.emergencyPlans) ?? [];
  const alarmIncidents = useSecurityStore(state => state.alarmIncidents) ?? [];
  const alarmTypes = useSecurityStore(state => state.alarmTypes) ?? [];
  const alarmSites = useSecurityStore(state => state.alarmSites) ?? [];
  const clients = useSecurityStore(state => state.clients) ?? [];
  const employees = useSecurityStore(state => state.employees);
  const documents = useSecurityStore(state => state.documents);
  const pendingMutations = useSecurityStore(state => state.pendingAlarmMutations);
  const hasMoreAlarmIncidents = useSecurityStore(state => state.hasMoreAlarmIncidents);
  const isLoadingMoreAlarmIncidents = useSecurityStore(state => state.isLoadingMoreAlarmIncidents);
  const authUser = useSecurityStore(state => state.authUser);
  const isOnline = useSecurityStore(state => state.isOnline);
  const loadTenantData = useSecurityStore(state => state.loadTenantData);
  const loadAlarmIncidents = useSecurityStore(state => state.loadAlarmIncidents);
  const loadMoreAlarmIncidents = useSecurityStore(state => state.loadMoreAlarmIncidents);
  const reportAlarmIncident = useSecurityStore(state => state.reportAlarmIncident);
  const addAlarmAction = useSecurityStore(state => state.addAlarmAction);
  const changeAlarmStatus = useSecurityStore(state => state.changeAlarmStatus);
  const canRead = Boolean(authUser?.permissions.includes('alarm:read'));
  const canManage = Boolean(authUser?.permissions.includes('alarm:manage'));
  const canReport = Boolean(authUser?.permissions.includes('alarm:report'));
  const canRespond = Boolean(authUser?.permissions.includes('alarm:respond'));
  const canArchive = Boolean(authUser?.permissions.includes('alarm:archive'));
  const canAssign = Boolean(authUser?.permissions.includes('alarm:assign'));
  const canPublish = Boolean(authUser?.permissions.includes('emergency_plan:publish'));
  const canReadContacts = Boolean(authUser?.permissions.includes('emergency_contact:read'));
  const canManageContacts = Boolean(authUser?.permissions.includes('emergency_contact:manage'));
  const canManageTypes = Boolean(authUser?.permissions.includes('alarm:type:manage'));
  const canManageEscalation = Boolean(authUser?.permissions.includes('alarm:escalation:manage'));
  const canReadNotifications = Boolean(authUser?.permissions.includes('alarm:notifications:read'));
  const [view, setView] = useState<View>('incidents');
  const [planForm, setPlanForm] = useState<PlanForm>(blankPlan);
  const [incidentForm, setIncidentForm] = useState<IncidentForm>(blankIncident);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [incidentEditorOpen, setIncidentEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<EmergencyPlan | null>(null);
  const [transitionNotes, setTransitionNotes] = useState<Record<string, string>>({});
  const [selectedStatuses, setSelectedStatuses] = useState<Record<string, AlarmIncidentStatus>>({});
  const [actionForms, setActionForms] = useState<Record<string, { description: string; result: string; documentId: string }>>({});
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<{
    targetId: string;
    kind: 'alarms' | 'emergency-plans';
    events: EventItem[];
    nextCursor: string | null;
  } | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactForm, setContactForm] = useState({ siteId: '', contactType: 'site_manager', role: '', name: '', phone: '', email: '' });
  const [typeForm, setTypeForm] = useState({ code: '', label: '' });
  const [ruleForm, setRuleForm] = useState({
    name: '', siteId: '', alarmTypeId: '', minimumSeverity: 'Niedrig' as AlarmIncident['severity'],
    delayMinutes: 5, recipientEmployeeId: '', channel: 'in_app'
  });
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [filters, setFilters] = useState({
    customerId: '', siteId: '', alarmTypeId: '', status: '', severity: '', assignedEmployeeId: '',
    dateFrom: '', dateUntil: '', overdue: false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const siteById = useMemo(() => new Map(alarmSites.map(site => [site.id, site])), [alarmSites]);
  const activePlans = useMemo(() => emergencyPlans.filter(plan =>
    plan.publicationStatus === 'published' && plan.isActive
  ), [emergencyPlans]);
  const selectedSitePlans = activePlans.filter(plan =>
    plan.siteId === incidentForm.siteId && plan.alarmTypeId === incidentForm.alarmTypeId
  );
  const visibleIncidents = useMemo(() => alarmIncidents.filter(incident =>
    (!filters.customerId || incident.customerId === filters.customerId) &&
    (!filters.siteId || incident.siteId === filters.siteId) &&
    (!filters.alarmTypeId || incident.alarmTypeId === filters.alarmTypeId) &&
    (!filters.status || incident.status === filters.status) &&
    (!filters.severity || incident.severity === filters.severity) &&
    (!filters.assignedEmployeeId || incident.assignedEmployeeId === filters.assignedEmployeeId) &&
    (!filters.dateFrom || incident.reportedAt.slice(0, 10) >= filters.dateFrom) &&
    (!filters.dateUntil || incident.reportedAt.slice(0, 10) <= filters.dateUntil) &&
    (!filters.overdue || incident.isOverdue)
  ), [alarmIncidents, filters]);
  const openCount = alarmIncidents.filter(item => !['abgeschlossen', 'archiviert'].includes(item.status)).length;
  const newCount = alarmIncidents.filter(item => item.status === 'neu').length;
  const criticalCount = alarmIncidents.filter(item => item.severity === 'Kritisch' && !['abgeschlossen', 'archiviert'].includes(item.status)).length;
  const overdueCount = alarmIncidents.filter(item => item.isOverdue).length;
  const escalatedCount = alarmIncidents.filter(item => item.status === 'eskaliert').length;
  const inProgressCount = alarmIncidents.filter(item =>
    ['in_bearbeitung', 'einsatzkraefte_verstaendigt', 'massnahmen_eingeleitet'].includes(item.status)
  ).length;
  const completedCount = alarmIncidents.filter(item => item.status === 'abgeschlossen').length;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busy) void loadTenantData();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [busy, loadTenantData]);

  useEffect(() => {
    if (!canRead) return;
    void loadAlarmIncidents(filters).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Alarmfilter konnten nicht geladen werden.');
    });
  }, [canRead, filters, loadAlarmIncidents]);

  useEffect(() => {
    if (view === 'contacts' && canReadContacts) {
      void apiClient.get<Contact[]>('/emergency-contacts')
        .then(setContacts)
        .catch(reason => setError(reason instanceof Error ? reason.message : 'Kontakte konnten nicht geladen werden.'));
    }
    if (view === 'escalations' && canManageEscalation) {
      void apiClient.get<EscalationRule[]>('/alarm-escalation-rules')
        .then(setRules)
        .catch(reason => setError(reason instanceof Error ? reason.message : 'Eskalationsregeln konnten nicht geladen werden.'));
    }
    if (view === 'escalations' && canReadNotifications) {
      void apiClient.get<Notification[]>('/alarm-notifications')
        .then(setNotifications)
        .catch(reason => setError(reason instanceof Error ? reason.message : 'Benachrichtigungen konnten nicht geladen werden.'));
    }
  }, [view, canReadContacts, canManageEscalation, canReadNotifications]);

  useEffect(() => {
    if (view !== 'incidents') return;
    void apiClient.get<RecentEvent[]>('/alarms/recent-events?limit=8')
      .then(setRecentEvents)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Letzte Alarmereignisse konnten nicht geladen werden.'));
  }, [view, alarmIncidents]);

  const runAction = async (action: () => Promise<unknown>, successMessage: string, refresh = true) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (refresh) await loadTenantData();
      if (successMessage) setNotice(successMessage);
      setActivity(null);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die Aktion konnte nicht gespeichert werden.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openPlan = (plan?: EmergencyPlan) => {
    setEditingPlan(plan ?? null);
    setPlanForm(plan ? {
      siteId: plan.siteId,
      alarmTypeId: plan.alarmTypeId ?? '',
      ownerEmployeeId: plan.ownerEmployeeId ?? '',
      effectiveFrom: plan.effectiveFrom?.slice(0, 10) ?? '',
      effectiveUntil: plan.effectiveUntil?.slice(0, 10) ?? '',
      chainOfAction: plan.chainOfAction.join('\n'),
      contacts: plan.contacts.map(contact => `${contact.contactType ?? 'other'} | ${contact.role} | ${contact.name} | ${contact.phone} | ${contact.email ?? ''}`).join('\n')
    } : { ...blankPlan, siteId: alarmSites[0]?.id ?? '', alarmTypeId: alarmTypes[0]?.id ?? '' });
    setPlanEditorOpen(true);
    setError('');
    setNotice('');
  };

  const savePlan = async (event: FormEvent) => {
    event.preventDefault();
    const chainOfAction = planForm.chainOfAction.split('\n').map(step => step.trim()).filter(Boolean);
    const contactsPayload = planForm.contacts.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [contactType, role, name, phone, email] = line.split('|').map(part => part.trim());
      return { contactType: contactType || 'other', role, name, phone, email: email || null };
    });
    if (!planForm.siteId || !planForm.alarmTypeId || !planForm.effectiveFrom || !chainOfAction.length) {
      setError('Objekt, Alarmart, Gültigkeitsbeginn und mindestens eine Maßnahme sind erforderlich.');
      return;
    }
    if (canManageContacts && contactsPayload.some(contact => !contact.role || !contact.name || !contact.phone)) {
      setError('Kontakte bitte als Typ | Rolle | Name | Telefon | E-Mail je Zeile erfassen.');
      return;
    }
    const payload: Record<string, unknown> = {
      siteId: planForm.siteId,
      alarmTypeId: planForm.alarmTypeId,
      ownerEmployeeId: planForm.ownerEmployeeId || null,
      effectiveFrom: planForm.effectiveFrom,
      effectiveUntil: planForm.effectiveUntil || null,
      chainOfAction
    };
    if (canManageContacts) payload.contacts = contactsPayload;
    const ok = await runAction(
      () => editingPlan
        ? apiClient.patch(`/emergency-plans/${editingPlan.id}`, { ...payload, revisionVersion: editingPlan.revisionVersion })
        : apiClient.post('/emergency-plans', payload),
      editingPlan ? 'Neue Entwurfsversion wurde gespeichert.' : 'Notfallplan wurde als Entwurf gespeichert.'
    );
    if (ok) setPlanEditorOpen(false);
  };

  const saveIncident = async (event: FormEvent) => {
    event.preventDefault();
    if (!incidentForm.siteId || !incidentForm.alarmTypeId || !incidentForm.title.trim()) {
      setError('Objekt, Alarmart und Meldungstitel sind erforderlich.');
      return;
    }
    const result = await runAction(async () => {
      const queued = await reportAlarmIncident({
        siteId: incidentForm.siteId,
        alarmTypeId: incidentForm.alarmTypeId,
        emergencyPlanId: incidentForm.emergencyPlanId || null,
        assignedEmployeeId: incidentForm.assignedEmployeeId || null,
        severity: incidentForm.severity,
        title: incidentForm.title.trim(),
        description: incidentForm.description.trim(),
        capturedAt: new Date().toISOString()
      });
      setNotice(queued.state === 'pending'
        ? 'Alarm lokal gespeichert. Serverbestätigung steht aus; die Meldung wird nach Wiederherstellung der Verbindung synchronisiert.'
        : 'Alarm wurde vom Server bestätigt.');
    }, '', false);
    if (result) {
      setIncidentEditorOpen(false);
      setIncidentForm({ ...blankIncident, siteId: alarmSites[0]?.id ?? '', alarmTypeId: alarmTypes[0]?.id ?? '' });
    }
  };

  const loadMoreIncidents = async () => {
    setError('');
    try {
      await loadMoreAlarmIncidents();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Weitere Alarmvorfälle konnten nicht geladen werden.');
    }
  };

  const changeStatus = (incident: AlarmIncident) => {
    const status = selectedStatuses[incident.id] ?? transitions[incident.status][0];
    const note = transitionNotes[incident.id]?.trim();
    if (!status || !note) {
      setError('Bitte einen zulässigen Zielstatus und eine Begründung auswählen.');
      return;
    }
    void runAction(async () => {
      const result = await changeAlarmStatus(incident.id, {
        status, note, revisionVersion: incident.revisionVersion
      });
      setNotice(result.state === 'pending'
        ? 'Statusänderung lokal vorgemerkt; sie ist noch nicht serverseitig bestätigt.'
        : `Status wurde auf „${statusLabels[status]}“ gesetzt.`);
    }, '', false);
  };

  const addAction = (incident: AlarmIncident) => {
    const form = actionForms[incident.id] ?? { description: '', result: '', documentId: '' };
    if (!form.description.trim()) {
      setError('Bitte die durchgeführte Maßnahme beschreiben.');
      return;
    }
    void runAction(async () => {
      const result = await addAlarmAction(incident.id, {
        actionType: 'measure',
        description: form.description.trim(),
        result: form.result.trim(),
        attachmentDocumentId: form.documentId || null,
        capturedAt: new Date().toISOString()
      });
      setActionForms(current => ({ ...current, [incident.id]: { description: '', result: '', documentId: '' } }));
      setNotice(result.state === 'pending'
        ? 'Maßnahme lokal vorgemerkt; die Serverbestätigung steht aus.'
        : 'Maßnahme wurde serverseitig protokolliert.');
    }, '', false);
  };

  const toggleActivity = async (kind: 'alarms' | 'emergency-plans', id: string) => {
    if (activity?.targetId === id) {
      setActivity(null);
      return;
    }
    setError('');
    try {
      const page = await apiClient.get<EventPage>(`/${kind}/${id}/events?limit=50`);
      setActivity({ targetId: id, kind, events: page.items, nextCursor: page.page.nextCursor });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Verlauf konnte nicht geladen werden.');
    }
  };

  const loadMoreActivity = async () => {
    if (!activity?.nextCursor || activityLoading) return;
    setActivityLoading(true);
    setError('');
    try {
      const cursor = encodeURIComponent(activity.nextCursor);
      const page = await apiClient.get<EventPage>(
        `/${activity.kind}/${activity.targetId}/events?limit=50&cursor=${cursor}`
      );
      setActivity(current => current && current.targetId === activity.targetId
        ? {
          ...current,
          events: [...current.events, ...page.items],
          nextCursor: page.page.nextCursor
        }
        : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Weitere Verlaufseinträge konnten nicht geladen werden.');
    } finally {
      setActivityLoading(false);
    }
  };

  const assignResponder = (incident: AlarmIncident) => {
    const employeeId = assignments[incident.id];
    if (!employeeId) return;
    void runAction(
      () => apiClient.post(`/alarms/${incident.id}/assignments`, { employeeId, assigned: true }),
      'Einsatzkraft wurde zugewiesen.'
    );
  };

  const publishPlan = (plan: EmergencyPlan) => {
    void runAction(
      () => apiClient.post(`/emergency-plans/${plan.id}/publish`, { revisionVersion: plan.revisionVersion }),
      'Planversion wurde veröffentlicht.'
    );
  };

  const recordDrill = (plan: EmergencyPlan) => {
    void runAction(
      () => apiClient.post(`/emergency-plans/${plan.id}/drills`, { drillDate: new Date().toISOString().slice(0, 10) }),
      'Übung wurde dokumentiert.'
    );
  };

  const archivePlan = (plan: EmergencyPlan) => {
    void runAction(
      () => apiClient.post(`/emergency-plans/${plan.id}/archive`, { revisionVersion: plan.revisionVersion }),
      'Notfallplan wurde archiviert.'
    );
  };

  const createContact = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      await apiClient.post('/emergency-contacts', { ...contactForm, siteId: contactForm.siteId, customerId: null });
      const refreshed = await apiClient.get<Contact[]>('/emergency-contacts');
      setContacts(refreshed);
      setContactForm({ siteId: '', contactType: 'site_manager', role: '', name: '', phone: '', email: '' });
    }, 'Notfallkontakt wurde gespeichert.', false);
  };

  const archiveContact = (contact: Contact) => {
    void runAction(async () => {
      await apiClient.post(`/emergency-contacts/${contact.id}/archive`, { revisionVersion: contact.revision_version });
      setContacts(current => current.filter(item => item.id !== contact.id));
    }, 'Notfallkontakt wurde archiviert.', false);
  };

  const createAlarmType = (event: FormEvent) => {
    event.preventDefault();
    void runAction(async () => {
      await apiClient.post('/alarm-types', typeForm);
      setTypeForm({ code: '', label: '' });
      await loadTenantData();
    }, 'Alarmart wurde angelegt.', false);
  };

  const toggleAlarmType = (type: AlarmType) => {
    void runAction(
      () => apiClient.patch(`/alarm-types/${type.id}`, { isActive: !type.isActive }),
      type.isActive ? 'Alarmart wurde deaktiviert.' : 'Alarmart wurde aktiviert.'
    );
  };

  const createRule = (event: FormEvent) => {
    event.preventDefault();
    if (!ruleForm.name.trim() || !ruleForm.recipientEmployeeId) {
      setError('Name und verantwortliche Einsatzkraft sind erforderlich.');
      return;
    }
    void runAction(async () => {
      await apiClient.post('/alarm-escalation-rules', {
        name: ruleForm.name.trim(),
        siteId: ruleForm.siteId || null,
        alarmTypeId: ruleForm.alarmTypeId || null,
        minimumSeverity: ruleForm.minimumSeverity,
        isActive: true,
        steps: [{
          delayMinutes: ruleForm.delayMinutes,
          recipientEmployeeId: ruleForm.recipientEmployeeId,
          channel: ruleForm.channel
        }]
      });
      setRuleForm({ name: '', siteId: '', alarmTypeId: '', minimumSeverity: 'Niedrig', delayMinutes: 5, recipientEmployeeId: '', channel: 'in_app' });
      setRules(await apiClient.get<EscalationRule[]>('/alarm-escalation-rules'));
    }, 'Eskalationsregel wurde gespeichert.', false);
  };

  const retryNotification = (notification: Notification) => {
    void runAction(
      () => apiClient.post(`/alarm-notifications/${notification.id}/retry`, {}),
      'Zustellung wurde zur kontrollierten Wiederholung vorgemerkt.',
      false
    );
  };

  if (!canRead) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">
        Für Alarm- und Notfallmanagement ist eine ausdrückliche Leseberechtigung erforderlich.
      </div>
    );
  }

  const uniqueCustomers = [...new Set(alarmSites.map(site => site.customerId))];
  const employeeOptions = (siteId?: string) => employees.filter(employee =>
    !siteId || employee.assignedSiteIds.includes(siteId)
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Siren className="h-6 w-6 text-rose-500" />
            <h1 className="text-xl font-bold text-white">Alarm- &amp; Notfallmanagement</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">Mandantengeschützte Alarmzentrale mit Statushistorie, Notfallplänen und Offline-Synchronisation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-lg border px-3 py-2 text-xs ${isOnline ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-300'}`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <button type="button" onClick={() => void runAction(() => loadTenantData(), 'Daten wurden aktualisiert.')} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className="h-4 w-4" /> Aktualisieren
          </button>
          {canReport && <button type="button" onClick={() => { setIncidentForm({ ...blankIncident, siteId: alarmSites[0]?.id ?? '', alarmTypeId: alarmTypes[0]?.id ?? '' }); setIncidentEditorOpen(true); }}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-500">
            <Plus className="h-4 w-4" /> Alarm melden
          </button>}
        </div>
      </header>

      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`flex items-start justify-between gap-4 rounded-xl border p-3 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
        <span>{error || notice}</span><button type="button" aria-label="Meldung schließen" onClick={() => { setError(''); setNotice(''); }}><X className="h-4 w-4" /></button>
      </div>}

      {pendingMutations.some(item => item.status !== 'confirmed') && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          {pendingMutations.filter(item => item.status === 'pending').length} Alarmmutation(en) warten auf Serverbestätigung.
          {pendingMutations.filter(item => item.status === 'conflict').length > 0 &&
            ` ${pendingMutations.filter(item => item.status === 'conflict').length} Konflikt(e) benötigen Prüfung.`}
          <p className="mt-1 text-xs text-amber-100/70">Lokal erfasste Alarme sind nicht als serverseitig zugestellt oder bestätigt zu verstehen.</p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        <Metric label="Offen" value={openCount} icon={<ShieldAlert className="h-4 w-4" />} />
        <Metric label="Neu" value={newCount} icon={<Flame className="h-4 w-4" />} />
        <Metric label="Kritisch" value={criticalCount} icon={<Siren className="h-4 w-4" />} />
        <Metric label="Eskaliert" value={escalatedCount} icon={<Bell className="h-4 w-4" />} />
        <Metric label="In Bearbeitung" value={inProgressCount} icon={<Activity className="h-4 w-4" />} />
        <Metric label="Abgeschlossen" value={completedCount} icon={<Archive className="h-4 w-4" />} />
        <Metric label="Überfällig" value={overdueCount} icon={<Clock3 className="h-4 w-4" />} />
      </section>

      {view === 'incidents' && recentEvents.length > 0 && <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-bold text-white">Letzte Ereignisse</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {recentEvents.map(item => <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-950/70 p-3 text-xs">
            <div><span className="font-semibold text-slate-200">{actionLabels[item.action] ?? item.action}</span>
              <span className="block mt-1 text-slate-400">{item.title ?? 'Notfallplan'} · {item.site_name}</span>
              <span className="block mt-1 text-slate-500">{item.actor_name}</span></div>
            <time className="shrink-0 text-slate-500">{dateLabel(item.occurred_at)}</time>
          </div>)}
        </div>
      </section>}

      <nav className="flex flex-wrap gap-2 border-b border-slate-800">
        {([
          ['incidents', 'Alarmzentrale'],
          ['plans', 'Notfallpläne'],
          ...(canReadContacts ? [['contacts', 'Ansprechpartner'] as const] : []),
          ...(canManageTypes || canManageEscalation || canReadNotifications ? [['escalations', 'Konfiguration & Zustellung'] as const] : [])
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => { setView(id); setError(''); }}
            className={`border-b-2 px-3 py-2 text-sm ${view === id ? 'border-rose-500 text-white' : 'border-transparent text-slate-400'}`}>{label}</button>
        ))}
      </nav>

      {view === 'incidents' && (
        <section className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Filter label="Kunde" value={filters.customerId} onChange={value => setFilters(current => ({ ...current, customerId: value }))}>
              <option value="">Alle Kunden</option>{uniqueCustomers.map(id => <option key={id} value={id}>{clients.find(client => client.id === id)?.companyName ?? id}</option>)}
            </Filter>
            <Filter label="Objekt" value={filters.siteId} onChange={value => setFilters(current => ({ ...current, siteId: value }))}>
              <option value="">Alle Objekte</option>{alarmSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </Filter>
            <Filter label="Alarmart" value={filters.alarmTypeId} onChange={value => setFilters(current => ({ ...current, alarmTypeId: value }))}>
              <option value="">Alle Alarmarten</option>{alarmTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
            </Filter>
            <Filter label="Status" value={filters.status} onChange={value => setFilters(current => ({ ...current, status: value }))}>
              <option value="">Alle Status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </Filter>
            <Filter label="Priorität" value={filters.severity} onChange={value => setFilters(current => ({ ...current, severity: value }))}>
              <option value="">Alle Prioritäten</option>{(['Niedrig', 'Normal', 'Dringend', 'Kritisch'] as const).map(value => <option key={value}>{value}</option>)}
            </Filter>
            <Filter label="Verantwortliche Person" value={filters.assignedEmployeeId} onChange={value => setFilters(current => ({ ...current, assignedEmployeeId: value }))}>
              <option value="">Alle Einsatzkräfte</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
            </Filter>
            <Field label="Von"><input type="date" value={filters.dateFrom} onChange={event => setFilters(current => ({ ...current, dateFrom: event.target.value }))} className={inputClass} /></Field>
            <Field label="Bis"><input type="date" value={filters.dateUntil} onChange={event => setFilters(current => ({ ...current, dateUntil: event.target.value }))} className={inputClass} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-slate-300"><input type="checkbox" checked={filters.overdue} onChange={event => setFilters(current => ({ ...current, overdue: event.target.checked }))} />Nur überfällige Reaktionen</label>
          </div>

          {visibleIncidents.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">Keine Alarmereignisse für diese Filter.</div>}
          {visibleIncidents.map(incident => {
            const allowed = (transitions[incident.status] ?? []).filter(status => status !== 'archiviert' || canArchive);
            const actionForm = actionForms[incident.id] ?? { description: '', result: '', documentId: '' };
            const availableEmployees = employeeOptions(incident.siteId);
            return (
              <article key={incident.id} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {incident.incidentNumber && <span className="text-xs font-mono text-slate-500">#{incident.incidentNumber}</span>}
                      <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${severityStyles[incident.severity]}`}>{incident.severity}</span>
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">{statusLabels[incident.status]}</span>
                      <span className="text-[11px] text-slate-400">{incident.alarmTypeLabel ?? incident.scenario}</span>
                      {incident.isOverdue && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">Reaktion überfällig</span>}
                      {incident.syncStatus && incident.syncStatus !== 'confirmed' && <SyncBadge status={incident.syncStatus} />}
                    </div>
                    <h2 className="mt-2 text-base font-bold text-white">{incident.title}</h2>
                    <p className="mt-1 text-sm text-slate-300">{incident.customerName ? `${incident.customerName} · ` : ''}{incident.siteName}</p>
                    {incident.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{incident.description}</p>}
                    <p className="mt-2 text-xs text-slate-500">Gemeldet {dateLabel(incident.reportedAt)}{incident.reporterName ? ` · ${incident.reporterName}` : ''}{incident.assignedEmployeeName ? ` · Zuständig: ${incident.assignedEmployeeName}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => void toggleActivity('alarms', incident.id)} className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
                    <Activity className="mr-1 inline h-3.5 w-3.5" /> Verlauf
                  </button>
                </div>

                {canRespond && allowed.length > 0 && (
                  <div className="grid gap-3 border-t border-slate-800 pt-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                    <Field label="Nächster Status"><select value={selectedStatuses[incident.id] ?? allowed[0]} onChange={event => setSelectedStatuses(current => ({ ...current, [incident.id]: event.target.value as AlarmIncidentStatus }))} className={inputClass}>{allowed.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></Field>
                    <Field label="Begründung / Übergabenotiz"><input value={transitionNotes[incident.id] ?? ''} onChange={event => setTransitionNotes(current => ({ ...current, [incident.id]: event.target.value }))} maxLength={4000} className={inputClass} /></Field>
                    <button type="button" disabled={busy || incident.syncStatus === 'pending'} onClick={() => changeStatus(incident)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50">Status ändern</button>
                  </div>
                )}

                {canAssign && !['abgeschlossen', 'archiviert'].includes(incident.status) && (
                  <div className="flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-end">
                    <Field label="Einsatzkraft zuweisen"><select value={assignments[incident.id] ?? ''} onChange={event => setAssignments(current => ({ ...current, [incident.id]: event.target.value }))} className={inputClass}>
                      <option value="">Einsatzkraft auswählen</option>{availableEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}
                    </select></Field>
                    <button type="button" disabled={busy || !assignments[incident.id]} onClick={() => assignResponder(incident)} className="rounded-lg border border-blue-500/40 px-3 py-2 text-xs text-blue-200 disabled:opacity-50">Zuweisen</button>
                  </div>
                )}

                {incident.status !== 'archiviert' && !['abgeschlossen'].includes(incident.status) && authUser?.permissions.includes('alarm:action:create') && (
                  <div className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2">
                    <Field label="Maßnahme"><input value={actionForm.description} onChange={event => setActionForms(current => ({ ...current, [incident.id]: { ...actionForm, description: event.target.value } }))} maxLength={4000} className={inputClass} placeholder="z. B. Gefahrenbereich abgesperrt" /></Field>
                    <Field label="Ergebnis"><input value={actionForm.result} onChange={event => setActionForms(current => ({ ...current, [incident.id]: { ...actionForm, result: event.target.value } }))} maxLength={4000} className={inputClass} /></Field>
                    <Field label="Vorhandenes Dokument anhängen (optional)"><select value={actionForm.documentId} onChange={event => setActionForms(current => ({ ...current, [incident.id]: { ...actionForm, documentId: event.target.value } }))} className={inputClass}>
                      <option value="">Kein Dokument</option>{documents.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
                    </select></Field>
                    <button type="button" disabled={busy} onClick={() => addAction(incident)} className="self-end rounded-lg border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50">Maßnahme protokollieren</button>
                  </div>
                )}
                {activity?.targetId === incident.id && <ActivityTimeline
                  events={activity.events}
                  hasMore={Boolean(activity.nextCursor)}
                  isLoading={activityLoading}
                  onLoadMore={() => void loadMoreActivity()}
                />}
              </article>
            );
          })}
          {hasMoreAlarmIncidents && (
            <div className="flex justify-center">
              <button type="button" onClick={() => void loadMoreIncidents()} disabled={isLoadingMoreAlarmIncidents}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">
                {isLoadingMoreAlarmIncidents ? 'Wird geladen…' : 'Weitere Alarmvorfälle laden'}
              </button>
            </div>
          )}
        </section>
      )}

      {view === 'plans' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">Veröffentlichte Versionen gelten innerhalb ihres Zeitraums; Änderungen erzeugen einen neuen Entwurf.</p>
            {canManage && <button type="button" onClick={() => openPlan()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"><Plus className="mr-1 inline h-4 w-4" />Plan anlegen</button>}
          </div>
          {emergencyPlans.length === 0 && <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center"><ShieldAlert className="mx-auto mb-2 h-8 w-8 text-blue-400" /><p className="font-semibold text-white">Noch keine Notfallpläne vorhanden</p></div>}
          {emergencyPlans.map(plan => (
            <article key={plan.id} className={`space-y-4 rounded-2xl border bg-slate-900 p-5 ${plan.publicationStatus === 'published' ? 'border-emerald-500/20' : 'border-slate-800'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2.5 py-0.5 text-xs font-bold text-blue-200">{plan.alarmTypeLabel ?? plan.scenario}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] ${plan.publicationStatus === 'published' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{plan.publicationStatus === 'published' ? 'Veröffentlicht' : 'Entwurf'}</span>
                    {plan.versionNumber && <span className="text-[11px] text-slate-500">Version {plan.versionNumber}</span>}
                    {plan.offlineCopy && <span className="text-[11px] text-amber-300">Offline-Kopie</span>}
                  </div>
                  <h2 className="mt-2 font-bold text-white">{plan.siteName}</h2>
                  <p className="mt-1 text-xs text-slate-400">{plan.customerName ?? 'Kunde'} · gültig {plan.effectiveFrom ?? 'ohne Startdatum'}{plan.effectiveUntil ? ` bis ${plan.effectiveUntil}` : ' · ohne Enddatum'}</p>
                </div>
                <span className="text-xs text-slate-400"><Clock3 className="mr-1 inline h-3.5 w-3.5" />Letzte Übung: {plan.lastDrillDate ? new Date(plan.lastDrillDate).toLocaleDateString('de-DE') : 'Keine dokumentiert'}</span>
              </div>
              <ol className="space-y-1.5">{plan.chainOfAction.map((step, index) => <li key={`${plan.id}-${index}`} className="rounded-lg border border-slate-800 bg-slate-800/40 p-2.5 text-sm text-slate-200">{index + 1}. {step}</li>)}</ol>
              <div className="border-t border-slate-800 pt-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-300">Notfallkontakte</h3>
                {!canReadContacts ? <p className="text-xs text-slate-500">Kontaktinformationen erfordern eine gesonderte Berechtigung.</p>
                  : plan.contacts.length === 0 ? <p className="text-xs text-slate-500">Keine Kontakte hinterlegt.</p>
                  : <div className="grid gap-2 sm:grid-cols-2">{plan.contacts.map((contact, index) => <div key={contact.id ?? `${plan.id}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-800/80 p-2.5 text-xs">
                    <div><span className="block text-[10px] text-slate-400">{contact.role}</span><span className="font-semibold text-slate-200">{contact.name}</span></div><a href={`tel:${contact.phone}`} aria-label={`${contact.name} anrufen`} className="rounded-lg bg-blue-600/20 p-2 text-blue-300"><Phone className="h-3.5 w-3.5" /></a>
                  </div>)}</div>}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                <button type="button" onClick={() => void toggleActivity('emergency-plans', plan.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"><Activity className="mr-1 inline h-3.5 w-3.5" />Verlauf</button>
                {canManage && <button type="button" onClick={() => openPlan(plan)} className="rounded-lg border border-blue-500/40 px-3 py-2 text-xs text-blue-200">Neue Version bearbeiten</button>}
                {canPublish && plan.publicationStatus === 'draft' && <button type="button" onClick={() => publishPlan(plan)} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs text-white disabled:opacity-50">Veröffentlichen</button>}
                {canManage && plan.publicationStatus === 'published' && <button type="button" onClick={() => recordDrill(plan)} disabled={busy} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"><Radio className="mr-1 inline h-3.5 w-3.5" />Übung dokumentieren</button>}
                {canManage && <button type="button" onClick={() => archivePlan(plan)} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><Archive className="mr-1 inline h-3.5 w-3.5" />Archivieren</button>}
              </div>
              {activity?.targetId === plan.id && <ActivityTimeline
                events={activity.events}
                hasMore={Boolean(activity.nextCursor)}
                isLoading={activityLoading}
                onLoadMore={() => void loadMoreActivity()}
              />}
            </article>
          ))}
        </section>
      )}

      {view === 'contacts' && canReadContacts && (
        <section className="space-y-4">
          {canManageContacts && <form onSubmit={createContact} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-3">
            <Field label="Objekt"><select required value={contactForm.siteId} onChange={event => setContactForm(current => ({ ...current, siteId: event.target.value }))} className={inputClass}><option value="">Objekt auswählen</option>{alarmSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
            <Filter label="Kontaktart" value={contactForm.contactType} onChange={value => setContactForm(current => ({ ...current, contactType: value }))}>
              {['site_manager','deputy','operations','customer','technical','fire','police','medical','other'].map(type => <option key={type} value={type}>{type}</option>)}
            </Filter>
            <Field label="Rolle"><input required value={contactForm.role} onChange={event => setContactForm(current => ({ ...current, role: event.target.value }))} className={inputClass} /></Field>
            <Field label="Name"><input required value={contactForm.name} onChange={event => setContactForm(current => ({ ...current, name: event.target.value }))} className={inputClass} /></Field>
            <Field label="Telefon"><input required value={contactForm.phone} onChange={event => setContactForm(current => ({ ...current, phone: event.target.value }))} className={inputClass} /></Field>
            <Field label="E-Mail"><input type="email" value={contactForm.email} onChange={event => setContactForm(current => ({ ...current, email: event.target.value }))} className={inputClass} /></Field>
            <button type="submit" disabled={busy || !contactForm.siteId} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 sm:col-span-3">Kontakt speichern</button>
          </form>}
          <div className="space-y-2">{contacts.map(contact => <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
            <div><p className="text-sm font-semibold text-white">{contact.name} · {contact.role}</p><p className="mt-1 text-xs text-slate-400">{siteById.get(contact.site_id)?.name ?? 'Kunden-/Planbezug'} · {contact.contact_type} · {contact.phone}{contact.email ? ` · ${contact.email}` : ''}</p></div>
            {canManageContacts && <button type="button" onClick={() => archiveContact(contact)} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">Archivieren</button>}
          </div>)}</div>
        </section>
      )}

      {view === 'escalations' && (
        <section className="space-y-5">
          {canManageTypes && <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-bold text-white">Administrierbare Alarmarten</h2>
            <form onSubmit={createAlarmType} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Field label="Code"><input required pattern="[a-z0-9_]{2,80}" value={typeForm.code} onChange={event => setTypeForm(current => ({ ...current, code: event.target.value }))} className={inputClass} /></Field>
              <Field label="Bezeichnung"><input required value={typeForm.label} onChange={event => setTypeForm(current => ({ ...current, label: event.target.value }))} className={inputClass} /></Field>
              <button type="submit" disabled={busy} className="self-end rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Alarmart hinzufügen</button>
            </form>
            <div className="flex flex-wrap gap-2">{alarmTypes.map(type => <span key={type.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200">
              {type.label}{!type.isSystem && <button type="button" onClick={() => toggleAlarmType(type)} className="text-blue-300">{type.isActive ? 'Deaktivieren' : 'Aktivieren'}</button>}
            </span>)}</div>
          </div>}

          {canManageEscalation && <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-bold text-white">Serverseitige Eskalationsregeln</h2>
            <form onSubmit={createRule} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Regelname"><input required value={ruleForm.name} onChange={event => setRuleForm(current => ({ ...current, name: event.target.value }))} className={inputClass} /></Field>
              <Filter label="Objekt (optional)" value={ruleForm.siteId} onChange={value => setRuleForm(current => ({ ...current, siteId: value }))}><option value="">Alle erlaubten Objekte</option>{alarmSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Filter>
              <Filter label="Alarmart (optional)" value={ruleForm.alarmTypeId} onChange={value => setRuleForm(current => ({ ...current, alarmTypeId: value }))}><option value="">Alle Alarmarten</option>{alarmTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</Filter>
              <Filter label="Mindestpriorität" value={ruleForm.minimumSeverity} onChange={value => setRuleForm(current => ({ ...current, minimumSeverity: value as AlarmIncident['severity'] }))}>{(['Niedrig','Normal','Dringend','Kritisch'] as const).map(level => <option key={level}>{level}</option>)}</Filter>
              <Field label="Reaktionsfrist (Minuten)"><input type="number" min={0} max={10080} value={ruleForm.delayMinutes} onChange={event => setRuleForm(current => ({ ...current, delayMinutes: Number(event.target.value) }))} className={inputClass} /></Field>
              <Filter label="Empfänger (Einsatzkraft)" value={ruleForm.recipientEmployeeId} onChange={value => setRuleForm(current => ({ ...current, recipientEmployeeId: value }))}><option value="">Person auswählen</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Filter>
              <Filter label="Benachrichtigungskanal" value={ruleForm.channel} onChange={value => setRuleForm(current => ({ ...current, channel: value }))}><option value="in_app">In-App</option><option value="email">E-Mail</option><option value="push">Push</option></Filter>
              <button type="submit" disabled={busy} className="self-end rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Regel speichern</button>
            </form>
            <p className="text-xs text-slate-400">Eskalationen werden serverseitig verarbeitet. Nicht konfigurierte E-Mail-/Push-Provider werden als „nicht konfiguriert“ ausgewiesen, niemals als zugestellt.</p>
            <div className="space-y-2">{rules.map(rule => <div key={rule.id} className="rounded-lg border border-slate-800 p-3 text-xs text-slate-300">
              <strong className="text-white">{rule.name}</strong> · Mindestpriorität {rule.minimum_severity} · {rule.is_active ? 'Aktiv' : 'Inaktiv'}
              {rule.steps.map((step, index) => <p key={index} className="mt-1">{step.delayMinutes} Min. · {step.channel} · {employees.find(employee => employee.id === step.recipientEmployeeId)?.firstName ?? 'Empfänger'}</p>)}
            </div>)}</div>
          </div>}

          {canReadNotifications && <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white"><Bell className="h-4 w-4" />Zustell- und Eskalationsstatus</h2>
            <div className="space-y-2">{notifications.map(notification => <div key={notification.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
              <div><p className="text-xs font-semibold text-white">{notification.title ?? `Alarm #${notification.incident_number ?? ''}`} · {notification.channel} · {notification.notification_type}</p>
                <p className="mt-1 text-xs text-slate-400">Status: {notification.delivery_status} · Versuche: {notification.attempt_count}{notification.last_error ? ` · ${notification.last_error}` : ''}</p></div>
              {notification.delivery_status === 'failed' && canManageEscalation && <button type="button" onClick={() => retryNotification(notification)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs text-amber-200">Erneut versuchen</button>}
            </div>)}
              {notifications.length === 0 && <p className="text-xs text-slate-400">Noch keine Benachrichtigungen.</p>}
            </div>
          </div>}
        </section>
      )}

      {incidentEditorOpen && (
        <form onSubmit={saveIncident} className="space-y-4 rounded-2xl border border-rose-500/30 bg-slate-900 p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-white">Alarmvorfall melden</h2><button type="button" onClick={() => setIncidentEditorOpen(false)} aria-label="Formular schließen"><X className="h-4 w-4 text-slate-400" /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Filter label="Objekt" value={incidentForm.siteId} onChange={value => setIncidentForm(current => ({ ...current, siteId: value, emergencyPlanId: '' }))} required><option value="">Objekt auswählen</option>{alarmSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Filter>
            <Filter label="Alarmart" value={incidentForm.alarmTypeId} onChange={value => setIncidentForm(current => ({ ...current, alarmTypeId: value, emergencyPlanId: '' }))} required><option value="">Alarmart auswählen</option>{alarmTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</Filter>
            <Filter label="Priorität" value={incidentForm.severity} onChange={value => setIncidentForm(current => ({ ...current, severity: value as IncidentForm['severity'] }))}>{(['Niedrig','Normal','Dringend','Kritisch'] as const).map(level => <option key={level}>{level}</option>)}</Filter>
            <Filter label="Gültiger Notfallplan" value={incidentForm.emergencyPlanId} onChange={value => setIncidentForm(current => ({ ...current, emergencyPlanId: value }))}><option value="">Keinen Plan verknüpfen</option>{selectedSitePlans.map(plan => <option key={plan.id} value={plan.id}>{plan.alarmTypeLabel} · Version {plan.versionNumber}</option>)}</Filter>
            <Filter label="Verantwortliche Einsatzkraft" value={incidentForm.assignedEmployeeId} onChange={value => setIncidentForm(current => ({ ...current, assignedEmployeeId: value }))}><option value="">Noch nicht zugewiesen</option>{employeeOptions(incidentForm.siteId).map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Filter>
            <Field label="Meldetitel"><input required maxLength={255} value={incidentForm.title} onChange={event => setIncidentForm(current => ({ ...current, title: event.target.value }))} className={inputClass} /></Field>
            <Field label="Beschreibung"><textarea maxLength={8000} rows={3} value={incidentForm.description} onChange={event => setIncidentForm(current => ({ ...current, description: event.target.value }))} className={inputClass} /></Field>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setIncidentEditorOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Abbrechen</button><button type="submit" disabled={busy || !alarmSites.length || !alarmTypes.length} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Flame className="mr-1 inline h-4 w-4" />{isOnline ? 'Meldung speichern' : 'Offline erfassen'}</button></div>
        </form>
      )}

      {planEditorOpen && canManage && (
        <form onSubmit={savePlan} className="space-y-4 rounded-2xl border border-blue-500/30 bg-slate-900 p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-white">{editingPlan ? 'Notfallplan als neue Version bearbeiten' : 'Notfallplan anlegen'}</h2><button type="button" onClick={() => setPlanEditorOpen(false)} aria-label="Formular schließen"><X className="h-4 w-4 text-slate-400" /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Filter label="Objekt" value={planForm.siteId} onChange={value => setPlanForm(current => ({ ...current, siteId: value }))} required><option value="">Objekt auswählen</option>{alarmSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</Filter>
            <Filter label="Alarmart" value={planForm.alarmTypeId} onChange={value => setPlanForm(current => ({ ...current, alarmTypeId: value }))} required><option value="">Alarmart auswählen</option>{alarmTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</Filter>
            <Filter label="Verantwortliche Person" value={planForm.ownerEmployeeId} onChange={value => setPlanForm(current => ({ ...current, ownerEmployeeId: value }))}><option value="">Keine Person zugewiesen</option>{employees.filter(employee => employee.assignedSiteIds.includes(planForm.siteId)).map(employee => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</Filter>
            <Field label="Gültig ab"><input required type="date" value={planForm.effectiveFrom} onChange={event => setPlanForm(current => ({ ...current, effectiveFrom: event.target.value }))} className={inputClass} /></Field>
            <Field label="Gültig bis (optional)"><input type="date" value={planForm.effectiveUntil} onChange={event => setPlanForm(current => ({ ...current, effectiveUntil: event.target.value }))} className={inputClass} /></Field>
            <Field label="Maßnahmenkette (ein Schritt je Zeile)"><textarea required rows={5} value={planForm.chainOfAction} onChange={event => setPlanForm(current => ({ ...current, chainOfAction: event.target.value }))} className={inputClass} /></Field>
            {canManageContacts && <Field label="Kontakte (Typ | Rolle | Name | Telefon | E-Mail je Zeile)"><textarea rows={5} value={planForm.contacts} onChange={event => setPlanForm(current => ({ ...current, contacts: event.target.value }))} className={inputClass} placeholder="fire | Feuerwehr | Leitstelle | 112 | " /></Field>}
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setPlanEditorOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Abbrechen</button><button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Entwurf speichern</button></div>
        </form>
      )}

      {alarmSites.length === 0 && <p className="text-xs text-slate-500">Für dieses Konto sind keine Alarmobjekte freigegeben oder offline verfügbar.</p>}
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-xs font-medium text-slate-300">{label}{children}</label>
);

const Filter: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  required?: boolean;
}> = ({ label, value, onChange, children, required }) => (
  <Field label={label}><select required={required} value={value} onChange={event => onChange(event.target.value)} className={inputClass}>{children}</select></Field>
);

const Metric: React.FC<{ label: string; value: number; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
    <span className="text-rose-300">{icon}</span><div><p className="text-lg font-bold text-white">{value}</p><p className="text-[11px] text-slate-400">{label}</p></div>
  </div>
);

const SyncBadge: React.FC<{ status: 'pending' | 'conflict' | 'confirmed' }> = ({ status }) => (
  <span className={`rounded px-2 py-0.5 text-[11px] ${status === 'conflict' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
    {status === 'conflict' ? 'Synchronisierungskonflikt' : 'Wartet auf Serverbestätigung'}
  </span>
);

const ActivityTimeline: React.FC<{
  events: EventItem[];
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
}> = ({ events, hasMore, isLoading, onLoadMore }) => (
  <div className="space-y-2 border-t border-slate-800 pt-3">
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Chronologisches Ereignisprotokoll</h3>
    {events.length === 0 ? <p className="text-xs text-slate-500">Noch keine Ereignisse.</p> : [...events].reverse().map(item => (
      <div key={item.id} className="rounded-lg bg-slate-800/50 p-2.5 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-200">{actionLabels[item.action] ?? item.action}</span><span className="text-slate-500">{dateLabel(item.occurred_at)}</span></div>
        <p className="mt-1 text-slate-400">{item.actor_name}{typeof item.details?.note === 'string' ? ` · ${item.details.note}` : ''}{typeof item.details?.drillDate === 'string' ? ` · Übung am ${item.details.drillDate}` : ''}</p>
      </div>
    ))}
    {hasMore && <button type="button" onClick={onLoadMore} disabled={isLoading}
      className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50">
      {isLoading ? 'Wird geladen…' : 'Weitere Ereignisse laden'}
    </button>}
  </div>
);
