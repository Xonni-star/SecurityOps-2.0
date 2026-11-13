import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, LoaderCircle, MapPin, QrCode, Radio, ShieldCheck, VideoOff
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Checkpoint, PatrolScanEvent, Site } from '../types';
import { apiClient } from '../services/apiClient';
import { offlineVault } from '../services/indexedDbService';

const PATROL_SCAN_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

interface PatrolCheckpoint extends Checkpoint {
  siteId: string;
  siteName: string;
  tokenVersion: number;
  active: boolean;
}

interface PatrolQrPayload {
  siteId: string;
  checkpointId: string;
  token: string;
}

interface PatrolRoute {
  id: string;
  name: string;
  currentVersion: number;
}

interface PatrolRound {
  id: string;
  site_id?: string;
  route_id?: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorConstructor {
  new(options: { formats: string[] }): BarcodeDetectorInstance;
}

interface NdefReaderLike {
  onreading: ((event: { message: { records: Array<{ recordType: string; data: DataView; encoding?: string }> } }) => void) | null;
  onreadingerror: (() => void) | null;
  scan(options: { signal: AbortSignal }): Promise<void>;
}

export function parsePatrolQrPayload(value: string): PatrolQrPayload | null {
  const match = /^secops:patrol:v1:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{43})$/i.exec(value.trim());
  if (!match) return null;
  return { siteId: match[1], checkpointId: match[2], token: match[3] };
}

export function isPatrolCheckpointRecentlyScanned(
  scans: Pick<PatrolScanEvent, 'checkpointId' | 'scannedAt'>[],
  checkpointId: string,
  now = Date.now()
): boolean {
  return scans.some(scan => {
    if (scan.checkpointId !== checkpointId) return false;
    const elapsedMs = now - new Date(scan.scannedAt).getTime();
    return elapsedMs >= 0 && elapsedMs < PATROL_SCAN_DUPLICATE_WINDOW_MS;
  });
}

function mapCheckpoint(row: Record<string, unknown>): PatrolCheckpoint {
  return {
    id: String(row.id),
    siteId: String(row.site_id ?? row.siteId),
    siteName: String(row.site_name ?? row.siteName ?? ''),
    code: String(row.code),
    name: String(row.name),
    locationDetails: String(row.location_details ?? row.locationDetails ?? ''),
    rfidTag: '',
    tokenVersion: Number(row.token_version ?? row.tokenVersion ?? 1),
    requiredIntervalMinutes: Number(row.required_interval_minutes ?? row.requiredIntervalMinutes ?? 60),
    active: row.active !== false
  };
}

