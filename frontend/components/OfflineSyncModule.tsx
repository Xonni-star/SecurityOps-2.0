import React from 'react';
import {
  RotateCw,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  ArrowRightLeft,
  Server
} from 'lucide-react';
import { store } from '../services/store';

export const OfflineSyncModule: React.FC = () => {
  const isOffline = store.isOfflineMode;
  const isSyncing = store.isSyncing;
  const syncQueue = store.getTenantSyncQueue();
  const pendingCount = syncQueue.filter((q) => q.status === 'pending').length;
  const syncedCount = syncQueue.filter((q) => q.status === 'synced').length;
  const activeTenant = store.getActiveTenant();

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <RotateCw className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Offline-First Synchronisationszentrale</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-semibold ${
                isOffline ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {isOffline ? 'Offline-Simulation aktiv' : 'Verbunden mit PostgreSQL Server'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Resilienz in Tiefgaragen, Rechenzentren und Funkschatten. Lokale Speicherung & automatische Nachsynchronisation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => store.toggleOfflineSimulation()}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              isOffline
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-rose-950/80 border-rose-600 hover:bg-rose-900 text-rose-200'
            }`}
          >
            {isOffline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            <span>{isOffline ? 'Online-Modus wiederherstellen' : 'Netzwerkausfall simulieren'}</span>
          </button>

          <button
            onClick={() => store.processSyncQueue()}
            disabled={isSyncing || isOffline || pendingCount === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold disabled:opacity-50"
          >
            <RotateCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Jetzt abgleichen</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Ausstehende Offline-Transaktionen</span>
          <span className="text-2xl font-bold text-amber-400">{pendingCount}</span>
          <p className="text-[11px] text-slate-400 mt-1">Lokal verschlüsselt in IndexedDB</p>
        </div>
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Erfolgreich synchronisiert</span>
          <span className="text-2xl font-bold text-emerald-400">{syncedCount}</span>
          <p className="text-[11px] text-slate-400 mt-1">Geprüft mit SHA-256 Audit-Hash</p>
        </div>
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400 block mb-1">Konfliktmanagement-Strategie</span>
          <span className="text-sm font-bold text-white block mt-1">Vektor-Clock & Optimistic Lock</span>
          <p className="text-[11px] text-brand-300 mt-1">Server/Client Versionierungsabgleich</p>
        </div>
      </div>

      {/* Sync Queue Table */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">Lokale Transaktionswarteschlange ({activeTenant.code})</h3>
          <span className="text-xs text-slate-400">Idempotente API-Endpunkte mit Request-IDs</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Zeitstempel & ID</th>
                <th className="p-3.5">Entität</th>
                <th className="p-3.5">Aktion</th>
                <th className="p-3.5">Transaktionsinhalt</th>
                <th className="p-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300 font-mono">
              {syncQueue.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500 font-sans">
                    Keine Einträge in der Synchronisationswarteschlange.
                  </td>
                </tr>
              ) : (
                syncQueue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-3.5">
                      <div className="text-slate-200 font-bold">{item.createdAt}</div>
                      <div className="text-[10px] text-slate-500">{item.id}</div>
                    </td>
                    <td className="p-3.5 uppercase text-slate-300 font-semibold">
                      {item.entityType}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                          item.action === 'CREATE'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.action === 'UPDATE'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {item.action}
                      </span>
                    </td>
                    <td className="p-3.5 font-sans text-slate-200">
                      {item.payloadSummary}
                    </td>
                    <td className="p-3.5 text-right font-sans">
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-bold ${
                          item.status === 'synced'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : item.status === 'pending'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800 animate-pulse'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {item.status === 'synced' && <CheckCircle2 className="w-3 h-3" />}
                        {item.status === 'pending' && <Clock className="w-3 h-3" />}
                        {item.status === 'synced' ? 'Synchronisiert' : 'Lokal gepuffert'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
