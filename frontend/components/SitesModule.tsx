import React, { useState } from 'react';
import {
  MapPin,
  Plus,
  Shield,
  Radio,
  Building,
  CheckCircle,
  AlertTriangle,
  FileText,
  Users,
  Calendar,
  KeyRound,
  Siren,
  Clock,
  History,
  BookOpen,
  Archive,
  RotateCcw,
  Pencil
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Site } from '../types';

export const SitesModule: React.FC = () => {
  const {
    getTenantSites,
    getTenantClients,
    getTenantEmployees,
    getTenantShifts,
    getTenantGuardBook,
    getTenantKeys,
    getTenantEmergencyPlans,
    addSite, updateSite, archiveSite, restoreSite
  } = useSecurityStore();

  const sites = getTenantSites();
  const clients = getTenantClients();
  const employees = getTenantEmployees();
  const shifts = getTenantShifts();
  const guardBook = getTenantGuardBook();
  const keys = getTenantKeys();
  const emergencyPlans = getTenantEmergencyPlans();

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(sites[0]?.id || null);
  const selectedSite = sites.find(site => site.id === selectedSiteId) || sites[0] || null;
  const [activeSiteTab, setActiveSiteTab] = useState<'overview' | 'contacts' | 'roster' | 'guardbook' | 'keys' | 'alarms' | 'checkpoints'>('overview');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSiteActionPending, setIsSiteActionPending] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // New site form
  const [newSiteCode, setNewSiteCode] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id || '');
  const [securityLevel, setSecurityLevel] = useState<Site['securityLevel']>('Hoch (KRITIS / BSI)');

  const openCreate = () => { setEditingSiteId(null); setNewSiteCode(''); setNewSiteName(''); setNewAddress(''); setSelectedClientId(clients[0]?.id || ''); setSecurityLevel('Hoch (KRITIS / BSI)'); setIsModalOpen(true); };
  const openEdit = (site: Site) => { setEditingSiteId(site.id); setNewSiteCode(site.siteCode); setNewSiteName(site.name); setNewAddress(site.address); setSelectedClientId(site.clientId); setSecurityLevel(site.securityLevel); setIsModalOpen(true); };
  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === selectedClientId);

    const input = {
      clientId: selectedClientId,
      clientName: client?.companyName || 'Mandant',
      siteCode: newSiteCode,
      name: newSiteName,
      address: newAddress,
      securityLevel,
      siteManagerId: employees[0]?.id || 'e-1',
      siteManagerName: `${employees[0]?.firstName || 'Alexander'} ${employees[0]?.lastName || 'Schmidt'}`,
      requiredGuardsDay: 2,
      requiredGuardsNight: 2,
      alarmSystem: 'Siemens Sinteso / Telenot BMA',
      instructionsCount: 2,
      accessRules: 'Ausweispflicht & Taschenkontrolle',
      activeAlarms: 0,
      checkpoints: []
    };
    setIsSiteActionPending(true);
    try { if (editingSiteId) await updateSite(editingSiteId, input); else await addSite(input); }
    finally { setIsSiteActionPending(false); }

    setIsModalOpen(false);
    setNewSiteCode('');
    setNewSiteName('');
    setNewAddress('');
  };
  const runSiteAction = async (action: () => Promise<void>) => {
    setIsSiteActionPending(true);
    try { await action(); } finally { setIsSiteActionPending(false); }
  };

  // Filter object-scoped data
  const siteShifts = selectedSite ? shifts.filter((s) => s.siteId === selectedSite.id) : [];
  const siteLogs = selectedSite ? guardBook.filter((g) => g.siteId === selectedSite.id) : [];
  const siteKeys = selectedSite ? keys.filter((k) => k.siteId === selectedSite.id) : [];
  const siteAlarms = selectedSite ? emergencyPlans.filter((p) => p.siteId === selectedSite.id) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Objektverwaltung & Sicherheitsanalysen</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Zentrale Übersicht aller Schutzobjekte mit integrierten Detailansichten für Kontrollpunkte, Wachbuch und Schlüssel.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Objekt anlegen</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sites List Column */}
        <div className="space-y-3">
          <div className="flex items-center justify-between"><span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{showArchived ? 'Archivierte' : 'Aktive'} Schutzobjekte ({sites.filter(s => Boolean(s.archivedAt) === showArchived).length})</span><button className="text-[10px] text-blue-400" onClick={() => setShowArchived(v=>!v)}>{showArchived ? 'Aktive anzeigen' : 'Archiv anzeigen'}</button></div>

          {sites.filter(site => Boolean(site.archivedAt) === showArchived).map((site) => (
            <div
              key={site.id}
              onClick={() => setSelectedSiteId(site.id)}
              className={`p-4 rounded-xl cursor-pointer transition border ${
                selectedSite?.id === site.id
                  ? 'bg-blue-600/10 border-blue-500/50 shadow-md'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-blue-400 font-bold">
                    {site.siteCode}
                  </span>
                  <h3 className="font-bold text-slate-200 text-sm mt-1">{site.name}</h3>
                  {site.archivedAt && <span className="text-[10px] text-amber-400">Archiviert · {new Date(site.archivedAt).toLocaleDateString('de-DE')}</span>}
                  <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">{site.address}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/80">
                <span className="text-[11px] text-blue-400 font-medium">{site.securityLevel}</span>
                <span>{site.checkpoints.length} Kontrollpunkte</span>
              </div>
            </div>
          ))}
        </div>

        {/* Selected Site Details with Tabs */}
        {selectedSite && (
          <div className="lg:col-span-2 bg-slate-900 rounded-2xl border border-slate-800 p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {selectedSite.siteCode}
                  </span>
                  <h2 className="text-lg font-bold text-white">{selectedSite.name}</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">{selectedSite.address} (Kunde: {selectedSite.clientName})</p>
              </div>

              <div className="flex flex-wrap gap-2 self-start"><span className={`px-3 py-1 rounded-full text-xs font-semibold border ${selectedSite.archivedAt ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'}`}>{selectedSite.archivedAt ? 'Archiviert' : 'Aktiv'} · Revision {selectedSite.revisionVersion || 1}</span><span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                {selectedSite.securityLevel}
              </span></div>
              <div className="flex gap-2">{!selectedSite.archivedAt ? <><button disabled={isSiteActionPending} onClick={() => openEdit(selectedSite)} className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-50"><Pencil className="inline w-3 h-3 mr-1"/>Bearbeiten</button><button disabled={isSiteActionPending} onClick={() => void runSiteAction(() => archiveSite(selectedSite.id))} className="text-xs px-3 py-1.5 rounded-lg bg-amber-900/40 text-amber-200 disabled:opacity-50"><Archive className="inline w-3 h-3 mr-1"/>{isSiteActionPending ? 'Wird archiviert…' : 'Archivieren'}</button></> : <button disabled={isSiteActionPending} onClick={() => void runSiteAction(() => restoreSite(selectedSite.id))} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-900/40 text-emerald-200 disabled:opacity-50"><RotateCcw className="inline w-3 h-3 mr-1"/>{isSiteActionPending ? 'Wird wiederhergestellt…' : 'Wiederherstellen'}</button>}</div>
            </div>

            {/* Object Sub-Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 pb-2 text-xs">
              <button
                onClick={() => setActiveSiteTab('overview')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Übersicht & Specs
              </button>
              <button
                onClick={() => setActiveSiteTab('checkpoints')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'checkpoints' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Kontrollpunkte ({selectedSite.checkpoints.length})
              </button>
              <button
                onClick={() => setActiveSiteTab('guardbook')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'guardbook' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Wachbuch ({siteLogs.length})
              </button>
              <button
                onClick={() => setActiveSiteTab('roster')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'roster' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Schichten ({siteShifts.length})
              </button>
              <button
                onClick={() => setActiveSiteTab('keys')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'keys' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Schlüssel ({siteKeys.length})
              </button>
              <button
                onClick={() => setActiveSiteTab('alarms')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activeSiteTab === 'alarms' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Alarmpläne ({siteAlarms.length})
              </button>
            </div>

            {/* Tab 1: Overview */}
            {activeSiteTab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Objektleiter:</span>
                    <span className="font-semibold text-slate-200 mt-0.5 block">{selectedSite.siteManagerName}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Soll-Kräfte (Tag/Nacht):</span>
                    <span className="font-semibold text-slate-200 mt-0.5 block">{selectedSite.requiredGuardsDay} Tag / {selectedSite.requiredGuardsNight} Nacht</span>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Alarmanlage:</span>
                    <span className="font-semibold text-slate-200 mt-0.5 block">{selectedSite.alarmSystem}</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Zutritts- und Sicherheitsbestimmungen:
                  </h4>
                  <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-200 leading-relaxed">
                    {selectedSite.accessRules}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Checkpoints */}
            {activeSiteTab === 'checkpoints' && (
              <div className="space-y-2">
                {selectedSite.checkpoints.length === 0 && (
                  <p className="rounded-xl border border-slate-800 bg-slate-800/40 p-3 text-xs text-slate-400">
                    Kontrollpunkte werden in der Kontrollgangverwaltung mit nicht erratbaren QR-/NFC-Tokens angelegt.
                  </p>
                )}
                {selectedSite.checkpoints.map((cp) => (
                  <div key={cp.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-200">{cp.name} ({cp.code})</div>
                      <div className="text-[11px] text-slate-400">{cp.locationDetails}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500">Alle {cp.requiredIntervalMinutes} Min. · Verwaltung im Modul Kontrollgänge</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 3: Guardbook logs */}
            {activeSiteTab === 'guardbook' && (
              <div className="space-y-2">
                {siteLogs.length === 0 ? (
                  <div className="text-xs text-slate-500 p-4 text-center">Keine Wachbucheinträge für dieses Objekt.</div>
                ) : (
                  siteLogs.map((log) => (
                    <div key={log.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs">
                      <div className="flex justify-between font-semibold text-slate-200">
                        <span>{log.title}</span>
                        <span className="text-slate-400 text-[10px]">{log.timestamp.slice(0, 10)}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{log.description}</p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 4: Roster */}
            {activeSiteTab === 'roster' && (
              <div className="space-y-2">
                {siteShifts.length === 0 ? (
                  <div className="text-xs text-slate-500 p-4 text-center">Keine Schichten geplant.</div>
                ) : (
                  siteShifts.map((sh) => (
                    <div key={sh.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-200">{sh.type} ({sh.startTime} - {sh.endTime})</div>
                        <div className="text-slate-400 text-[11px]">Eingeteilt: {sh.employeeName || 'Nicht besetzt'}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sh.status === 'Besetzt' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                        {sh.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 5: Keys */}
            {activeSiteTab === 'keys' && (
              <div className="space-y-2">
                {siteKeys.length === 0 ? (
                  <div className="text-xs text-slate-500 p-4 text-center">Keine Schlüssel hinterlegt.</div>
                ) : (
                  siteKeys.map((k) => (
                    <div key={k.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs flex justify-between items-center">
                      <div>
                        <div className="font-semibold text-slate-200">{k.label} ({k.keyNumber})</div>
                        <div className="text-slate-400 text-[11px]">Inhaber: {k.currentHolderName || 'Im Tresor'}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${k.status === 'Im Tresor' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                        {k.status}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab 6: Alarms */}
            {activeSiteTab === 'alarms' && (
              <div className="space-y-2">
                {siteAlarms.length === 0 ? (
                  <div className="text-xs text-slate-500 p-4 text-center">Keine Alarmierungspläne hinterlegt.</div>
                ) : (
                  siteAlarms.map((a) => (
                    <div key={a.id} className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 text-xs">
                      <div className="font-semibold text-slate-200">{a.scenario}</div>
                      <div className="text-slate-400 text-[11px] mt-1">Letzte Übung: {a.lastDrillDate}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: New Site */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">{editingSiteId ? 'Sicherheitsobjekt bearbeiten' : 'Neues Sicherheitsobjekt erfassen'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateSite} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Zugeordneter Mandanten-Kunde *</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  required
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.companyName} ({c.clientNumber})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Objektcode *</label>
                  <input
                    type="text"
                    value={newSiteCode}
                    onChange={(e) => setNewSiteCode(e.target.value)}
                    placeholder="z. B. OBJ-FFM-03"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Sicherheitslevel</label>
                  <select
                    value={securityLevel}
                    onChange={(e) => setSecurityLevel(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Niedrig">Niedrig</option>
                    <option value="Mittel">Mittel</option>
                    <option value="Hoch (KRITIS / BSI)">Hoch (KRITIS / BSI)</option>
                    <option value="Höchste Sicherheitsstufe">Höchste Sicherheitsstufe</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Objektname *</label>
                <input
                  type="text"
                  value={newSiteName}
                  onChange={(e) => setNewSiteName(e.target.value)}
                  placeholder="z. B. Rechenzentrum Alpha"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Standortadresse *</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="Straße, PLZ, Stadt"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSiteActionPending}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  {isSiteActionPending ? 'Wird gespeichert…' : editingSiteId ? 'Änderungen speichern' : 'Objekt anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
