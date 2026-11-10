import React, { useState } from 'react';
import {
  Zap,
  Play,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Key,
  CheckCircle2,
  Calendar,
  Building2,
  FileCheck2,
  Plus,
  Copy,
  Trash2,
  Edit3,
  Sliders,
  Filter,
  Check,
  History,
  Send,
  HelpCircle,
  ExternalLink
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { AutomationRule, AutomationTriggerEvent, ActionType, ConditionOperator, UserRole } from '../types';

export const AutomationCenter: React.FC = () => {
  const {
    getTenantAutomations,
    automationTemplates,
    getTenantExecutionLogs,
    addAutomationRule,
    updateAutomationRule,
    deleteAutomationRule,
    duplicateAutomationRule,
    toggleAutomationRule,
    testRunRule,
    runAutomationsNow,
    getTenantEmployees,
    getTenantClients,
    getTenantKeys,
    getCurrentTenant
  } = useSecurityStore();

  const tenant = getCurrentTenant();
  const automations = getTenantAutomations();
  const executionLogs = getTenantExecutionLogs();
  const employees = getTenantEmployees();
  const clients = getTenantClients();
  const keys = getTenantKeys();

  const [activeTab, setActiveTab] = useState<'rules' | 'builder' | 'templates' | 'logs'>('rules');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [isTestRunning, setIsTestRunning] = useState<string | null>(null);
  const [testResultFeedback, setTestResultFeedback] = useState<string | null>(null);

  // Visual Rule Builder State
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [builderName, setBuilderName] = useState('');
  const [builderDescription, setBuilderDescription] = useState('');
  const [builderCategory, setBuilderCategory] = useState<AutomationRule['category']>('Personal');
  const [builderTrigger, setBuilderTrigger] = useState<AutomationTriggerEvent>('QUALIFICATION_EXPIRING');
  const [builderConditionField, setBuilderConditionField] = useState('daysUntilExpiry');
  const [builderConditionOp, setBuilderConditionOp] = useState<ConditionOperator>('LESS_THAN_DAYS');
  const [builderConditionVal, setBuilderConditionVal] = useState<number>(30);
  const [builderActionType, setBuilderActionType] = useState<ActionType>('CREATE_TASK');
  const [builderActionRole, setBuilderActionRole] = useState<UserRole>(UserRole.HR);
  const [builderTaskTitle, setBuilderTaskTitle] = useState('Nachschulung erforderlich für {employeeName}');

  const filteredRules = automations.filter(
    (r) => filterCategory === 'ALL' || r.category === filterCategory
  );

  const handleRunNow = () => {
    runAutomationsNow();
  };

  const handleTestRun = (ruleId: string) => {
    setIsTestRunning(ruleId);
    setTimeout(() => {
      const result = testRunRule(ruleId);
      setTestResultFeedback(`Probelauf erfolgreich (${result.durationMs}ms): Aktionen [${result.actions.join(', ')}] ausgewertet.`);
      setIsTestRunning(null);
      setTimeout(() => setTestResultFeedback(null), 4000);
    }, 450);
  };

  const handleOpenBuilderNew = () => {
    setEditingRuleId(null);
    setBuilderName('Neue Sicherheitsregel');
    setBuilderDescription('Regelmäßige Prüfung und automatische Benachrichtigung.');
    setBuilderCategory('Personal');
    setBuilderTrigger('QUALIFICATION_EXPIRING');
    setBuilderConditionField('daysUntilExpiry');
    setBuilderConditionOp('LESS_THAN_DAYS');
    setBuilderConditionVal(30);
    setBuilderActionType('CREATE_TASK');
    setBuilderActionRole(UserRole.HR);
    setBuilderTaskTitle('Erinnerung: Nachschulung {employeeName}');
    setActiveTab('builder');
  };

  const handleSaveBuilderRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!builderName.trim()) return;

    const ruleData = {
      name: builderName,
      description: builderDescription,
      category: builderCategory,
      trigger: builderTrigger,
      active: true,
      conditions: [
        {
          field: builderConditionField,
          operator: builderConditionOp,
          value: builderConditionVal
        }
      ],
      actions: [
        {
          type: builderActionType,
          targetRole: builderActionRole,
          taskTitleTemplate: builderTaskTitle,
          taskPriority: 'Hoch' as const,
          notificationTitle: `Automatisierung: ${builderName}`,
          notificationMessage: builderDescription,
          notificationSeverity: 'WARNUNG' as const
        }
      ]
    };

    if (editingRuleId) {
      updateAutomationRule(editingRuleId, ruleData);
    } else {
      addAutomationRule(ruleData);
    }

    setActiveTab('rules');
  };

  const handleApplyTemplate = (tmpl: AutomationRule) => {
    addAutomationRule({
      name: tmpl.name.replace('Vorlage: ', ''),
      description: tmpl.description,
      category: tmpl.category,
      trigger: tmpl.trigger,
      conditions: tmpl.conditions,
      actions: tmpl.actions,
      active: true
    });
    setActiveTab('rules');
  };

  return (
    <div className="space-y-6">
      {/* Header and Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-amber-400" />
            <h1 className="text-xl font-bold text-white">Automatisierungsengine & Intelligente Arbeitsabläufe</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deklarative Event-Trigger, konfigurierbare Bedingungen, Idempotenz-Schutz und lückenlose Ausführungsprotokolle für {tenant.name}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunNow}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs shadow-lg shadow-amber-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
          >
            <Play className="w-4 h-4" />
            <span>Jetzt Ausführen</span>
          </button>
          <button
            onClick={handleOpenBuilderNew}
            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Regel erstellen</span>
          </button>
        </div>
      </div>

      {/* Test Feedback Notice */}
      {testResultFeedback && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{testResultFeedback}</span>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Aktive Regeln</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">
            {automations.filter((a) => a.active).length} / {automations.length}
          </span>
          <span className="text-[10px] text-emerald-400">100% Mandant isoliert</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Ausgelöste Aktionen</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">
            {automations.reduce((sum, r) => sum + r.actionsTriggeredCount, 0)} Aktionen
          </span>
          <span className="text-[10px] text-slate-500">Tasks & Benachrichtigungen</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Ausführungsprotokolle</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">{executionLogs.length} Einträge</span>
          <span className="text-[10px] text-blue-400">Idempotent geprüft</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Regel-Vorlagen</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">{automationTemplates.length} Vorlagen</span>
          <span className="text-[10px] text-slate-400">DIN 77200 & BSI Best Practices</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('rules')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            activeTab === 'rules' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Konfigurierte Regeln ({automations.length})
        </button>
        <button
          onClick={() => setActiveTab('builder')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            activeTab === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Visueller Regel-Editor
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            activeTab === 'templates' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Vorlagen-Bibliothek ({automationTemplates.length})
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'logs' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Ausführungsprotokoll ({executionLogs.length})</span>
        </button>
      </div>

      {/* Tab 1: Rules List */}
      {activeTab === 'rules' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
            <span className="text-slate-400 font-medium">Filter nach Bereich:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {['ALL', 'Personal', 'Verträge', 'Wachbuch', 'Schlüssel', 'Dienstplan', 'QM'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                    filterCategory === cat ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {cat === 'ALL' ? 'Alle anzeigen' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredRules.map((rule) => (
              <div
                key={rule.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-2 max-w-2xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-200 text-sm">{rule.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-blue-400 border border-slate-700">
                      {rule.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      rule.active ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {rule.active ? 'Aktiv' : 'Pausiert'}
                    </span>
                  </div>

                  <p className="text-slate-400 text-xs leading-relaxed">{rule.description}</p>

                  <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono flex-wrap">
                    <span>Trigger: <strong className="text-slate-300">{rule.trigger}</strong></span>
                    <span>•</span>
                    <span>Aktionen: <strong className="text-slate-300">{rule.actions.map((a) => a.type).join(', ')}</strong></span>
                    <span>•</span>
                    <span>Ausgelöst: <strong className="text-emerald-400">{rule.actionsTriggeredCount}x</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={() => handleTestRun(rule.id)}
                    disabled={isTestRunning === rule.id}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1 transition"
                    title="Testlauf durchführen"
                  >
                    <Play className={`w-3 h-3 ${isTestRunning === rule.id ? 'animate-spin' : ''}`} />
                    <span>Testen</span>
                  </button>

                  <button
                    onClick={() => duplicateAutomationRule(rule.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
                    title="Regel duplizieren"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => toggleAutomationRule(rule.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      rule.active
                        ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {rule.active ? 'Pausieren' : 'Aktivieren'}
                  </button>

                  <button
                    onClick={() => deleteAutomationRule(rule.id)}
                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
                    title="Löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Visual Rule Builder */}
      {activeTab === 'builder' && (
        <form onSubmit={handleSaveBuilderRule} className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 text-xs">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">Deklarativer Regel-Editor</h2>
            <p className="text-slate-400 text-xs">
              Sichere, kontrollierte Regeldefinition ohne freien Code oder SQL-Injektionen.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Regelname *</label>
              <input
                type="text"
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Fachbereich</label>
              <select
                value={builderCategory}
                onChange={(e) => setBuilderCategory(e.target.value as any)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200"
              >
                <option value="Personal">Personal</option>
                <option value="Verträge">Verträge</option>
                <option value="Wachbuch">Wachbuch</option>
                <option value="Schlüssel">Schlüssel</option>
                <option value="Dienstplan">Dienstplan</option>
                <option value="QM">QM</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Beschreibung</label>
            <input
              type="text"
              value={builderDescription}
              onChange={(e) => setBuilderDescription(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200"
            />
          </div>

          {/* Trigger & Condition Blocks */}
          <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 space-y-4">
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block">
              1. Ereignis-Auslöser (Trigger):
            </span>
            <select
              value={builderTrigger}
              onChange={(e) => setBuilderTrigger(e.target.value as any)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono"
            >
              <option value="QUALIFICATION_EXPIRING">QUALIFICATION_EXPIRING (Ablaufende Mitarbeiterqualifikation)</option>
              <option value="CONTRACT_EXPIRING">CONTRACT_EXPIRING (Ablaufender Mandantenvertrag)</option>
              <option value="KEY_OVERDUE">KEY_OVERDUE (Überfälliger Generalschlüssel)</option>
              <option value="INCIDENT_CREATED">INCIDENT_CREATED (Neuer Wachbucheintrag erfasst)</option>
              <option value="SHIFT_CONFLICT_DETECTED">SHIFT_CONFLICT_DETECTED (Dienstplankonflikt / ArbZG)</option>
              <option value="SOP_UNACKNOWLEDGED">SOP_UNACKNOWLEDGED (Dienstanweisung unbestätigt)</option>
            </select>

            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block mt-4">
              2. Bedingungen (Filter):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={builderConditionField}
                onChange={(e) => setBuilderConditionField(e.target.value)}
                placeholder="Feldname"
                className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
              />
              <select
                value={builderConditionOp}
                onChange={(e) => setBuilderConditionOp(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono"
              >
                <option value="LESS_THAN_DAYS">LESS_THAN_DAYS (&lt; Tage)</option>
                <option value="EQUALS">EQUALS (=)</option>
                <option value="GREATER_THAN">GREATER_THAN (&gt;)</option>
                <option value="IN_ARRAY">IN_ARRAY (in Liste)</option>
              </select>
              <input
                type="number"
                value={builderConditionVal}
                onChange={(e) => setBuilderConditionVal(Number(e.target.value))}
                placeholder="Vergleichswert"
                className="bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
              />
            </div>

            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider block mt-4">
              3. Folgemaßnahmen (Actions):
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Aktionstyp</label>
                <select
                  value={builderActionType}
                  onChange={(e) => setBuilderActionType(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono"
                >
                  <option value="CREATE_TASK">CREATE_TASK (Aufgabe anlegen)</option>
                  <option value="SEND_NOTIFICATION">SEND_NOTIFICATION (In-App Meldung)</option>
                  <option value="ESCALATE_INCIDENT">ESCALATE_INCIDENT (Vorfall eskalieren)</option>
                  <option value="SET_KEY_OVERDUE">SET_KEY_OVERDUE (Schlüssel sperren)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Ziel-Rolle</label>
                <select
                  value={builderActionRole}
                  onChange={(e) => setBuilderActionRole(e.target.value as any)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  {Object.values(UserRole).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Aufgabentitel Template</label>
              <input
                type="text"
                value={builderTaskTitle}
                onChange={(e) => setBuilderTaskTitle(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('rules')}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
            >
              Regel speichern & aktivieren
            </button>
          </div>
        </form>
      )}

      {/* Tab 3: Templates Library */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Vorkonfigurierte Best-Practice Automatisierungen nach DIN 77200: Kopieren Sie eine Vorlage in den aktiven Mandantenbestand.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {automationTemplates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200 text-sm">{tmpl.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400">
                      {tmpl.category}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mt-2">{tmpl.description}</p>
                  <div className="mt-3 text-[11px] text-slate-500 font-mono">
                    Trigger: {tmpl.trigger} • Aktionen: {tmpl.actions.map((a) => a.type).join(', ')}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 flex justify-end">
                  <button
                    onClick={() => handleApplyTemplate(tmpl)}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
                  >
                    In Mandant übernehmen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Execution Logs */}
      {activeTab === 'logs' && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Ausführungsverlauf & Idempotenzprotokoll</h2>
            <span className="text-[11px] text-slate-400 font-mono">{executionLogs.length} Protokolle</span>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left text-slate-300">
              <thead className="bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800 font-semibold">
                <tr>
                  <th className="p-3">Zeitpunkt</th>
                  <th className="p-3">Regel</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Betroffene Entität</th>
                  <th className="p-3">Aktionen</th>
                  <th className="p-3 text-right">Dauer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {executionLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-3 text-slate-400 text-[11px]">{log.executedAt}</td>
                    <td className="p-3 font-sans font-semibold text-slate-200">{log.ruleName}</td>
                    <td className="p-3 font-sans">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="p-3 text-slate-400 font-sans text-xs">{log.matchedEntityDesc || 'Keine'}</td>
                    <td className="p-3 text-blue-400 text-[11px]">{log.actionsExecuted.join(', ')}</td>
                    <td className="p-3 text-right text-slate-400 text-[11px]">{log.executionDurationMs}ms</td>
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
