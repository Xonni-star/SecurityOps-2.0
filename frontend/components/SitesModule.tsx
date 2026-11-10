import React, { useState } from 'react';
import { MapPin, Plus, ShieldCheck, Siren, QrCode, KeyRound, AlertTriangle } from 'lucide-react';
import { store } from '../services/store';
import { SecuritySite } from '../types';

export const SitesModule: React.FC = () => {
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);

  // New site form
  const [name, setName] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [address, setAddress] = useState('');
  const [siteLeader, setSiteLeader] = useState('Markus Hauer (Einsatzleiter)');
  const [riskLevel, setRiskLevel] = useState<SecuritySite['riskLevel']>('Mittel');
  const [alarmSystem, setAlarmSystem] = useState('Telenot BMA / EMA');
  const [checkpointsCount, setCheckpointsCount] = useState(25);
  const [activeGuardsRequired, setActiveGuardsRequired] = useState(2);
  const [specialInstructions, setSpecialInstructions] = useState('');

  const sites = store.sites;

  const handleCreateSite = (e: React.FormEvent) => {
    e.preventDefault();
    const client = store.clients[0];
    store.addSite({
      clientId: client ? client.id : 'cli-1',
      clientName: client ? client.name : 'Allgemeiner Kunde',
      siteCode: siteCode || `OBJ-${Math.floor(100 + Math.random() * 899)}`,
      name,
      address,
      siteLeader,
      riskLevel,
      alarmSystem,
      checkpointsCount: Number(checkpointsCount),
      activeGuardsRequired: Number(activeGuardsRequired),
      specialInstructions,
      keysCount: 24,
      status: 'In Betrieb'
    });
    setShowAddSiteModal(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Sicherheitsobjekte & KRITIS-Verwaltung</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-200 font-mono">
              Objektakten
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Objektstammdaten, Kontrollpunkte, Alarmanlagen und spezifische Sicherungsanforderungen.
          </p>
        </div>

        <button
          onClick={() => setShowAddSiteModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Objekt anlegen</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {sites.map((site) => (
          <div
            key={site.id}
            className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20">
                  {site.siteCode}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    site.riskLevel.includes('KRITIS')
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : site.riskLevel === 'Mittel'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  Gefährdung: {site.riskLevel}
                </span>
              </div>

              <h3 className="font-bold text-white text-sm mb-1">{site.name}</h3>
              <p className="text-xs text-slate-400 mb-3">{site.address}</p>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-2 mb-3">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Auftraggeber:</span>
                  <span className="font-semibold text-right truncate max-w-[180px]">{site.clientName}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Objektleitung:</span>
                  <span className="font-semibold">{site.siteLeader}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Alarmsysteme:</span>
                  <span className="font-semibold truncate max-w-[180px]">{site.alarmSystem}</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/60 text-xs text-slate-300">
                <strong className="text-amber-300 block mb-0.5">Sicherheitsanweisung:</strong>
                <p className="text-[11px] text-slate-300 leading-relaxed">{site.specialInstructions}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-800 text-center text-xs">
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <QrCode className="w-3.5 h-3.5 text-brand-400 mx-auto mb-1" />
                <span className="font-bold text-white block">{site.checkpointsCount}</span>
                <span className="text-[10px] text-slate-400">NFC-Punkte</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <KeyRound className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                <span className="font-bold text-white block">{site.keysCount}</span>
                <span className="text-[10px] text-slate-400">Schlüssel</span>
              </div>
              <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 mx-auto mb-1" />
                <span className="font-bold text-white block">{site.activeGuardsRequired}</span>
                <span className="text-[10px] text-slate-400">Soll-Posten</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAddSiteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSite}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neues Sicherheitsobjekt anlegen</h3>
              <button
                type="button"
                onClick={() => setShowAddSiteModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Objekt-Kürzel</label>
                <input
                  type="text"
                  placeholder="z.B. OBJ-BER-01"
                  value={siteCode}
                  onChange={(e) => setSiteCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Gefährdungsstufe</label>
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value as SecuritySite['riskLevel'])}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Niedrig">Niedrig</option>
                  <option value="Mittel">Mittel</option>
                  <option value="Hoch">Hoch</option>
                  <option value="Kritische Infrastruktur (KRITIS)">KRITIS</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Objektbezeichnung</label>
              <input
                type="text"
                placeholder="z.B. Bundesrechenzentrum Süd"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Objektanschrift</label>
              <input
                type="text"
                placeholder="Straße, PLZ Ort"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Besondere Sicherheitsanweisung</label>
              <textarea
                rows={2}
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                placeholder="Zutrittsregelungen, Sonderposten, Schließzeiten..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddSiteModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
              >
                Objekt speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