export const MobilePatrolScanner: React.FC = () => {
  const {
    getTenantSites, getTenantPatrolScans, addPatrolScan,
    currentUserId, currentUserName, currentTenantId, authUser, isOnline
  } = useSecurityStore();
  const sites = getTenantSites();
  const scans = getTenantPatrolScans();
  const userId = authUser?.id || currentUserId;
  const [siteId, setSiteId] = useState(sites[0]?.id || '');
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [activeRound, setActiveRound] = useState<PatrolRound | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'QR_CODE' | 'NFC_TAG' | 'MANUELL'>('MANUELL');
  const [scanSuccessMessage, setScanSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [nfcActive, setNfcActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const nfcAbort = useRef<AbortController | null>(null);
  const onQrValue = useRef<(value: string) => void>(() => {});

  const activeSite = sites.find(site => site.id === siteId);
  const checkpointRows = checkpoints.filter(point => point.siteId === siteId && point.active);

  useEffect(() => {
    if (!siteId && sites.length) setSiteId(sites[0].id);
  }, [siteId, sites]);

  useEffect(() => {
    let active = true;
    setActiveRound(null);
    setRoutes([]);
    setLoadingCheckpoints(true);
    const loadCheckpoints = async () => {
      try {
        const fresh = await apiClient.get<Record<string, unknown>[]>(`/patrol/checkpoints?siteId=${encodeURIComponent(siteId)}`);
        const freshRoutes = await apiClient.get<Record<string, unknown>[]>(`/patrol/routes?siteId=${encodeURIComponent(siteId)}`);
        const freshRounds = await apiClient.get<PatrolRound[]>(
          `/patrol/rounds?siteId=${encodeURIComponent(siteId)}&status=in_progress&limit=1`
        );
        const mapped = fresh.map(mapCheckpoint);
        if (!active) return;
        setCheckpoints(previous => [...previous.filter(point => point.siteId !== siteId), ...mapped]);
        const mappedRoutes = freshRoutes.map(row => ({
          id: String(row.id),
          name: String(row.name),
          currentVersion: Number(row.current_version ?? row.currentVersion ?? 1)
        }));
        setRoutes(mappedRoutes);
        setSelectedRouteId(previous => mappedRoutes.some(route => route.id === previous) ? previous : '');
        setActiveRound(freshRounds[0] || null);
        await offlineVault.savePatrolCheckpointCache(currentTenantId, userId, [
          ...checkpoints.filter(point => point.siteId !== siteId),
          ...mapped
        ] as unknown as Array<Record<string, unknown>>);
        setErrorMessage(null);
      } catch (error) {
        try {
          const cached = await offlineVault.getPatrolCheckpointCache(currentTenantId, userId);
          if (!active) return;
          if (cached) {
            const mapped = cached.checkpoints.map(mapCheckpoint);
            setCheckpoints(mapped);
            if (mapped.some(point => point.siteId === siteId)) {
              setErrorMessage('Backend offline: gespeicherte Kontrollpunktdaten werden verwendet. Verifikation erfolgt beim Synchronisieren.');
              return;
            }
          }
        } catch (cacheError) {
          if (active) setErrorMessage(cacheError instanceof Error ? cacheError.message : 'Kontrollpunktcache konnte nicht gelesen werden.');
          return;
        }
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunkte konnten nicht geladen werden.');
      } finally {
        if (active) setLoadingCheckpoints(false);
      }
    };
    if (siteId) void loadCheckpoints();
    else setLoadingCheckpoints(false);
    return () => { active = false; };
  }, [siteId, currentTenantId, userId]);

  const stopCamera = () => {
    cameraStream.current?.getTracks().forEach(track => track.stop());
    cameraStream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const stopNfc = () => {
    nfcAbort.current?.abort();
    nfcAbort.current = null;
    setNfcActive(false);
  };

  useEffect(() => {
    if (!cameraActive) return;
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector || !videoRef.current) {
      setErrorMessage('QR-Decodierung wird in diesem Browser nicht unterstützt. Verwenden Sie NFC oder die manuelle Fallback-Erfassung.');
      stopCamera();
      return;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const detect = async () => {
      const video = videoRef.current;
      if (!cancelled && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            onQrValue.current(codes[0].rawValue);
            return;
          }
        } catch {
          if (!cancelled) setErrorMessage('QR-Code konnte nicht gelesen werden. Sie können NFC oder die manuelle Fallback-Erfassung nutzen.');
        }
      }
      if (!cancelled) timer = setTimeout(() => { void detect(); }, 350);
    };
    void detect();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cameraActive]);

  useEffect(() => () => {
    cameraStream.current?.getTracks().forEach(track => track.stop());
    nfcAbort.current?.abort();
  }, []);

  const handleExecuteScan = async (
    checkpoint: PatrolCheckpoint,
    site: Site | undefined,
    method: 'QR_CODE' | 'NFC_TAG' | 'MANUELL',
    token?: string
  ) => {
    if (isPatrolCheckpointRecentlyScanned(scans, checkpoint.id)) {
      setErrorMessage(`Kontrollpunkt ${checkpoint.code} wurde vor weniger als zwei Minuten bereits erfasst.`);
      return;
    }
    try {
      await addPatrolScan({
        siteId: checkpoint.siteId,
        siteName: site?.name || checkpoint.siteName || `Objekt ${checkpoint.siteId}`,
        checkpointId: checkpoint.id,
        checkpointCode: checkpoint.code,
        checkpointName: checkpoint.name,
        guardId: currentUserId,
        guardName: currentUserName,
        roundId: activeRound?.id,
        method,
        verifiedTag: method === 'MANUELL' ? 'manual' : undefined,
        checkpointToken: token,
        checkpointTokenVersion: checkpoint.tokenVersion,
        notes: notes.trim() || undefined
      });
      setScanSuccessMessage(
        `Kontrollpunkt ${checkpoint.code} lokal gespeichert${isOnline ? ' – Serverprüfung ausstehend' : ' – offline, Synchronisierung ausstehend'}.`
      );
      setErrorMessage(null);
      setNotes('');
      stopCamera();
      stopNfc();
      window.setTimeout(() => setScanSuccessMessage(null), 4500);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunkt konnte nicht lokal gespeichert werden.');
    }
  };

  const handleQrValue = async (value: string, method: 'QR_CODE' | 'NFC_TAG') => {
    const payload = parsePatrolQrPayload(value);
    if (!payload) {
      setErrorMessage('Der Code ist kein gültiger SecurityOps-Kontrollpunkt-Token.');
      return;
    }
    const checkpoint = checkpoints.find(point => point.id === payload.checkpointId && point.siteId === payload.siteId) || {
      id: payload.checkpointId,
      siteId: payload.siteId,
      siteName: '',
      code: 'Unbekannter Punkt',
      name: 'Kontrollpunkt aus QR-/NFC-Token',
      locationDetails: '',
      rfidTag: '',
      tokenVersion: 1,
      requiredIntervalMinutes: 60,
      active: true
    };
    await handleExecuteScan(checkpoint, sites.find(site => site.id === payload.siteId), method, payload.token);
  };
  onQrValue.current = value => { void handleQrValue(value, 'QR_CODE'); };

  const startCamera = async () => {
    stopNfc();
    setSelectedMethod('QR_CODE');
    setErrorMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Kamerazugriff ist in diesem Browser nicht verfügbar. Verwenden Sie NFC oder die manuelle Fallback-Erfassung.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      cameraStream.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setErrorMessage('Kamerazugriff verweigert oder nicht verfügbar. Verwenden Sie NFC oder die manuelle Fallback-Erfassung.');
    }
  };

  const startNfc = async () => {
    stopCamera();
    setSelectedMethod('NFC_TAG');
    setErrorMessage(null);
    const Reader = (window as unknown as { NDEFReader?: new() => NdefReaderLike }).NDEFReader;
    if (!window.isSecureContext || !Reader) {
      setErrorMessage('Web NFC ist auf diesem Gerät nicht verfügbar. Verwenden Sie QR oder die manuelle Fallback-Erfassung.');
      return;
    }
    const controller = new AbortController();
    const reader = new Reader();
    nfcAbort.current = controller;
    reader.onreading = event => {
      const textRecord = event.message.records.find(record => record.recordType === 'text');
      if (!textRecord) {
        setErrorMessage('Der NFC-Tag enthält keinen lesbaren Kontrollpunkt-Token.');
        return;
      }
      const value = new TextDecoder(textRecord.encoding || 'utf-8').decode(textRecord.data);
      void handleQrValue(value, 'NFC_TAG');
    };
    reader.onreadingerror = () => setErrorMessage('NFC-Tag konnte nicht gelesen werden. Versuchen Sie es erneut oder nutzen Sie QR.');
    try {
      await reader.scan({ signal: controller.signal });
      setNfcActive(true);
    } catch {
      if (!controller.signal.aborted) {
        setErrorMessage('NFC-Lesen wurde verweigert oder ist nicht verfügbar. Verwenden Sie QR oder die manuelle Fallback-Erfassung.');
      }
      stopNfc();
    }
  };

  const startRound = async () => {
    if (!isOnline || !siteId) return;
    try {
      const round = await apiClient.post<PatrolRound>('/patrol/rounds', {
        siteId,
        routeId: selectedRouteId || undefined,
        startedAt: new Date().toISOString(),
        clientMutationId: crypto.randomUUID()
      });
      setActiveRound(round);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgang konnte nicht gestartet werden.');
    }
  };

  const completeRound = async () => {
    if (!activeRound || !isOnline) return;
    try {
      await apiClient.post(`/patrol/rounds/${activeRound.id}/complete`, {});
      setActiveRound(null);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgang konnte nicht abgeschlossen werden.');
    }
  };

  return (
    <div className="space-y-4 pb-20 text-xs">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-[10px] text-blue-400 font-mono font-bold block">KONTROLLGANG · OFFLINE-FIRST</span>
          <h2 className="text-sm font-bold text-white">{activeSite?.name || 'Objekt auswählen'}</h2>
          <span className="text-slate-400 text-[11px]">{checkpointRows.length} aktive Kontrollpunkte · {isOnline ? 'Online' : 'Offline'}</span>
        </div>
        <label className="flex items-center gap-2 text-slate-300">
          <MapPin className="h-4 w-4 text-blue-400" />
          <span className="sr-only">Objekt</span>
          <select value={siteId} onChange={event => setSiteId(event.target.value)} className="max-w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      </div>

      {scanSuccessMessage && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{scanSuccessMessage}
        </div>
      )}
      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button onClick={() => void startCamera()} className="flex items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-600/15 p-3 font-semibold text-blue-200">
          <Camera className="h-4 w-4" /> QR mit Kamera scannen
        </button>
        <button onClick={() => void startNfc()} className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600/10 p-3 font-semibold text-emerald-200">
          <Radio className="h-4 w-4" /> NFC-Tag lesen
        </button>
        <button onClick={() => { stopCamera(); stopNfc(); setSelectedMethod('MANUELL'); }} className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-600/10 p-3 font-semibold text-amber-200">
          <ShieldCheck className="h-4 w-4" /> Manuelle Fallback-Erfassung
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor="patrol-route" className="mb-2 block font-semibold text-slate-200">Route für den Kontrollgang</label>
          <select id="patrol-route" value={selectedRouteId} onChange={event => setSelectedRouteId(event.target.value)}
            disabled={Boolean(activeRound) || routes.length === 0}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-60">
            <option value="">Ohne festgelegte Route</option>
            {routes.map(route => <option key={route.id} value={route.id}>{route.name} · Version {route.currentVersion}</option>)}
          </select>
          {activeRound && <p className="mt-2 text-[11px] text-emerald-300">Aktiver Kontrollgang · {activeRound.id.slice(0, 8)}</p>}
        </div>
        {activeRound
          ? <button onClick={() => void completeRound()} disabled={!isOnline}
              className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Kontrollgang abschließen</button>
          : <button onClick={() => void startRound()} disabled={!isOnline || !siteId}
              className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Kontrollgang starten</button>}
      </div>

      {(cameraActive || nfcActive) && (
        <div className="rounded-2xl border border-blue-500/40 bg-slate-950 p-3">
          {cameraActive && (
            <div className="relative mx-auto aspect-video max-h-[50vh] overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-8 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-300/70">
                <QrCode className="h-10 w-10 text-blue-200/80" />
              </div>
              <button onClick={stopCamera} className="absolute right-2 top-2 rounded bg-slate-900/90 px-2 py-1 text-white">Kamera schließen</button>
            </div>
          )}
          {nfcActive && <div role="status" className="flex items-center justify-center gap-2 p-6 text-emerald-200"><LoaderCircle className="h-4 w-4 animate-spin" /> NFC-Tag an das Gerät halten … <button onClick={stopNfc} className="ml-2 underline">Abbrechen</button></div>}
        </div>
      )}

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <label className="mb-3 block font-semibold text-slate-200" htmlFor="patrol-notes">Notiz (optional)</label>
        <textarea id="patrol-notes" value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000}
          className="min-h-20 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-slate-100" placeholder="Beobachtung zum Kontrollpunkt" />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 font-bold text-slate-200">Manuelle Fallback-Kontrolle</h3>
        {loadingCheckpoints && <p className="mb-3 text-slate-400">Kontrollpunkte werden geladen …</p>}
        {!loadingCheckpoints && checkpointRows.length === 0 && (
          <div className="flex items-center gap-2 text-slate-400"><VideoOff className="h-4 w-4" />Keine aktiven Kontrollpunkte für dieses Objekt verfügbar.</div>
        )}
        <div className="space-y-2">
          {checkpointRows.map(checkpoint => {
            const scanned = isPatrolCheckpointRecentlyScanned(scans, checkpoint.id);
            return (
              <div key={checkpoint.id} className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-800/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-bold text-slate-200">{checkpoint.code} · {checkpoint.name}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{checkpoint.locationDetails}</div>
                </div>
                <button disabled={scanned} onClick={() => void handleExecuteScan(checkpoint, activeSite, 'MANUELL')}
                  className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-900/60">
                  {scanned ? 'Kürzlich erfasst' : 'Manuell erfassen'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-[11px] text-slate-400">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        QR- und NFC-Tokens werden serverseitig geprüft. Manuelle Scans sind ausdrücklich als nicht verifiziert markiert; offline gespeicherte Scans gelten erst nach erfolgreicher Serversynchronisierung als bestätigt.
      </p>
    </div>
  );
};
