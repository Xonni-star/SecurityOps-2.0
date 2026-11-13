import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, CheckCircle2, Clock3, MapPin, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { useSecurityStore } from '../store';

interface PatrolCheckpoint {
  id: string;
  site_id: string;
  site_name: string;
  code: string;
  name: string;
  location_details: string;
  token_version: number;
  required_interval_minutes: number;
  active: boolean;
}

interface PatrolRoute {
  id: string;
  site_id: string;
  site_name: string;
  route_code: string;
  name: string;
  current_version: number;
  active: boolean;
  checkpoints: Array<{ checkpointId: string; code: string; name: string; sequence: number; plannedOffsetMinutes: number }>;
}

interface PatrolScan {
  id: string;
  site_name: string;
  checkpoint_code: string;
  checkpoint_name: string;
  scanned_at: string;
  method: string;
  verification_status: string;
  notes?: string;
}

interface PatrolException {
  id: string;
  site_name: string;
  category: string;
  severity: string;
  description: string;
  created_at: string;
}

interface PatrolStats {
  scans: { total: number; verified: number; manual: number };
  exceptions: { total: number; urgent: number };
  rounds: { total: number; in_progress: number; completed: number };
}

interface CreatedCheckpoint extends PatrolCheckpoint {
  scanPayload: string;
}

function queryString(siteId: string, from: string, to: string): string {
  const query = new URLSearchParams();
  if (siteId) query.set('siteId', siteId);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
}

