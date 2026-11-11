import React, { useState } from 'react';
import {
  BookOpen,
  Plus,
  AlertOctagon,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Sparkles,
  ShieldCheck,
  Camera,
  MapPin,
  Flame,
  FileCheck,
  WifiOff,
  History,
  Paperclip
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { GuardBookEntry } from '../types';
import { generateIncidentAnalysis, IncidentAnalysisResult } from '../geminiService';
import { offlineVault } from '../services/indexedDbService';

export const GuardBookModule: React.FC = () => {
  const {
    getTenantGuardBook,
    getTenantSites,
    getTenantEmployees,
    addGuardBookEntry,
    updateGuardBookStage,
    resolveGuardBookEntry,
    isOnline
  } = useSecurityStore();

  const guardBook = getTenantGuardBook();
  const sites = getTenantSites();
  const employees = getTenantEmployees();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEntryForRevision, setSelectedEntryForRevision] = useState<GuardBookEntry | null>(null);

  // Form states for new entry
  const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id || '');
  const [selectedGuardId, setSelectedGuardId] = useState(employees[0]?.id || '');
  const [category, setCategory] = useState<GuardBookEntry['category']>('Vorkommnis');
  const [priority, setPriority] = useState<GuardBookEntry['priority']>('Normal');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [policeInvolved, setPoliceInvolved] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // AI Assistant in modal
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<IncidentAnalysisResult | null>(null);

  const filteredLogs = guardBook.filter((entry) => {
    const matchesCategory = categoryFilter === 'ALL' || entry.category === categoryFilter;
    const matchesSearch =
      entry.title.toLowerCase().includes(search.toLowerCase()) ||
      entry.description.toLowerCase().includes(search.toLowerCase()) ||
      entry.siteName.toLowerCase().includes(search.toLowerCase()) ||
      entry.guardName.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Foto ist zu groß! Maximal 5 MB erlaubt.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setPhotoPreview(uploadEvent.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAIAssist = async () => {
    if (!description.trim()) {
      alert('Bitte geben Sie zuerst einige Stichpunkte zum Vorfall in das Beschreibungsfeld ein.');
      return;
    }
    setIsAnalyzing(true);
    const siteObj = sites.find((s) => s.id === selectedSiteId);
    const guardObj = employees.find((e) => e.id === selectedGuardId);

    try {
      const result = await generateIncidentAnalysis(
        description,
        siteObj?.name || 'Sicherheitsobjekt',
        guardObj ? `${guardObj.firstName} ${guardObj.lastName}` : 'Wachkraft'
      );
      setAiAnalysis(result);
      // Nur den noch nicht gespeicherten Entwurf befüllen; die KI schreibt nie selbst ins Wachbuch.
      setTitle(result.formalTitle);
      setDescription(result.formalReportDraft);
    } catch {
      alert('Die KI-Analyse ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const siteObj = sites.find((s) => s.id === selectedSiteId);
    const guardObj = employees.find((e) => e.id === selectedGuardId);

    const newId = `gb-${Date.now()}`;

    addGuardBookEntry({
      siteId: selectedSiteId,
      siteName: siteObj?.name || 'Unbekanntes Objekt',
      guardId: selectedGuardId,
      guardName: guardObj ? `${guardObj.firstName} ${guardObj.lastName}` : 'Wachkraft',
      category,
      priority,
      stage: 'Erfasst',
      title: title || 'Dienstprotokoll',
      description,
      policeInvolved,
      resolved: category === 'Routinemeldung' || category === 'Kontrollgang'
    });

    if (photoPreview) {
      await offlineVault.saveAttachment({
        id: `att-${Date.now()}`,
        tenantId: siteObj?.tenantId || 'tenant-frankfurt',
        entityId: newId,
        fileName: 'vorfall_fotodokumentation.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: Math.round(photoPreview.length * 0.75),
        blobData: photoPreview,
        capturedAt: new Date().toISOString(),
        synced: isOnline
      }).catch(console.error);
    }

    setIsModalOpen(false);
    setTitle('');
    setDescription('');
    setPhotoPreview(null);
    setAiAnalysis(null);
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Digitales Wachbuch & Vorfallsmanagement</h1>
            {!isOnline && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                <WifiOff className="w-3 h-3" /> Offline-Modus aktiv
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Revisionssichere Dokumentation nach DIN 77200 mit Offline-First Zwischenspeicherung.
          </p>
        </div>

                  <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Ereignis erfassen</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800">
        <div className="relative w-full sm:flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchbegriff im Wachbuch..."
            className="w-full bg-slate-800/80 text-xs text-slate-200 pl-9 pr-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full sm:w-auto bg-slate-800 text-xs text-slate-200 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none"
          >
            <option value="ALL">Alle Kategorien</option>
            <option value="Vorkommnis">Vorkommnis</option>
            <option value="Fehlalarm">Fehlalarm / Alarm</option>
            <option value="Kontrollgang">Kontrollgang</option>
            <option value="Schichtübergabe">Schichtübergabe</option>
            <option value="Polizeieinsatz">Polizeieinsatz</option>
            <option value="Routinemeldung">Routinemeldung</option>
          </select>
        </div>
      </div>

      {/* Log Feed List */}
      <div className="space-y-3">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center bg-slate-900/50 rounded-xl border border-slate-800 text-slate-400 text-xs">
            Keine Wachbucheinträge für diesen Mandanten gefunden.
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className={`p-4 rounded-xl bg-slate-900 border transition ${
                entry.priority === 'Kritisch'
                  ? 'border-rose-500/40 bg-rose-950/10'
                  : entry.priority === 'Dringend'
                  ? 'border-amber-500/30'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                    entry.category === 'Fehlalarm' || entry.priority === 'Kritisch'
                      ? 'bg-rose-500/20 text-rose-400'
                      : entry.category === 'Vorkommnis'
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {entry.category === 'Fehlalarm' ? <Flame className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">{entry.title}</span>
                      {entry.offlineCreated && (
                        <span className="px-2 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 font-mono">
                          Offline erfasst
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        entry.priority === 'Kritisch'
                          ? 'bg-rose-500 text-white'
                          : entry.priority === 'Dringend'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {entry.priority}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-medium">
                        Stufe: {entry.stage || 'Erfasst'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 mt-2 leading-relaxed whitespace-pre-wrap">
                      {entry.description}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {entry.siteName}
                      </span>
                      <span>Wachkraft: <strong className="text-slate-300">{entry.guardName}</strong></span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {new Date(entry.timestamp).toLocaleString('de-DE')}
                      </span>

                      {entry.revisions && entry.revisions.length > 0 && (
                        <button
                          onClick={() => setSelectedEntryForRevision(entry)}
                          className="text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
                        >
                          <History className="w-3 h-3" />
                          <span>{entry.revisions.length} Revision(en)</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 self-end md:self-start mt-2 md:mt-0 flex items-center gap-1.5">
                  {entry.resolved ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Erledigt
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        const note = prompt('Abschlussvermerk für Wachbucheintrag eingeben:');
                        if (note) resolveGuardBookEntry(entry.id, note);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 border border-amber-500/30 transition"
                    >
                      Abschließen
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Revisions History Drawer Modal */}
      {selectedEntryForRevision && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Revisionshistorie (Append-Only)</h3>
              </div>
              <button onClick={() => setSelectedEntryForRevision(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="mt-4 space-y-3 text-xs max-h-80 overflow-y-auto">
              {selectedEntryForRevision.revisions?.map((rev, idx) => (
                <div key={rev.id || idx} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                  <div className="flex items-center justify-between font-semibold text-slate-200">
                    <span>{rev.authorName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{rev.timestamp}</span>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-1">{rev.note}</p>
                </div>
              ))}
            </div>

            <div className="pt-3 mt-4 border-t border-slate-800 text-right">
              <button
                onClick={() => setSelectedEntryForRevision(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Guard Book Entry with Photo Attachment */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Neuer Wachbucheintrag</h3>
                {!isOnline && (
                  <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-bold">
                    Wird offline gespeichert
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Sicherheitsobjekt *</label>
                  <select
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    required
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.siteCode})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Protokollierende Wachkraft *</label>
                  <select
                    value={selectedGuardId}
                    onChange={(e) => setSelectedGuardId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                    required
                  >
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.personnelNumber})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Kategorie</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Vorkommnis">Vorkommnis</option>
                    <option value="Fehlalarm">Fehlalarm</option>
                    <option value="Kontrollgang">Kontrollgang</option>
                    <option value="Schichtübergabe">Schichtübergabe</option>
                    <option value="Polizeieinsatz">Polizeieinsatz</option>
                    <option value="Routinemeldung">Routinemeldung</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Priorität</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Dringend">Dringend</option>
                    <option value="Kritisch">Kritisch (Eskalation)</option>
                    <option value="Niedrig">Niedrig</option>
                  </select>
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={policeInvolved}
                      onChange={(e) => setPoliceInvolved(e.target.checked)}
                      className="rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
                    />
                    <span>Polizei alarmiert (110)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Titel / Kurzbeschreibung *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z. B. Einbruchmelder Auslösung Sektor C"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-slate-400 font-medium">Detaillierter Sachverhalt *</label>
                  {isOnline && (
                    <button
                      type="button"
                      onClick={handleAIAssist}
                      disabled={isAnalyzing}
                      className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 transition disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isAnalyzing ? 'KI formuliert...' : 'KI-Vorschlag erstellen (fachlich prüfen)'}</span>
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Geben Sie hier Stichworte oder den vollständigen Bericht ein..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              {/* Photo & Attachment Upload (Offline Stored in IndexedDB) */}
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-blue-400" />
                    <span>Fotodokumentation & Anhänge (Max 5 MB)</span>
                  </span>
                  <label className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white cursor-pointer font-semibold">
                    <span>Foto auswählen</span>
                    <input type="file" accept="image/*" onChange={handlePhotoCapture} className="hidden" />
                  </label>
                </div>

                {photoPreview && (
                  <div className="relative inline-block mt-2">
                    <img src={photoPreview} alt="Vorschau" className="w-24 h-24 object-cover rounded-lg border border-slate-700" />
                    <button
                      type="button"
                      onClick={() => setPhotoPreview(null)}
                      className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow"
                >
                  {isOnline ? 'Protokolleintrag speichern' : 'Offline vormerken'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
