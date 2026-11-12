import React, { useMemo, useState } from 'react';
import {
  Activity, Archive, CheckCircle2, Clock3, Flame, Phone, Plus, Radio,
  RefreshCw, ShieldAlert, Siren, X
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { AlarmIncident, EmergencyPlan } from '../types';
import { useSecurityStore } from '../store';

type View = 'incidents' | 'plans';
type PlanForm = {
  siteId: string;
  scenario: EmergencyPlan['scenario'];
  chainOfAction: string;
  contacts: string;
  lastDrillDate: string;
  isActive: boolean;
};
type IncidentForm = {
  siteId: string;
  emergencyPlanId: string;
  scenario: EmergencyPlan['scenario'];
  severity: AlarmIncident['severity'];
  title: string;
  description: string;
};
type ActivityEvent = {
  id: string;
  action: string;
  details: { note?: string; drillDate?: string };
  occurred_at: string;
  actor_name: string;
};

const scenarios: EmergencyPlan['scenario'][] = [
  'BMA - Brandmeldeanlage',
  'EMA - Einbruchsalarm',
  'Bombendrohung',
  'Medizinischer Notfall',
  'Hausfriedensbruch / Aggression'
];

const blankPlan: PlanForm = {
  siteId: '', scenario: scenarios[0], chainOfAction: '', contacts: '', lastDrillDate: '', isActive: true
};
const blankIncident: IncidentForm = {
  siteId: '', emergencyPlanId: '', scenario: scenarios[0], severity: 'Dringend', title: '', description: ''
};

const severityStyles: Record<AlarmIncident['severity'], string> = {
  Niedrig: 'text-slate-300 bg-slate-700/40 border-slate-600',
  Normal: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  Dringend: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  Kritisch: 'text-rose-300 bg-rose-500/10 border-rose-500/30'
};

const statusLabels: Record<AlarmIncident['status'], string> = {
  gemeldet: 'Gemeldet',
  bestätigt: 'Bestätigt',
  eskaliert: 'Eskaliert',
  abgeschlossen: 'Abgeschlossen'
};

const actionLabels: Record<string, string> = {
  plan_created: 'Notfallplan angelegt',
  plan_updated: 'Notfallplan aktualisiert',
  plan_archived: 'Notfallplan archiviert',
  drill_recorded: 'Übung dokumentiert',
  incident_reported: 'Alarm gemeldet',
  incident_acknowledged: 'Alarm bestätigt',
  incident_escalated: 'Alarm eskaliert',
  incident_resolved: 'Alarm abgeschlossen'
};

const dateLabel = (value?: string | null) => value
  ? new Date(value).toLocaleString('de-DE')
  : 'Noch keine Übung dokumentiert';

export const AlarmsModule: React.FC = () => {
  const emergencyPlans = useSecurityStore((state) => state.emergencyPlans);
  const alarmIncidents = useSecurityStore((state) => state.alarmIncidents);
  const sites = useSecurityStore((state) => state.sites);
  const authUser = useSecurityStore((state) => state.authUser);
  const loadTenantData = useSecurityStore((state) => state.loadTenantData);
  const canRead = Boolean(authUser?.permissions.includes('alarm:read'));
  const canManage = Boolean(authUser?.permissions.includes('alarm:manage'));
  const canReport = Boolean(authUser?.permissions.includes('alarm:report'));
  const canRespond = Boolean(authUser?.permissions.includes('alarm:respond'));
  const [view, setView] = useState<View>('incidents');
  const [planForm, setPlanForm] = useState<PlanForm>(blankPlan);
  const [incidentForm, setIncidentForm] = useState<IncidentForm>(blankIncident);
  const [planEditorOpen, setPlanEditorOpen] = useState(false);
  const [incidentEditorOpen, setIncidentEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<EmergencyPlan | null>(null);
  const [transitionNotes, setTransitionNotes] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<{ targetId: string; events: ActivityEvent[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activePlans = useMemo(() => emergencyPlans.filter((plan) => plan.isActive !== false), [emergencyPlans]);
  const openIncidents = useMemo(
    () => alarmIncidents.filter((incident) => incident.status !== 'abgeschlossen'),
    [alarmIncidents]
  );
  const selectedSitePlans = activePlans.filter((plan) => plan.siteId === incidentForm.siteId);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await loadTenantData();
      setNotice(successMessage);
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
      scenario: plan.scenario,
      chainOfAction: plan.chainOfAction.join('\n'),
      contacts: plan.contacts.map((contact) => `${contact.role} | ${contact.name} | ${contact.phone}`).join('\n'),
      lastDrillDate: plan.lastDrillDate?.slice(0, 10) ?? '',
      isActive: plan.isActive !== false
    } : { ...blankPlan, siteId: sites[0]?.id ?? '' });
    setPlanEditorOpen(true);
    setError('');
    setNotice('');
  };

  const savePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    const chainOfAction = planForm.chainOfAction.split('\n').map((step) => step.trim()).filter(Boolean);
    const contacts = planForm.contacts.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [role, name, phone] = line.split('|').map((part) => part.trim());
      return { role, name, phone };
    });
    if (!planForm.siteId || !chainOfAction.length || contacts.some((contact) => !contact.role || !contact.name || !contact.phone)) {
      setError('Objekt und mindestens eine Maßnahme sind erforderlich. Kontakte bitte als Rolle | Name | Telefon erfassen.');
      return;
    }
    const payload = {
      siteId: planForm.siteId,
      scenario: planForm.scenario,
      chainOfAction,
      contacts,
      lastDrillDate: planForm.lastDrillDate || null,
      isActive: planForm.isActive
    };
    const saved = await runAction(
      () => editingPlan
        ? apiClient.patch(`/emergency-plans/${editingPlan.id}`, { ...payload, revisionVersion: editingPlan.revisionVersion })
        : apiClient.post('/emergency-plans', payload),
      editingPlan ? 'Notfallplan wurde aktualisiert.' : 'Notfallplan wurde angelegt.'
    );
    if (saved) setPlanEditorOpen(false);
  };

  const saveIncident = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!incidentForm.siteId || !incidentForm.title.trim()) {
      setError('Objekt und Meldungstitel sind erforderlich.');
      return;
    }
    const saved = await runAction(
      () => apiClient.post('/alarms', {
        ...incidentForm,
        emergencyPlanId: incidentForm.emergencyPlanId || null,
        title: incidentForm.title.trim(),
        description: incidentForm.description.trim()
      }),
      'Alarm wurde serverseitig erfasst.'
    );
    if (saved) {
      setIncidentEditorOpen(false);
      setIncidentForm({ ...blankIncident, siteId: sites[0]?.id ?? '' });
    }
  };

  const transition = (incident: AlarmIncident, action: 'acknowledge' | 'escalate' | 'resolve') => {
    const note = transitionNotes[incident.id]?.trim();
    if (!note) {
      setError('Bitte vor der Statusänderung eine kurze Maßnahme oder Begründung dokumentieren.');
      return;
    }
    void runAction(
      () => apiClient.post(`/alarms/${incident.id}/transitions`, {
        action, note, revisionVersion: incident.revisionVersion
      }),
      action === 'resolve' ? 'Alarm wurde abgeschlossen.' : 'Alarmstatus wurde aktualisiert.'
    );
  };

  const toggleActivity = async (kind: 'alarms' | 'emergency-plans', id: string) => {
    if (activity?.targetId === id) {
      setActivity(null);
      return;
    }
    setError('');
    try {
      const events = await apiClient.get<ActivityEvent[]>(`/${kind}/${id}/events`);
      setActivity({ targetId: id, events });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Verlauf konnte nicht geladen werden.');
    }
  };

  const recordDrill = (plan: EmergencyPlan) => {
    const drillDate = new Date().toISOString().slice(0, 10);
    void runAction(
      () => apiClient.post(`/emergency-plans/${plan.id}/drills`, { drillDate }),
      'Übung wurde dokumentiert.'
    );
  };

  const archivePlan = (plan: EmergencyPlan) => {
    if (!window.confirm(`Notfallplan "${plan.scenario}" für ${plan.siteName} archivieren?`)) return;
    void runAction(
      () => apiClient.post(`/emergency-plans/${plan.id}/archive`, { revisionVersion: plan.revisionVersion }),
      'Notfallplan wurde archiviert.'
    );
  };

  if (!canRead) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-sm text-slate-300">
        Für Alarm- und Notfallmanagement ist eine ausdrückliche Leseberechtigung erforderlich.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Siren className="h-6 w-6 text-rose-500" />
            <h1 className="text-xl font-bold text-white">Alarm- &amp; Notfallmanagement</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Mandantengeschützte Notfallpläne, Vorfallreaktion und nachvollziehbare Maßnahmenprotokolle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runAction(() => loadTenantData(), 'Daten wurden aktualisiert.')}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Aktualisieren
          </button>
          {canReport && (
            <button type="button" onClick={() => { setIncidentEditorOpen(true); setError(''); }} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-500">
              <Plus className="h-4 w-4" /> Alarm melden
            </button>
          )}
          {canManage && view === 'plans' && (
            <button type="button" onClick={() => openPlan()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500">
              <Plus className="h-4 w-4" /> Notfallplan anlegen
            </button>
          )}
        </div>
      </header>

      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`flex items-start justify-between gap-4 rounded-xl border p-3 text-sm ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <span>{error || notice}</span>
          <button type="button" aria-label="Meldung schließen" onClick={() => { setError(''); setNotice(''); }}><X className="h-4 w-4" /></button>
        </div>
      )}

      <nav className="flex gap-2 border-b border-slate-800">
        <button type="button" onClick={() => setView('incidents')} className={`border-b-2 px-3 py-2 text-sm ${view === 'incidents' ? 'border-rose-500 text-white' : 'border-transparent text-slate-400'}`}>
          Vorfälle <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.5 text-xs">{openIncidents.length}</span>
        </button>
        <button type="button" onClick={() => setView('plans')} className={`border-b-2 px-3 py-2 text-sm ${view === 'plans' ? 'border-blue-500 text-white' : 'border-transparent text-slate-400'}`}>
          Notfallpläne <span className="ml-1 rounded-full bg-slate-800 px-1.5 py-0.5 text-xs">{activePlans.length}</span>
        </button>
      </nav>

      {view === 'incidents' && (
        <section className="space-y-4">
          {openIncidents.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
              <p className="font-semibold text-white">Keine offenen Alarmvorfälle</p>
              <p className="mt-1 text-xs text-slate-400">Abgeschlossene Vorfälle bleiben im Verlauf einsehbar.</p>
            </div>
          )}
          {openIncidents.map((incident) => (
            <article key={incident.id} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${severityStyles[incident.severity]}`}>{incident.severity}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{statusLabels[incident.status]}</span>
                    <span className="text-[11px] text-slate-500">{incident.scenario}</span>
                  </div>
                  <h2 className="mt-2 text-base font-bold text-white">{incident.title}</h2>
                  <p className="mt-1 text-sm text-slate-300">{incident.siteName}</p>
                  {incident.description && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{incident.description}</p>}
                </div>
                <div className="shrink-0 text-xs text-slate-400">
                  <Clock3 className="mr-1 inline h-3.5 w-3.5" />{dateLabel(incident.reportedAt)}
                  {incident.reporterName && <span className="mt-1 block">Gemeldet von {incident.reporterName}</span>}
                </div>
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-800 pt-3 sm:flex-row sm:items-end sm:justify-between">
                <label className="min-w-0 flex-1 text-xs text-slate-400">
                  Maßnahme / Übergabenotiz
                  <textarea
                    value={transitionNotes[incident.id] ?? ''}
                    onChange={(event) => setTransitionNotes((current) => ({ ...current, [incident.id]: event.target.value }))}
                    disabled={!canRespond || busy}
                    rows={2}
                    maxLength={4000}
                    className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
                    placeholder="Dokumentation ist vor einer Statusänderung erforderlich"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {canRespond && incident.status === 'gemeldet' && (
                    <button type="button" onClick={() => transition(incident, 'acknowledge')} disabled={busy} className="rounded-lg border border-blue-500/40 px-3 py-2 text-xs font-semibold text-blue-200 hover:bg-blue-500/10 disabled:opacity-50">Bestätigen</button>
                  )}
                  {canRespond && ['gemeldet', 'bestätigt'].includes(incident.status) && (
                    <button type="button" onClick={() => transition(incident, 'escalate')} disabled={busy} className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/10 disabled:opacity-50">Eskalieren</button>
                  )}
                  {canRespond && (
                    <button type="button" onClick={() => transition(incident, 'resolve')} disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">Abschließen</button>
                  )}
                  <button type="button" onClick={() => void toggleActivity('alarms', incident.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
                    <Activity className="mr-1 inline h-3.5 w-3.5" /> Verlauf
                  </button>
                </div>
              </div>
              {activity?.targetId === incident.id && <ActivityTimeline events={activity.events} />}
            </article>
          ))}
          {alarmIncidents.filter((incident) => incident.status === 'abgeschlossen').length > 0 && (
            <details className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-300">Abgeschlossene Vorfälle ({alarmIncidents.filter((incident) => incident.status === 'abgeschlossen').length})</summary>
              <div className="mt-3 space-y-3">
                {alarmIncidents.filter((incident) => incident.status === 'abgeschlossen').map((incident) => (
                  <div key={incident.id} className="rounded-xl border border-slate-800 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="font-semibold text-white">{incident.title}</p><p className="mt-1 text-xs text-slate-400">{incident.siteName} · {incident.scenario} · {dateLabel(incident.reportedAt)}</p></div>
                      <button type="button" onClick={() => void toggleActivity('alarms', incident.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">Verlauf</button>
                    </div>
                    {incident.resolutionNote && <p className="mt-2 text-sm text-slate-300">{incident.resolutionNote}</p>}
                    {activity?.targetId === incident.id && <ActivityTimeline events={activity.events} />}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {view === 'plans' && (
        <section className="space-y-4">
          {emergencyPlans.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
              <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-blue-400" />
              <p className="font-semibold text-white">Noch keine Notfallpläne vorhanden</p>
              {canManage && <p className="mt-1 text-xs text-slate-400">Legen Sie je Objekt und Szenario eine verbindliche Maßnahmenkette an.</p>}
            </div>
          )}
          {emergencyPlans.map((plan) => (
            <article key={plan.id} className={`space-y-4 rounded-2xl border bg-slate-900 p-5 shadow-sm ${plan.isActive === false ? 'border-slate-800 opacity-70' : 'border-slate-800'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-xs font-bold text-rose-300">{plan.scenario}</span>
                    {plan.isActive === false && <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">Inaktiv</span>}
                  </div>
                  <h2 className="mt-2 text-base font-bold text-white">{plan.siteName}</h2>
                </div>
                <span className="text-xs text-slate-400"><Clock3 className="mr-1 inline h-3.5 w-3.5" />Letzte Übung: {plan.lastDrillDate ? new Date(plan.lastDrillDate).toLocaleDateString('de-DE') : 'Keine dokumentiert'}</span>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-300">Verbindliche Maßnahmenkette</h3>
                <ol className="space-y-1.5">
                  {plan.chainOfAction.map((step, index) => <li key={`${plan.id}-${index}`} className="rounded-lg border border-slate-800 bg-slate-800/40 p-2.5 text-sm text-slate-200">{index + 1}. {step}</li>)}
                </ol>
              </div>
              <div className="border-t border-slate-800 pt-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-300">Eskalationskontakte</h3>
                {plan.contacts.length === 0
                  ? <p className="text-xs text-slate-500">Keine Kontakte hinterlegt.</p>
                  : <div className="grid gap-2 sm:grid-cols-2">{plan.contacts.map((contact, index) => (
                    <div key={`${plan.id}-contact-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-800/80 p-2.5 text-xs">
                      <div><span className="block text-[10px] text-slate-400">{contact.role}</span><span className="font-semibold text-slate-200">{contact.name}</span></div>
                      <a href={`tel:${contact.phone}`} aria-label={`${contact.name} anrufen`} className="rounded-lg bg-blue-600/20 p-2 text-blue-300 hover:bg-blue-600/40"><Phone className="h-3.5 w-3.5" /></a>
                    </div>
                  ))}</div>}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                <button type="button" onClick={() => void toggleActivity('emergency-plans', plan.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"><Activity className="mr-1 inline h-3.5 w-3.5" />Verlauf</button>
                {canManage && plan.isActive !== false && <>
                  <button type="button" onClick={() => openPlan(plan)} className="rounded-lg border border-blue-500/40 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/10">Bearbeiten</button>
                  <button type="button" onClick={() => recordDrill(plan)} disabled={busy} className="rounded-lg border border-emerald-500/40 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"><Radio className="mr-1 inline h-3.5 w-3.5" />Übung heute dokumentieren</button>
                  <button type="button" onClick={() => archivePlan(plan)} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"><Archive className="mr-1 inline h-3.5 w-3.5" />Archivieren</button>
                </>}
              </div>
              {activity?.targetId === plan.id && <ActivityTimeline events={activity.events} />}
            </article>
          ))}
        </section>
      )}

      {incidentEditorOpen && (
        <form onSubmit={saveIncident} className="space-y-4 rounded-2xl border border-rose-500/30 bg-slate-900 p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-white">Alarmvorfall melden</h2><button type="button" onClick={() => setIncidentEditorOpen(false)} aria-label="Formular schließen"><X className="h-4 w-4 text-slate-400" /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Objekt"><select required value={incidentForm.siteId} onChange={(event) => setIncidentForm((form) => ({ ...form, siteId: event.target.value, emergencyPlanId: '' }))} className={inputClass}><option value="">Objekt auswählen</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
            <Field label="Szenario"><select value={incidentForm.scenario} onChange={(event) => setIncidentForm((form) => ({ ...form, scenario: event.target.value as IncidentForm['scenario'], emergencyPlanId: '' }))} className={inputClass}>{scenarios.map((scenario) => <option key={scenario}>{scenario}</option>)}</select></Field>
            <Field label="Schweregrad"><select value={incidentForm.severity} onChange={(event) => setIncidentForm((form) => ({ ...form, severity: event.target.value as IncidentForm['severity'] }))} className={inputClass}>{(['Niedrig', 'Normal', 'Dringend', 'Kritisch'] as const).map((severity) => <option key={severity}>{severity}</option>)}</select></Field>
            <Field label="Passender Notfallplan"><select value={incidentForm.emergencyPlanId} onChange={(event) => setIncidentForm((form) => ({ ...form, emergencyPlanId: event.target.value }))} className={inputClass}><option value="">Kein Plan verknüpfen</option>{selectedSitePlans.filter((plan) => plan.scenario === incidentForm.scenario).map((plan) => <option key={plan.id} value={plan.id}>{plan.scenario}</option>)}</select></Field>
            <Field label="Meldetitel"><input required maxLength={255} value={incidentForm.title} onChange={(event) => setIncidentForm((form) => ({ ...form, title: event.target.value }))} className={inputClass} /></Field>
            <Field label="Beschreibung"><textarea maxLength={8000} rows={3} value={incidentForm.description} onChange={(event) => setIncidentForm((form) => ({ ...form, description: event.target.value }))} className={inputClass} /></Field>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setIncidentEditorOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Abbrechen</button><button type="submit" disabled={busy || !sites.length} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Flame className="mr-1 inline h-4 w-4" />Meldung speichern</button></div>
        </form>
      )}

      {planEditorOpen && canManage && (
        <form onSubmit={savePlan} className="space-y-4 rounded-2xl border border-blue-500/30 bg-slate-900 p-5">
          <div className="flex items-center justify-between"><h2 className="font-bold text-white">{editingPlan ? 'Notfallplan bearbeiten' : 'Notfallplan anlegen'}</h2><button type="button" onClick={() => setPlanEditorOpen(false)} aria-label="Formular schließen"><X className="h-4 w-4 text-slate-400" /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Objekt"><select required value={planForm.siteId} onChange={(event) => setPlanForm((form) => ({ ...form, siteId: event.target.value }))} className={inputClass}><option value="">Objekt auswählen</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field>
            <Field label="Szenario"><select value={planForm.scenario} onChange={(event) => setPlanForm((form) => ({ ...form, scenario: event.target.value as PlanForm['scenario'] }))} className={inputClass}>{scenarios.map((scenario) => <option key={scenario}>{scenario}</option>)}</select></Field>
            <Field label="Maßnahmenkette (ein Schritt je Zeile)"><textarea required rows={5} value={planForm.chainOfAction} onChange={(event) => setPlanForm((form) => ({ ...form, chainOfAction: event.target.value }))} className={inputClass} /></Field>
            <Field label="Eskalationskontakte (Rolle | Name | Telefon je Zeile)"><textarea rows={5} value={planForm.contacts} onChange={(event) => setPlanForm((form) => ({ ...form, contacts: event.target.value }))} className={inputClass} placeholder="Feuerwehr Leitstelle | Notruf | 112" /></Field>
            <Field label="Letzte Übung"><input type="date" value={planForm.lastDrillDate} onChange={(event) => setPlanForm((form) => ({ ...form, lastDrillDate: event.target.value }))} className={inputClass} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300"><input type="checkbox" checked={planForm.isActive} onChange={(event) => setPlanForm((form) => ({ ...form, isActive: event.target.checked }))} />Plan aktiv</label>
          </div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setPlanEditorOpen(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Abbrechen</button><button type="submit" disabled={busy || !sites.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Speichern</button></div>
        </form>
      )}

      {sites.length === 0 && canRead && <p className="text-xs text-slate-500">Für diesen Mandanten sind keine aktiven Objekte geladen.</p>}
    </div>
  );
};

const inputClass = 'mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-blue-500 focus:outline-none';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-xs font-medium text-slate-300">{label}{children}</label>
);

const ActivityTimeline: React.FC<{ events: ActivityEvent[] }> = ({ events }) => (
  <div className="space-y-2 border-t border-slate-800 pt-3">
    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Nachvollziehbarer Verlauf</h3>
    {events.length === 0 ? <p className="text-xs text-slate-500">Noch keine Ereignisse.</p> : events.map((event) => (
      <div key={event.id} className="rounded-lg bg-slate-800/50 p-2.5 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-200">{actionLabels[event.action] ?? event.action}</span><span className="text-slate-500">{dateLabel(event.occurred_at)}</span></div>
        <p className="mt-1 text-slate-400">{event.actor_name}{event.details?.note ? ` · ${event.details.note}` : ''}{event.details?.drillDate ? ` · Übung am ${event.details.drillDate}` : ''}</p>
      </div>
    ))}
  </div>
);