export const PatrolModule: React.FC = () => {
  const {
    getTenantSites, currentTenantId, authUser, isOnline, enqueueOfflineAction,
    triggerManualSync, syncQueue
  } = useSecurityStore();
  const sites = getTenantSites();
  const permissions = authUser?.permissions || [];
  const canManage = permissions.includes('patrol:manage');
  const canReportException = permissions.includes('patrol:exception:create');
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stats, setStats] = useState<PatrolStats | null>(null);
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [scans, setScans] = useState<PatrolScan[]>([]);
  const [exceptions, setExceptions] = useState<PatrolException[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [createdCheckpoint, setCreatedCheckpoint] = useState<CreatedCheckpoint | null>(null);
  const [checkpointQr, setCheckpointQr] = useState('');
  const [checkpointCode, setCheckpointCode] = useState('');
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointLocation, setCheckpointLocation] = useState('');
  const [checkpointInterval, setCheckpointInterval] = useState(60);
  const [routeCode, setRouteCode] = useState('');
  const [routeName, setRouteName] = useState('');
  const [routeChangeReason, setRouteChangeReason] = useState('');
  const [selectedCheckpointIds, setSelectedCheckpointIds] = useState<string[]>([]);
  const [versionRouteId, setVersionRouteId] = useState('');
  const [exceptionCategory, setExceptionCategory] = useState('other');
  const [exceptionSeverity, setExceptionSeverity] = useState('normal');
  const [exceptionDescription, setExceptionDescription] = useState('');

  const filters = useMemo(() => queryString(siteId, from, to), [siteId, from, to]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardData, checkpointData, routeData, scanData, exceptionData] = await Promise.all([
        apiClient.get<PatrolStats>(`/patrol/dashboard${filters}`),
        apiClient.get<PatrolCheckpoint[]>(`/patrol/checkpoints${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
        apiClient.get<PatrolRoute[]>(`/patrol/routes${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
        apiClient.get<PatrolScan[]>(`/patrol/scans${filters}`),
        apiClient.get<PatrolException[]>(`/patrol/exceptions${filters}`)
      ]);
      setStats(dashboardData);
      setCheckpoints(checkpointData);
      setRoutes(routeData);
      setScans(scanData);
      setExceptions(exceptionData);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgangsdaten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [filters, siteId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!createdCheckpoint?.scanPayload) {
      setCheckpointQr('');
      return;
    }
    let active = true;
    void QRCode.toDataURL(createdCheckpoint.scanPayload, { errorCorrectionLevel: 'M', margin: 2, width: 240 })
      .then(url => { if (active) setCheckpointQr(url); })
      .catch(() => { if (active) setErrorMessage('QR-Code konnte lokal nicht erstellt werden. Der einmalige Token bleibt sichtbar.'); });
    return () => { active = false; };
  }, [createdCheckpoint]);

  const createCheckpoint = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!siteId) {
      setErrorMessage('Wählen Sie zuerst ein Objekt.');
      return;
    }
    setSaving(true);
    try {
      const created = await apiClient.post<CreatedCheckpoint>('/patrol/checkpoints', {
        siteId,
        code: checkpointCode,
        name: checkpointName,
        locationDetails: checkpointLocation,
        requiredIntervalMinutes: checkpointInterval
      });
      setCreatedCheckpoint(created);
      setNotice('Kontrollpunkt angelegt. Der neue QR-/NFC-Token ist nur jetzt sichtbar; sicher verwahren und am Kontrollpunkt hinterlegen.');
      setCheckpointCode('');
      setCheckpointName('');
      setCheckpointLocation('');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunkt konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async (checkpointId: string) => {
    setSaving(true);
    try {
      const rotated = await apiClient.post<CreatedCheckpoint>(`/patrol/checkpoints/${checkpointId}/rotate-token`, {});
      setCreatedCheckpoint(rotated);
      setNotice('Token rotiert. Der bisherige Token ist ungültig; der neue Token wird nur einmal angezeigt.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Token konnte nicht rotiert werden.');
    } finally {
      setSaving(false);
    }
  };

  const archiveCheckpoint = async (checkpointId: string) => {
    setSaving(true);
    try {
      await apiClient.post(`/patrol/checkpoints/${checkpointId}/archive`, {});
      setNotice('Kontrollpunkt archiviert; Historie und frühere Routenversionen bleiben erhalten.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunkt konnte nicht archiviert werden.');
    } finally {
      setSaving(false);
    }
  };

  const selectedForRoute = checkpoints.filter(point => point.site_id === siteId && selectedCheckpointIds.includes(point.id));
  const makeRoutePayload = () => ({
    name: routeName,
    changeReason: routeChangeReason,
    checkpoints: selectedForRoute.map((point, index) => ({ checkpointId: point.id, plannedOffsetMinutes: index * point.required_interval_minutes }))
  });

  const createRoute = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!siteId || !selectedForRoute.length) {
      setErrorMessage('Wählen Sie ein Objekt und mindestens einen aktiven Kontrollpunkt für die Route.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/patrol/routes', { siteId, code: routeCode, ...makeRoutePayload() });
      setRouteCode('');
      setRouteName('');
      setRouteChangeReason('');
      setSelectedCheckpointIds([]);
      setNotice('Route mit unveränderlicher Version 1 angelegt.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Route konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

  const createRouteVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!versionRouteId || !selectedForRoute.length) {
      setErrorMessage('Wählen Sie eine Route und mindestens einen aktiven Kontrollpunkt.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post(`/patrol/routes/${versionRouteId}/versions`, makeRoutePayload());
      setVersionRouteId('');
      setNotice('Neue Routenversion veröffentlicht. Frühere Versionen bleiben unverändert.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Neue Routenversion konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

  const createException = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!siteId || !exceptionDescription.trim()) {
      setErrorMessage('Wählen Sie ein Objekt und beschreiben Sie die Abweichung.');
      return;
    }
    const payload = {
      recordType: 'exception',
      siteId,
      category: exceptionCategory,
      severity: exceptionSeverity,
      description: exceptionDescription.trim(),
      capturedAt: new Date().toISOString()
    };
    setSaving(true);
    try {
      await enqueueOfflineAction({
        tenantId: currentTenantId,
        entityType: 'patrol',
        action: 'CREATE',
        payload,
        baseVersion: 1
      });
      setExceptionDescription('');
      if (isOnline) {
        const result = await triggerManualSync();
        if (result.failed || result.conflicts) {
          setNotice('Abweichung ist dauerhaft lokal gespeichert; Serversynchronisierung benötigt Prüfung.');
        } else {
          setNotice('Abweichung wurde synchronisiert.');
        }
        await refresh();
      } else {
        setNotice('Abweichung dauerhaft lokal gespeichert und wartet auf Verbindung.');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Abweichung konnte nicht sicher gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const pendingCount = syncQueue.filter(item => item.entityType === 'patrol' && item.status !== 'synced').length;
  const currentSites = sites.filter(site => !site.archivedAt);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-blue-400" /><h1 className="text-xl font-bold text-white">Kontrollgangverwaltung</h1></div>
          <p className="mt-1 text-xs text-slate-400">Kontrollpunkte, unveränderliche Routenversionen, Scan-Nachweise und Abweichungen.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-slate-200 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Aktualisieren
        </button>
      </header>

      {!isOnline && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">Offline-Modus: Erfassung wird in der IndexedDB-Outbox gesichert. Serverseitige Tokenprüfung und Abweichungsübersicht sind bis zur Synchronisierung nicht verfügbar.</div>}
      {pendingCount > 0 && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-blue-200">{pendingCount} Patrol-Mutation(en) warten auf Serversynchronisierung oder Konfliktprüfung.</div>}
      {errorMessage && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200">{errorMessage}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200">{notice}</div>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Objekt
          <select value={siteId} onChange={event => setSiteId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Objekte</option>{currentSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Von
          <input type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Bis
          <input type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
        <MetricCard label="Scans" value={stats?.scans.total} detail={`${stats?.scans.verified ?? 0} Token-verifiziert · ${stats?.scans.manual ?? 0} manuell`} icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} />
        <MetricCard label="Rundgänge / Abweichungen" value={stats ? `${stats.rounds.completed}/${stats.rounds.total} · ${stats.exceptions.total}` : undefined} detail={`${stats?.exceptions.urgent ?? 0} dringlich/kritisch`} icon={<AlertTriangle className="h-4 w-4 text-amber-400" />} />
      </section>

      {canManage && (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <form onSubmit={createCheckpoint} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-bold text-white">Kontrollpunkt anlegen</h2>
            <p className="text-[11px] text-slate-400">Ein zufälliger 256-Bit-Token wird erzeugt; gespeichert wird nur sein SHA-256-Hash. Der Token ist nur nach Anlegen oder Rotation sichtbar.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input required maxLength={50} value={checkpointCode} onChange={event => setCheckpointCode(event.target.value)} placeholder="Code (z. B. CP-01)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input required maxLength={150} value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="Name" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input maxLength={2000} value={checkpointLocation} onChange={event => setCheckpointLocation(event.target.value)} placeholder="Standortdetails" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <label className="text-slate-300">Prüfintervall (Min.)
                <input type="number" min={1} max={1440} value={checkpointInterval} onChange={event => setCheckpointInterval(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
            </div>
            <button disabled={saving || !siteId} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Kontrollpunkt speichern</button>
            {createdCheckpoint && (
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-slate-950 p-3 sm:flex-row sm:items-center">
                {checkpointQr && <img src={checkpointQr} alt={`QR-Code für ${createdCheckpoint.code}`} className="h-32 w-32 bg-white p-2" />}
                <div className="min-w-0">
                  <p className="font-semibold text-emerald-200">{createdCheckpoint.code} · Token v{createdCheckpoint.token_version}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-slate-300">{createdCheckpoint.scanPayload}</p>
                  <p className="mt-2 text-[10px] text-amber-200">Einmaliger Token: sicher und nur am berechtigten Kontrollpunkt hinterlegen.</p>
                </div>
              </div>
            )}
          </form>

          <form onSubmit={createRoute} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-bold text-white">Versionierte Route anlegen</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input required maxLength={50} value={routeCode} onChange={event => setRouteCode(event.target.value)} placeholder="Routencode" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input required maxLength={150} value={routeName} onChange={event => setRouteName(event.target.value)} placeholder="Routenname" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input required maxLength={500} value={routeChangeReason} onChange={event => setRouteChangeReason(event.target.value)} placeholder="Änderungsgrund" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white sm:col-span-2" />
            </div>
            <CheckpointPicker checkpoints={checkpoints.filter(point => point.site_id === siteId && point.active)} selected={selectedCheckpointIds} onChange={setSelectedCheckpointIds} />
            <button disabled={saving || !siteId} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Route v1 anlegen</button>
          </form>

          <form onSubmit={createRouteVersion} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 xl:col-span-2">
            <h2 className="font-bold text-white">Neue Routenversion</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select required value={versionRouteId} onChange={event => setVersionRouteId(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
                <option value="">Route auswählen</option>{routes.filter(route => route.site_id === siteId && route.active).map(route => <option key={route.id} value={route.id}>{route.route_code} · v{route.current_version} · {route.name}</option>)}
              </select>
              <input required maxLength={150} value={routeName} onChange={event => setRouteName(event.target.value)} placeholder="Name der neuen Version" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input required maxLength={500} value={routeChangeReason} onChange={event => setRouteChangeReason(event.target.value)} placeholder="Änderungsgrund" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white sm:col-span-2" />
            </div>
            <CheckpointPicker checkpoints={checkpoints.filter(point => point.site_id === siteId && point.active)} selected={selectedCheckpointIds} onChange={setSelectedCheckpointIds} />
            <button disabled={saving || !versionRouteId} className="rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Unveränderliche Version veröffentlichen</button>
          </form>
        </section>
      )}

      {canReportException && (
        <form onSubmit={createException} className="grid grid-cols-1 gap-3 rounded-2xl border border-amber-500/20 bg-slate-900 p-4 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end">
          <div className="font-bold text-white lg:col-span-4">Abweichung erfassen</div>
          <label className="text-slate-300">Kategorie
            <select value={exceptionCategory} onChange={event => setExceptionCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
              <option value="other">Sonstige</option><option value="missed_checkpoint">Kontrollpunkt ausgelassen</option><option value="late_checkpoint">Verspätet</option><option value="access_blocked">Zugang blockiert</option><option value="hazard">Gefahr</option><option value="damage">Schaden</option>
            </select>
          </label>
          <label className="text-slate-300">Priorität
            <select value={exceptionSeverity} onChange={event => setExceptionSeverity(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
              <option value="low">Niedrig</option><option value="normal">Normal</option><option value="high">Hoch</option><option value="critical">Kritisch</option>
            </select>
          </label>
          <textarea required maxLength={5000} value={exceptionDescription} onChange={event => setExceptionDescription(event.target.value)} placeholder="Sachliche Beschreibung" className="min-h-12 rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
          <button disabled={saving || !siteId} className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Lokal sichern / synchronisieren</button>
        </form>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DataPanel title="Aktuelle Routen" loading={loading} empty={!routes.length}>
          <div className="space-y-2">{routes.map(route => (
            <article key={route.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-center justify-between gap-2"><strong className="text-slate-100">{route.route_code} · {route.name}</strong><span className="rounded bg-indigo-500/15 px-2 py-1 text-indigo-200">v{route.current_version}</span></div>
              <p className="mt-1 text-[11px] text-slate-400">{route.site_name} · {route.checkpoints.map(point => point.code).join(' → ')}</p>
            </article>
          ))}</div>
        </DataPanel>

        <DataPanel title="Kontrollpunkte" loading={loading} empty={!checkpoints.length}>
          <div className="space-y-2">{checkpoints.map(point => (
            <article key={point.id} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><strong className="text-slate-100">{point.code} · {point.name}</strong><p className="mt-1 text-[11px] text-slate-400">{point.site_name} · Token v{point.token_version} · Intervall {point.required_interval_minutes} Min.</p></div>
              {canManage && point.active && <div className="flex gap-2"><button disabled={saving} onClick={() => void rotateToken(point.id)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-blue-200">Token rotieren</button><button disabled={saving} onClick={() => void archiveCheckpoint(point.id)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-amber-200">Archivieren</button></div>}
            </article>
          ))}</div>
        </DataPanel>

        <DataPanel title="Letzte Scans" loading={loading} empty={!scans.length}>
          <div className="max-h-96 space-y-2 overflow-auto">{scans.map(scan => (
            <article key={scan.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-100">{scan.checkpoint_code} · {scan.checkpoint_name}</strong><span className={scan.verification_status === 'verified' ? 'text-emerald-300' : 'text-amber-300'}>{scan.verification_status === 'verified' ? 'Token verifiziert' : 'Manuell / ungeprüft'}</span></div>
              <p className="mt-1 text-[11px] text-slate-400">{scan.site_name} · {formatTime(scan.scanned_at)} · {scan.method}{scan.notes ? ` · ${scan.notes}` : ''}</p>
            </article>
          ))}</div>
        </DataPanel>

        <DataPanel title="Abweichungen" loading={loading} empty={!exceptions.length}>
          <div className="max-h-96 space-y-2 overflow-auto">{exceptions.map(exception => (
            <article key={exception.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-100">{exception.category.replaceAll('_', ' ')}</strong><span className={exception.severity === 'critical' || exception.severity === 'high' ? 'text-rose-300' : 'text-amber-300'}>{exception.severity}</span></div>
              <p className="mt-1 text-[11px] text-slate-300">{exception.description}</p><p className="mt-1 text-[10px] text-slate-500">{exception.site_name} · {formatTime(exception.created_at)}</p>
            </article>
          ))}</div>
        </DataPanel>
      </section>
      <p className="flex items-start gap-2 text-[11px] text-slate-500"><Clock3 className="h-4 w-4 shrink-0" />Serverquittungen, Tokenprüfung und Audit-Ereignisse sind nach der Synchronisierung maßgeblich; ein lokal gespeicherter Eintrag ist kein Servernachweis.</p>
    </div>
  );
};

function MetricCard({ label, value, detail, icon }: { label: string; value?: number | string; detail: string; icon: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="flex items-center justify-between text-[11px] text-slate-400">{label}{icon}</div><div className="mt-2 text-xl font-bold text-white">{value ?? '—'}</div><p className="mt-1 text-[10px] text-slate-500">{detail}</p></div>;
}

function CheckpointPicker({
  checkpoints, selected, onChange
}: {
  checkpoints: PatrolCheckpoint[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-[11px] font-semibold text-slate-300">Route-Reihenfolge (Reihenfolge der Auswahl)</legend>
      <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
        {checkpoints.map(checkpoint => {
          const checked = selected.includes(checkpoint.id);
          return (
            <label key={checkpoint.id} className="flex items-center gap-2 rounded px-2 py-1 text-slate-300 hover:bg-slate-800">
              <input type="checkbox" checked={checked} onChange={() => onChange(checked
                ? selected.filter(id => id !== checkpoint.id)
                : [...selected, checkpoint.id])} />
              <span>{checkpoint.code} · {checkpoint.name}</span>
              {checked && <span className="ml-auto text-[10px] text-blue-300">#{selected.indexOf(checkpoint.id) + 1}</span>}
            </label>
          );
        })}
        {!checkpoints.length && <span className="text-[11px] text-slate-500">Keine aktiven Kontrollpunkte für das ausgewählte Objekt.</span>}
      </div>
    </fieldset>
  );
}

function DataPanel({
  title, loading, empty, children
}: {
  title: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-3 font-bold text-white">{title}</h2>
      {loading ? <p className="text-slate-400">Laden …</p> : empty ? <p className="text-slate-500">Keine Einträge für die gewählten Filter.</p> : children}
    </section>
  );
}
