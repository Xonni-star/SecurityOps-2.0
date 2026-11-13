import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldCheck,
  X,
  Play,
  Layers,
  HardDrive,
  Split,
  FileCheck2,
  Trash2
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { offlineVault } from '../services/indexedDbService';

interface SyncManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncManagerModal: React.FC<SyncManagerModalProps> = ({ isOpen, onClose }) => {
  const {
    isOnline,
    toggleNetworkSimulation,
    syncQueue,
    triggerManualSync,
    resolveConflict,
    clearCompletedSyncs,
    getCurrentTenant
  } = useSecurityStore();

  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'outbox' | 'conflicts' | 'storage'>('outbox');
  const [storageStats, setStorageStats] = useState<{ usageBytes: number; quotaBytes: number; percentage: number }>({
    usageBytes: 1250000,
    quotaBytes: 50000000,
    percentage: 2.5
  });

  // Selected conflict for three-way side-by-side diff
  const [selectedConflict, setSelectedConflict] = useState<any | null>(null);
  const [resolutionError, setResolutionError] = useState('');
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  const tenant = getCurrentTenant();

  useEffect(() => {
    if (isOpen) {
      offlineVault.getStorageEstimates().then((stats) => {
        setStorageStats({
          usageBytes: stats.usageBytes || 1250000,
          quotaBytes: stats.quotaBytes || 50000000,
          percentage: stats.percentage || 2.5
        });
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const pendingCount = syncQueue.filter((q) => q.status === 'pending').length;
  const syncedCount = syncQueue.filter((q) => q.status === 'synced').length;
  const conflictItems = syncQueue.filter((q) => q.status === 'conflict');
  const selectedConflictPayload = selectedConflict?.entityType === 'patrol'
    ? Object.fromEntries(Object.entries(selectedConflict.payload || {}).filter(([key]) => !/token/i.test(key)))
    : selectedConflict?.payload;

  const handleRunSync = async () => {
    setIsSyncing(true);
    await new Promise((r) => setTimeout(r, 650));
    await triggerManualSync();
    setIsSyncing(false);
  };

  const handleResolveDecision = async (decision: 'USE_LOCAL' | 'USE_SERVER' | 'RECORD_AS_EXCEPTION') => {
    if (!selectedConflict) return;
    setIsResolvingConflict(true);
    setResolutionError('');
    try {
      await resolveConflict(selectedConflict.id, decision);
      setSelectedConflict(null);
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : 'Konflikt konnte nicht aufgelöst werden.');
    } finally {
      setIsResolvingConflict(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#0b1329] border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-[#0f172a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                Offline-First Synchronisations-Zentrale (Phase 6)
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                }`}>
                  {isOnline ? 'ONLINE' : 'OFFLINE MODUS'}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Gerät: <code className="text-blue-300 font-mono">{offlineVault.getDeviceId()}</code> • Mandant: {tenant.name}
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Controls & Navigation Tabs */}
        <div className="p-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('outbox')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'outbox' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Warteschlange ({pendingCount})
            </button>
            <button
              onClick={() => setActiveTab('conflicts')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1 ${
                activeTab === 'conflicts' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>Konflikte ({conflictItems.length})</span>
              {conflictItems.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('storage')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'storage' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              IndexedDB Speicher
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleNetworkSimulation}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                isOnline
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {isOnline ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
              <span>{isOnline ? 'Trennen' : 'Verbinden'}</span>
            </button>

            <button
              onClick={handleRunSync}
              disabled={!isOnline || isSyncing || pendingCount === 0}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold flex items-center gap-1.5 disabled:opacity-40 transition shadow-sm"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isSyncing ? 'Sync...' : 'Jetzt Synchronisieren'}</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Outbox List */}
        {activeTab === 'outbox' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 text-xs">
            {syncQueue.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-xs">
                Keine ausstehenden Offline-Transaktionen. Alle Daten sind mit PostgreSQL abgeglichen.
              </div>
            ) : (
              syncQueue.map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-start justify-between gap-3 hover:border-slate-700 transition"
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`p-1.5 rounded-lg mt-0.5 ${
                      item.status === 'synced'
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : item.status === 'conflict'
                        ? 'bg-rose-500/10 text-rose-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {item.status === 'synced' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : item.status === 'conflict' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <Clock className="w-4 h-4" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200 capitalize">
                          {item.entityType} ({item.action})
                        </span>
                        <span className={`px-2 py-0.2 rounded text-[9px] font-mono font-bold ${
                          item.status === 'synced'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : item.status === 'conflict'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}>
                          {item.status.toUpperCase()}
                        </span>
                      </div>

                      <p className="text-[11px] text-slate-400 mt-1">
                        {item.payload.title || item.payload.name || JSON.stringify(item.payload).slice(0, 75)}
                      </p>

                      <div className="text-[10px] text-slate-500 font-mono mt-1 flex items-center gap-3">
                        <span>Erfasst: {item.createdAt}</span>
                        <span>•</span>
                        <span>Client UUID: {item.id}</span>
                      </div>
                    </div>
                  </div>

                  {item.status === 'conflict' && (
                    <button
                      onClick={() => {
                        setSelectedConflict(item);
                        setActiveTab('conflicts');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[11px]"
                    >
                      Konflikt lösen
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: Side-by-Side Conflict Resolution Center */}
        {activeTab === 'conflicts' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {selectedConflict ? (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-300 font-bold">
                    <Split className="w-4 h-4" />
                    <span>Side-by-Side Revisionsvergleich für Mutation: {selectedConflict.id}</span>
                  </div>
                  <button onClick={() => setSelectedConflict(null)} className="text-slate-400 hover:text-white">✕</button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Local Version */}
                  <div className="p-4 rounded-xl bg-slate-900 border border-blue-500/40 space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 block">
                      Lokale Offline-Version (Gerät)
                    </span>
                    <div className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-200">
                      <pre>{JSON.stringify(selectedConflictPayload, null, 2)}</pre>
                    </div>
                    <button
                      disabled={isResolvingConflict}
                      onClick={() => void handleResolveDecision(
                        selectedConflict.entityType === 'patrol' ? 'RECORD_AS_EXCEPTION' : 'USE_LOCAL'
                      )}
                      className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                    >
                      {selectedConflict.entityType === 'patrol'
                        ? 'Lokales Ereignis als Abweichung dokumentieren'
                        : 'Lokale Version durchsetzen'}
                    </button>
                  </div>

                  {/* Server Version */}
                  <div className="p-4 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                      Aktueller Server-Stand (PostgreSQL)
                    </span>
                    <div className="p-2.5 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-400">
                      <pre>{JSON.stringify(
                        selectedConflict.conflictDetails?.serverPayload ??
                        selectedConflict.conflictDetails ??
                        { status: 'Kein Server-Snapshot für diesen Konflikt verfügbar' },
                        null,
                        2
                      )}</pre>
                    </div>
                    {selectedConflict.entityType === 'patrol' ? (
                      <button
                        disabled={isResolvingConflict}
                        onClick={() => void handleResolveDecision('USE_SERVER')}
                        className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition disabled:opacity-50"
                      >
                        Lokales Ereignis verwerfen und Serverstand übernehmen
                      </button>
                    ) : (
                      <button
                        disabled={isResolvingConflict}
                        onClick={() => void handleResolveDecision('USE_SERVER')}
                        className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition disabled:opacity-50"
                      >
                        Server-Stand übernehmen
                      </button>
                    )}
                  </div>
                </div>
                {resolutionError && (
                  <p role="alert" className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
                    {resolutionError} Der Eintrag bleibt in der lokalen Outbox erhalten.
                  </p>
                )}
              </div>
            ) : conflictItems.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-xs">
                Aktuell liegen keine Synchronisationskonflikte vor. Alle Revisionsvektoren sind konsistent.
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-300">Zu lösende Konflikte:</span>
                {conflictItems.map((c) => (
                  <div key={c.id} className="p-3 rounded-xl bg-slate-900 border border-rose-500/40 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-200">{c.entityType} ({c.action})</span>
                      <p className="text-[11px] text-slate-400 mt-0.5">{JSON.stringify(c.payload).slice(0, 60)}</p>
                    </div>
                    <button
                      onClick={() => setSelectedConflict(c)}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs"
                    >
                      Konflikt öffnen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Storage & Quota */}
        {activeTab === 'storage' && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <HardDrive className="w-4 h-4 text-blue-400" />
                  <span>IndexedDB Offline-Vault Speicherauslastung</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">{storageStats.percentage.toFixed(2)}% belegt</span>
              </div>

              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full" style={{ width: `${storageStats.percentage}%` }} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                <div>Belegter Speicher: <strong className="text-slate-200">{(storageStats.usageBytes / 1024 / 1024).toFixed(2)} MB</strong></div>
                <div>Verfügbare Quota: <strong className="text-slate-200">{(storageStats.quotaBytes / 1024 / 1024).toFixed(0)} MB</strong></div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-2 text-slate-400">
              <span className="font-bold text-slate-300 block">Sicherheitshinweis zu lokalen Daten:</span>
              <p>
                Lokale IndexedDB-Datensätze sind durch die Same-Origin-Policy des Browsers gegen andere Websites isoliert.
                Bei Abmeldung oder Gerätewiderruf werden alle temporären Token und Offline-Caches bereinigt.
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 bg-[#0a0f1d] flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px]">
            DIN 77200 Konformität: Revisionsgesichertes Logging aller Synchronisationsquittungen
          </span>
          <button
            onClick={clearCompletedSyncs}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Erledigte bereinigen
          </button>
        </div>
      </div>
    </div>
  );
};
