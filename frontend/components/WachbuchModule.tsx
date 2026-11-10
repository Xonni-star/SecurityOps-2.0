import React, { useState } from 'react';
import {
  BookOpenCheck,
  AlertTriangle,
  Plus,
  ShieldAlert,
  Search,
  CheckCircle2,
  FileText,
  Camera,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { store } from '../services/store';
import { Incident } from '../types';
import { analyzeIncidentReport, IncidentAnalysisResult } from '../services/geminiService';

interface WachbuchModuleProps {
  globalSearch: string;
}

export const WachbuchModule: React.FC<WachbuchModuleProps> = ({ globalSearch }) => {
  const [filterPriority, setFilterPriority] = useState<string>('Alle');
  const [filterCategory, setFilterCategory] = useState<string>('Alle');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState<boolean>(false);
  const [aiAnalysis, setAiAnalysis] = useState<IncidentAnalysisResult | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [siteId, setSiteId] = useState(store.sites[0]?.id || '');
  const [category, setCategory] = useState<Incident['category']>('Einbruchversuch');
  const [priority, setPriority] = useState<Incident['priority']>('Hoch');
  const [guardName, setGuardName] = useState('Timo Kranz');
  const [description, setDescription] = useState('');
  const [actionsTaken, setActionsTaken] = useState('');
  const [policeInvolved, setPoliceInvolved] = useState(false);

  const incidents = store.incidents.filter((inc) => {
    const matchesSearch =
      inc.title.toLowerCase().includes(globalSearch.toLowerCase()) ||
      inc.description.toLowerCase().includes(globalSearch.toLowerCase()) ||
      inc.siteName.toLowerCase().includes(globalSearch.toLowerCase()) ||
      inc.incidentNumber.toLowerCase().includes(globalSearch.toLowerCase());

    const matchesPriority = filterPriority === 'Alle' || inc.priority === filterPriority;
    const matchesCategory = filterCategory === 'Alle' || inc.category === filterCategory;

    return matchesSearch && matchesPriority && matchesCategory;
  });

  const handleCreateIncident = (e: React.FormEvent) => {
    e.preventDefault();
    const site = store.sites.find((s) => s.id === siteId);

    store.addIncident({
      siteId,
      siteName: site ? site.name : 'Unbekanntes Objekt',
      guardName,
      category,
      priority,
      title,
      description,
      actionsTaken,
      policeInvolved,
      resolved: false,
      imagesCount: 1,
      escalationStatus: priority === 'KRITISCH' ? 'Eskaliert' : 'In Bearbeitung'
    });

    setShowAddModal(false);
    // Reset form
    setTitle('');
    setDescription('');
    setActionsTaken('');
  };

  const handleRunAiAnalysis = async (inc: Incident) => {
    setIsAiAnalyzing(true);
    setAiAnalysis(null);
    try {
      const res = await analyzeIncidentReport(
        inc.title,
        inc.category,
        inc.siteName,
        inc.description,
        inc.actionsTaken
      );
      setAiAnalysis(res);
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header and Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <BookOpenCheck className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Digitales Wachbuch & Vorfallerfassung</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-medium">
              Revisionssicher gem. DIN 77200
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Lückenlose Dokumentation von Ereignissen, Kontrollgängen und Vorkommnissen mit Zeitstempel.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Neuen Vorfall erfassen</span>
          </button>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400 mr-2">Filter nach Priorität:</span>
        {['Alle', 'KRITISCH', 'Hoch', 'Mittel', 'Niedrig'].map((p) => (
          <button
            key={p}
            onClick={() => setFilterPriority(p)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
              filterPriority === p
                ? 'bg-brand-600 border-brand-500 text-white font-semibold'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Incident List */}
      <div className="grid grid-cols-1 gap-3">
        {incidents.map((inc) => (
          <div
            key={inc.id}
            className={`p-4 rounded-xl border transition-all ${
              inc.priority === 'KRITISCH'
                ? 'bg-rose-950/20 border-rose-900/50 hover:border-rose-700'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-bold text-slate-400">{inc.incidentNumber}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold ${
                    inc.priority === 'KRITISCH'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse'
                      : inc.priority === 'Hoch'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                  }`}
                >
                  {inc.priority}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                  {inc.category}
                </span>
                <span className="text-xs text-slate-400">🕒 {inc.timestamp}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedIncident(inc);
                    handleRunAiAnalysis(inc);
                  }}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 hover:bg-indigo-900 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  KI-Analyse
                </button>
                <button
                  onClick={() =>
                    store.updateIncidentStatus(
                      inc.id,
                      inc.resolved ? 'In Bearbeitung' : 'Abgeschlossen',
                      !inc.resolved
                    )
                  }
                  className={`text-xs px-2.5 py-1 rounded font-medium border ${
                    inc.resolved
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 hover:bg-emerald-900'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {inc.resolved ? '✓ Abgeschlossen' : 'Offen markieren'}
                </button>
              </div>
            </div>

            <h3 className="font-bold text-white text-sm mb-1">{inc.title}</h3>
            <p className="text-xs text-slate-300 mb-2 leading-relaxed">{inc.description}</p>

            <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs space-y-1 mb-2">
              <p className="text-slate-300">
                <strong className="text-brand-300">Eingeleitete Maßnahmen:</strong> {inc.actionsTaken}
              </p>
              <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                <span>📍 Objekt: {inc.siteName}</span>
                <span>👮 Wachmann: {inc.guardName}</span>
                <span>
                  🚔 Polizei eingeschaltet:{' '}
                  <strong className={inc.policeInvolved ? 'text-rose-400' : 'text-slate-400'}>
                    {inc.policeInvolved ? 'JA' : 'NEIN'}
                  </strong>
                </span>
                <span>📷 {inc.imagesCount} Fotos angehängt</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI Incident Analysis Drawer Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">
                  KI-Sicherheitsbewertung & Maßnahmenplan
                </h3>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕ Schließen
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-1 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <p>
                <strong>Vorkommnis:</strong> {selectedIncident.title}
              </p>
              <p>
                <strong>Objekt:</strong> {selectedIncident.siteName} | {selectedIncident.timestamp}
              </p>
            </div>

            {isAiAnalyzing ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-xs text-slate-300 font-mono">
                  Gemini analysiert DIN 77200 Konformität & Bedrohungslage...
                </p>
              </div>
            ) : aiAnalysis ? (
              <div className="space-y-4 text-xs">
                <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700">
                  <span className="font-bold text-brand-300 block mb-1">Einschätzung der Bedrohungslage:</span>
                  <p className="text-white font-semibold text-sm">
                    Gefahrenstufe: <span className="text-rose-400">{aiAnalysis.threatLevel}</span>
                  </p>
                  <p className="text-slate-300 mt-1">{aiAnalysis.summary}</p>
                </div>

                <div className="p-3 rounded-xl bg-brand-950/30 border border-brand-800/50">
                  <span className="font-bold text-cyan-300 block mb-1">
                    DIN 77200 & Meldeweg-Konformität:
                  </span>
                  <p className="text-slate-300">{aiAnalysis.din77200ComplianceNotes}</p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <span className="font-bold text-amber-300 block mb-1.5">
                    Dringend empfohlene Sofortmaßnahmen:
                  </span>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {aiAnalysis.recommendedImmediateActions.map((action, idx) => (
                      <li key={idx}>{action}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700">
                  <span className="font-bold text-emerald-300 block mb-1">
                    Textentwurf für Kunden- oder Polizeimeldung:
                  </span>
                  <p className="text-slate-300 italic">{aiAnalysis.policeReportDraft}</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* New Incident Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateIncident}
            className="bg-slate-900 border border-slate-800 w-full max-w-xl rounded-2xl p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neues Vorkommnis ins Wachbuch eintragen</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Betroffenes Objekt</label>
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  {store.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.siteCode} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Kategorie</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Incident['category'])}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Einbruchversuch">Einbruchversuch</option>
                  <option value="Brandmeldeauslösung">Brandmeldeauslösung</option>
                  <option value="Zutrittsverstoß">Zutrittsverstoß</option>
                  <option value="Vandalismus">Vandalismus</option>
                  <option value="Technischer Defekt">Technischer Defekt</option>
                  <option value="Routinekontrolle">Routinekontrolle</option>
                  <option value="Personenkontrolle">Personenkontrolle</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Priorität</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Incident['priority'])}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-bold"
                >
                  <option value="Niedrig">Niedrig</option>
                  <option value="Mittel">Mittel</option>
                  <option value="Hoch">Hoch</option>
                  <option value="KRITISCH">KRITISCH</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Wachhabender / Melder</label>
                <input
                  type="text"
                  value={guardName}
                  onChange={(e) => setGuardName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-400 mb-1">Kurztitel des Vorfalls</label>
              <input
                type="text"
                placeholder="z.B. Zaunbeschädigung Sektor C oder Falscher RZ-Alarm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="text-xs">
              <label className="block text-slate-400 mb-1">Detaillierter Sachverhalt</label>
              <textarea
                rows={3}
                placeholder="Was ist genau vorgefallen? Zeit, Ort, Feststellungen, Zeugen..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="text-xs">
              <label className="block text-slate-400 mb-1">Eingeleitete Sofortmaßnahmen</label>
              <input
                type="text"
                placeholder="z.B. Bereich abgeriegelt, Einsatzleitung alarmiert, Spuren gesichert..."
                value={actionsTaken}
                onChange={(e) => setActionsTaken(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                id="policeCheck"
                checked={policeInvolved}
                onChange={(e) => setPoliceInvolved(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-brand-500"
              />
              <label htmlFor="policeCheck">Polizei oder Feuerwehr wurde hinzugezogen</label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500"
              >
                Eintrag speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
