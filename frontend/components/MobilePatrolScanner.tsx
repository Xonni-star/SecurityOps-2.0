import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Camera, CheckCircle2, LoaderCircle, MapPin, QrCode, Radio, ShieldCheck, VideoOff
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Checkpoint, PatrolScanEvent, Site } from '../types';
import { ApiError, apiClient } from '../services/apiClient';
import { offlineVault, StoredPatrolRound } from '../services/indexedDbService';

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
  siteId: string;
  name: string;
  currentVersion: number;
  flexibleOrder: boolean;
  lateToleranceMinutes: number;
  checkpoints: Array<{ checkpointId: string; code: string; name: string; sequence: number; plannedOffsetMinutes: number }>;
}

interface PatrolRound {
  id: string;
  site_id?: string;
  route_id?: string | null;
  route_version?: number | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: string;
  localStatus?: 'in_progress' | 'completion_pending';
}

interface PatrolAttachment {
  id: string;
  document_id: string;
  title: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  scan_status: string;
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

function mapRoute(row: Record<string, unknown>): PatrolRoute {
  const checkpoints = Array.isArray(row.checkpoints) ? row.checkpoints : [];
  return {
    id: String(row.id),
    siteId: String(row.site_id ?? row.siteId),
    name: String(row.name),
    currentVersion: Number(row.current_version ?? row.currentVersion ?? 1),
    flexibleOrder: row.flexible_order === true || row.flexibleOrder === true,
    lateToleranceMinutes: Number(row.late_tolerance_minutes ?? row.lateToleranceMinutes ?? 5),
    checkpoints: checkpoints.map((item: any, index) => ({
      checkpointId: String(item.checkpointId ?? item.checkpoint_id),
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      sequence: Number(item.sequence ?? index + 1),
      plannedOffsetMinutes: Number(item.plannedOffsetMinutes ?? item.planned_offset_minutes ?? 0)
    }))
  };
}

function mapStoredRound(round: StoredPatrolRound): PatrolRound {
  return {
    id: round.roundId,
    site_id: round.siteId,
    route_id: round.routeId,
    route_version: round.routeVersion,
    status: 'in_progress',
    started_at: round.startedAt,
    localStatus: round.status
  };
}

function mapQueuedScan(
  mutation: { id: string; occurredAt: string; payload: Record<string, any> },
  checkpoints: PatrolCheckpoint[],
  userId: string,
  userName: string,
  tenantId: string
): PatrolScanEvent {
  const checkpoint = checkpoints.find(point => point.id === mutation.payload.checkpointId);
  return {
    id: mutation.id,
    tenantId,
    siteId: String(mutation.payload.siteId),
    siteName: checkpoint?.siteName ?? '',
    checkpointId: String(mutation.payload.checkpointId),
    checkpointCode: checkpoint?.code ?? 'Offline',
    checkpointName: checkpoint?.name ?? 'Offline erfasster Kontrollpunkt',
    guardId: userId,
    guardName: userName,
    scannedAt: String(mutation.payload.scannedAt ?? mutation.occurredAt),
    method: mutation.payload.method,
    verifiedTag: 'pending_server_verification',
    checkpointTokenVersion: mutation.payload.checkpointTokenVersion,
    roundId: mutation.payload.roundId,
    notes: mutation.payload.notes,
    latitude: mutation.payload.latitude == null ? undefined : Number(mutation.payload.latitude),
    longitude: mutation.payload.longitude == null ? undefined : Number(mutation.payload.longitude),
    offlineCaptured: true
  };
}

export const MobilePatrolScanner: React.FC = () => {
  const {
    getTenantSites, getTenantPatrolScans, addPatrolScan,
    currentUserId, currentUserName, currentTenantId, authUser, isOnline, triggerManualSync
  } = useSecurityStore();
  const sites = getTenantSites();
  const storedScans = getTenantPatrolScans();
  const userId = authUser?.id || currentUserId;
  const permissions = authUser?.permissions ?? [];
  const canUploadAttachment = permissions.includes('documents:create') && permissions.includes('documents:read');
  const [queuedScans, setQueuedScans] = useState<PatrolScanEvent[]>([]);
  const scans = [
    ...storedScans,
    ...queuedScans.filter(queued => !storedScans.some(scan =>
      scan.checkpointId === queued.checkpointId && scan.scannedAt === queued.scannedAt
    ))
  ];
  const [siteId, setSiteId] = useState(sites[0]?.id || '');
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [documentCategories, setDocumentCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedDocumentCategory, setSelectedDocumentCategory] = useState('');
  const [roundAttachments, setRoundAttachments] = useState<PatrolAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [activeRound, setActiveRound] = useState<PatrolRound | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<'QR_CODE' | 'NFC_TAG' | 'MANUELL'>('MANUELL');
  const [scanSuccessMessage, setScanSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [captureGps, setCaptureGps] = useState(false);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [nfcActive, setNfcActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const nfcAbort = useRef<AbortController | null>(null);
  const onQrValue = useRef<(value: string) => void>(() => {});

  const activeSite = sites.find(site => site.id === siteId);
  const checkpointRows = checkpoints.filter(point => point.siteId === siteId && point.active);
  const activeRoute = activeRound?.route_id ? routes.find(route => route.id === activeRound.route_id) : undefined;
  const activeRoundScans = scans.filter(scan => scan.roundId === activeRound?.id);
  const routeProgress = (activeRoute?.checkpoints ?? []).map(point => {
    const scan = activeRoundScans.find(item => item.checkpointId === point.checkpointId);
    const dueAt = Date.parse(activeRound?.started_at || '') + point.plannedOffsetMinutes * 60_000;
    const lateTolerance = (activeRoute?.lateToleranceMinutes ?? 5) * 60_000;
    return { ...point, scan, late: !scan && Number.isFinite(dueAt) && Date.now() > dueAt + lateTolerance };
  });

  useEffect(() => {
    if (!siteId && sites.length) setSiteId(sites[0].id);
  }, [siteId, sites]);

  useEffect(() => {
    let active = true;
    if (!isOnline || !canUploadAttachment) {
      setDocumentCategories([]);
      return () => { active = false; };
    }
    void apiClient.get<Array<{ id: string; name: string }>>('/documents/categories')
      .then(categories => {
        if (active) {
          setDocumentCategories(categories);
          setSelectedDocumentCategory(previous => categories.some(category => category.id === previous)
            ? previous
            : categories.find(category => category.name === 'Objektunterlagen')?.id ?? categories[0]?.id ?? '');
        }
      })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'DMS-Kategorien konnten nicht geladen werden.');
      });
    return () => { active = false; };
  }, [isOnline, canUploadAttachment]);

  useEffect(() => {
    let active = true;
    if (!activeRound || !isOnline) {
      setRoundAttachments([]);
      return () => { active = false; };
    }
    void apiClient.get<PatrolAttachment[]>(`/patrol/rounds/${activeRound.id}/attachments`)
      .then(attachments => { if (active) setRoundAttachments(attachments); })
      .catch(error => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Kontrollgangsanlagen konnten nicht geladen werden.');
      });
    return () => { active = false; };
  }, [activeRound?.id, isOnline]);

  useEffect(() => {
    let active = true;
    setLoadingCheckpoints(true);
    const loadPatrolData = async () => {
      let cached: Awaited<ReturnType<typeof offlineVault.getPatrolCheckpointCache>> = null;
      let localRounds: StoredPatrolRound[] = [];
      let patrolOutbox: Awaited<ReturnType<typeof offlineVault.getOutbox>> = [];
      try {
        if (isOnline) await triggerManualSync();
        [cached, localRounds, patrolOutbox] = await Promise.all([
          offlineVault.getPatrolCheckpointCache(currentTenantId, userId),
          offlineVault.getPatrolRounds(currentTenantId, userId),
          offlineVault.getOutbox(currentTenantId, 'patrol')
        ]);
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'Offline-Kontrollgangsdaten konnten nicht wiederhergestellt werden.');
      }

      if (!active) return;
      const cachedCheckpoints = cached?.checkpoints.map(mapCheckpoint) ?? [];
      const cachedRoutes = (cached?.routes ?? []).map(mapRoute);
      setCheckpoints(cachedCheckpoints);
      setRoutes(cachedRoutes);
      setSelectedRouteId(previous => cachedRoutes.some(route => route.id === previous && route.siteId === siteId) ? previous : '');
      const pendingCompletions = new Set(
        patrolOutbox
          .filter(item => item.payload?.recordType === 'round_complete')
          .map(item => String(item.payload.roundId))
      );
      const queuedScansForSite = patrolOutbox
        .filter(item => item.payload?.recordType === 'scan' && item.payload.siteId === siteId)
        .map(item => mapQueuedScan(item, cachedCheckpoints, userId, currentUserName, currentTenantId));
      setQueuedScans(queuedScansForSite);
      const cachedRound = localRounds.find(round => round.siteId === siteId && !pendingCompletions.has(round.roundId));
      const queuedStart = patrolOutbox.find(item =>
        item.payload?.recordType === 'round_start' &&
        item.payload.siteId === siteId &&
        !pendingCompletions.has(String(item.payload.roundId))
      );
      const restoredRound = cachedRound
        ? mapStoredRound(cachedRound)
        : queuedStart
          ? {
              id: String(queuedStart.payload.roundId),
              site_id: siteId,
              route_id: queuedStart.payload.routeId ?? null,
              route_version: queuedStart.payload.routeVersion ?? null,
              status: 'in_progress' as const,
              started_at: String(queuedStart.payload.startedAt ?? queuedStart.occurredAt),
              localStatus: 'in_progress' as const
            }
          : null;
      setActiveRound(restoredRound);

      if (!isOnline) {
        setErrorMessage(cachedCheckpoints.some(point => point.siteId === siteId)
          ? 'Offline: gespeicherte Routen und Kontrollpunkte werden verwendet. Scans und Rundgangsereignisse werden beim Synchronisieren geprüft.'
          : 'Offline und keine gespeicherten Kontrollpunktdaten für dieses Objekt vorhanden.');
        setLoadingCheckpoints(false);
        return;
      }

      try {
        const fresh = await apiClient.get<Record<string, unknown>[]>(`/patrol/checkpoints?siteId=${encodeURIComponent(siteId)}`);
        const freshRoutes = await apiClient.get<Record<string, unknown>[]>(`/patrol/routes?siteId=${encodeURIComponent(siteId)}`);
        const freshRounds = await apiClient.get<PatrolRound[]>(
          `/patrol/rounds?siteId=${encodeURIComponent(siteId)}&status=in_progress&limit=1`
        );
        const freshScans = await apiClient.get<Record<string, unknown>[]>(
          `/patrol/scans?siteId=${encodeURIComponent(siteId)}&limit=100`
        );
        const mapped = fresh.map(mapCheckpoint);
        if (!active) return;
        const mappedRoutes = freshRoutes.map(mapRoute);
        const mergedCheckpoints = [...cachedCheckpoints.filter(point => point.siteId !== siteId), ...mapped];
        const mergedRoutes = [...cachedRoutes.filter(route => route.siteId !== siteId), ...mappedRoutes];
        setCheckpoints(mergedCheckpoints);
        setRoutes(mappedRoutes);
        setSelectedRouteId(previous => mappedRoutes.some(route => route.id === previous) ? previous : '');
        const serverScans = freshScans.map(row => ({
          id: String(row.id),
          tenantId: currentTenantId,
          siteId: String(row.site_id),
          siteName: String(row.site_name ?? ''),
          checkpointId: String(row.checkpoint_id),
          checkpointCode: String(row.checkpoint_code),
          checkpointName: String(row.checkpoint_name),
          guardId: String(row.guard_id),
          guardName: currentUserName,
          scannedAt: String(row.client_captured_at ?? row.scanned_at),
          method: row.method as PatrolScanEvent['method'],
          verifiedTag: String(row.verification_status),
          roundId: row.round_id ? String(row.round_id) : undefined,
          notes: row.notes ? String(row.notes) : undefined,
          latitude: row.latitude == null ? undefined : Number(row.latitude),
          longitude: row.longitude == null ? undefined : Number(row.longitude),
          offlineCaptured: false
        }));
        const locallyCompleting = freshRounds.some(round => pendingCompletions.has(round.id));
        if (restoredRound?.localStatus === 'in_progress') setActiveRound(restoredRound);
        else if (!locallyCompleting && freshRounds[0]) {
          const serverRound = freshRounds[0];
          setActiveRound(serverRound);
          await offlineVault.savePatrolRound({
            tenantId: currentTenantId,
            userId,
            roundId: serverRound.id,
            siteId: String(serverRound.site_id ?? siteId),
            routeId: serverRound.route_id ?? null,
            routeVersion: serverRound.route_version ?? null,
            startedAt: serverRound.started_at,
            status: 'in_progress',
            serverSynced: true
          });
        } else setActiveRound(null);
        setQueuedScans(queuedScansForSite);
        await offlineVault.savePatrolCheckpointCache(currentTenantId, userId, [
          ...cachedCheckpoints.filter(point => point.siteId !== siteId),
          ...mapped
        ] as unknown as Array<Record<string, unknown>>, [
          ...cachedRoutes.filter(route => route.siteId !== siteId),
          ...mappedRoutes
        ] as unknown as Array<Record<string, unknown>>);
        setQueuedScans(previous => {
          const known = new Set(previous.map(scan => `${scan.checkpointId}:${scan.scannedAt}`));
          return [
            ...previous,
            ...serverScans.filter(scan => !known.has(`${scan.checkpointId}:${scan.scannedAt}`))
          ];
        });
        setErrorMessage(null);
      } catch (error) {
        if (active) setErrorMessage(
          cachedCheckpoints.some(point => point.siteId === siteId)
            ? `Backend nicht erreichbar; gespeicherte Routendaten bleiben verfügbar. ${error instanceof Error ? error.message : ''}`
            : error instanceof Error ? error.message : 'Kontrollpunkte konnten nicht geladen werden.'
        );
      } finally {
        if (active) setLoadingCheckpoints(false);
      }
    };
    if (siteId) void loadPatrolData();
    else setLoadingCheckpoints(false);
    return () => { active = false; };
  }, [siteId, currentTenantId, userId, isOnline, triggerManualSync, currentUserName]);

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
    let coordinates: { latitude?: number; longitude?: number } = {};
    if (captureGps) {
      if (!navigator.geolocation) {
        setErrorMessage('GPS ist in diesem Browser nicht verfügbar; der Scan wird ohne GPS erfasst.');
      } else {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
              maximumAge: 30_000
            });
          });
          coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        } catch {
          setErrorMessage('GPS-Position konnte nicht abgerufen werden; der Scan wird ohne GPS erfasst.');
        }
      }
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
        notes: notes.trim() || undefined,
        ...coordinates
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
    if (!siteId) return;
    const route = routes.find(item => item.id === selectedRouteId && item.siteId === siteId);
    if (selectedRouteId && !route) {
      setErrorMessage('Die ausgewählte Route ist für dieses Objekt nicht mehr im lokalen Cache verfügbar.');
      return;
    }
    const roundId = crypto.randomUUID();
    const clientMutationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const roundPayload = {
      roundId,
      siteId,
      routeId: route?.id,
      routeVersion: route?.currentVersion,
      startedAt
    };
    let localCacheWarning: string | null = null;
    let queuedOffline = !isOnline;
    try {
      let round: PatrolRound;
      if (isOnline) {
        try {
          round = await apiClient.post<PatrolRound>('/patrol/rounds', {
            ...roundPayload,
            clientMutationId
          });
        } catch (error) {
          if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
          queuedOffline = true;
        }
      }

      if (queuedOffline) {
        await useSecurityStore.getState().enqueueOfflineAction({
          id: clientMutationId,
          tenantId: currentTenantId,
          entityType: 'patrol',
          action: 'CREATE',
          payload: { recordType: 'round_start', ...roundPayload },
          baseVersion: 1
        });
        round = {
          id: roundId,
          site_id: siteId,
          route_id: route?.id ?? null,
          route_version: route?.currentVersion ?? null,
          status: 'in_progress',
          started_at: startedAt,
          localStatus: 'in_progress'
        };
      }
      try {
        await offlineVault.savePatrolRound({
          tenantId: currentTenantId,
          userId,
          roundId: round.id,
          siteId,
          routeId: route?.id ?? null,
          routeVersion: route?.currentVersion ?? null,
          startedAt,
          status: 'in_progress',
          serverSynced: !queuedOffline
        });
      } catch {
        localCacheWarning = queuedOffline
          ? 'Kontrollgang wurde in der Outbox gesichert; der lokale Wiederherstellungscache ist nicht verfügbar.'
          : 'Kontrollgang wurde serverseitig gestartet, aber der lokale Wiederherstellungscache konnte nicht geschrieben werden.';
      }
      setActiveRound(round);
      setErrorMessage(localCacheWarning);
      setScanSuccessMessage(!queuedOffline
        ? 'Kontrollgang gestartet und serverseitig gespeichert.'
        : 'Kontrollgang offline gestartet und lokal für die Synchronisierung vorgemerkt.');
      if (queuedOffline && isOnline) void triggerManualSync();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgang konnte nicht gestartet werden.');
    }
  };

  const completeRound = async () => {
    if (!activeRound) return;
    const completedAt = new Date().toISOString();
    const clientMutationId = crypto.randomUUID();
    let localCacheWarning: string | null = null;
    let queuedOffline = !isOnline;
    try {
      if (isOnline) {
        try {
          await apiClient.post(`/patrol/rounds/${activeRound.id}/complete`, {
            clientMutationId,
            completedAt,
            ...(completionNotes.trim() ? { notes: completionNotes.trim() } : {})
          });
        } catch (error) {
          if (!(error instanceof ApiError) || !error.isNetworkError) throw error;
          queuedOffline = true;
        }
      }

      if (queuedOffline) {
        await useSecurityStore.getState().enqueueOfflineAction({
          id: clientMutationId,
          tenantId: currentTenantId,
          entityType: 'patrol',
          action: 'UPDATE',
          payload: {
            recordType: 'round_complete',
            roundId: activeRound.id,
            completedAt,
            ...(completionNotes.trim() ? { notes: completionNotes.trim() } : {})
          },
          baseVersion: 1
        });
        try {
          await offlineVault.savePatrolRound({
            tenantId: currentTenantId,
            userId,
            roundId: activeRound.id,
            siteId: activeRound.site_id || siteId,
            routeId: activeRound.route_id ?? null,
            routeVersion: activeRound.route_version ?? null,
            startedAt: activeRound.started_at,
            status: 'completion_pending',
            serverSynced: activeRound.localStatus !== 'in_progress'
          });
        } catch {
          localCacheWarning = 'Kontrollgangsabschluss wurde in der Outbox gesichert; der lokale Cache konnte nicht aktualisiert werden.';
        }
      } else {
        try {
          await offlineVault.deletePatrolRound(currentTenantId, userId, activeRound.id);
        } catch {
          localCacheWarning = 'Kontrollgang wurde serverseitig abgeschlossen, aber der lokale Wiederherstellungscache konnte nicht entfernt werden.';
        }
      }
      setActiveRound(null);
      setCompletionNotes('');
      setErrorMessage(localCacheWarning);
      setScanSuccessMessage(!queuedOffline
        ? 'Kontrollgang abgeschlossen und serverseitig gespeichert.'
        : 'Kontrollgang offline abgeschlossen; Abschluss und Scans bleiben in der Outbox.');
      if (queuedOffline && isOnline) void triggerManualSync();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgang konnte nicht abgeschlossen werden.');
    }
  };

  const uploadRoundAttachment = async (file: File | undefined) => {
    if (!file || !activeRound || !siteId || !selectedDocumentCategory || !canUploadAttachment) return;
    setUploadingAttachment(true);
    try {
      const metadata = new URLSearchParams({
        title: file.name,
        categoryId: selectedDocumentCategory,
        description: `Kontrollgangsanlage ${activeRound.id}`,
        relationshipType: 'site',
        relationshipId: siteId
      });
      const document = await apiClient.uploadFile<{ id: string }>(`/documents?${metadata.toString()}`, file);
      await apiClient.post(`/patrol/rounds/${activeRound.id}/attachments`, { documentId: document.id });
      setRoundAttachments(await apiClient.get<PatrolAttachment[]>(`/patrol/rounds/${activeRound.id}/attachments`));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Anlage konnte nicht hochgeladen und verknüpft werden.');
    } finally {
      setUploadingAttachment(false);
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
          {activeRound && <p className="mt-2 text-[11px] text-emerald-300">
            Aktiver Kontrollgang · {activeRound.id.slice(0, 8)}
            {activeRound.localStatus === 'in_progress' && !isOnline ? ' · lokal gespeichert, Sync ausstehend' : ''}
          </p>}
          {activeRound && activeRoute && <p className="mt-1 text-[10px] text-slate-400">
            {activeRoute.flexibleOrder ? 'Flexible Reihenfolge' : 'Feste Reihenfolge'} · Toleranz {activeRoute.lateToleranceMinutes} Min.
          </p>}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {activeRound && <label className="text-[11px] text-slate-300">Abschlussbemerkung
            <input value={completionNotes} onChange={event => setCompletionNotes(event.target.value)} maxLength={2000}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 sm:w-64" />
          </label>}
          {activeRound
            ? <button onClick={() => void completeRound()}
                className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white">Kontrollgang abschließen</button>
            : <button onClick={() => void startRound()} disabled={!siteId}
                className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Kontrollgang starten</button>}
        </div>
      </div>

      {activeRound && routeProgress.length > 0 && (
        <section aria-label="Kontrollgang-Fortschritt" className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-100">Routenfortschritt</h3>
            <span className="text-slate-400">{activeRoundScans.length}/{routeProgress.length} Kontrollpunkte</span>
          </div>
          <ul className="space-y-2">
            {routeProgress.map(point => (
              <li key={point.checkpointId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/60 p-2">
                <span className="text-slate-200">{point.sequence}. {point.code} · {point.name}</span>
                <span className={point.scan ? 'text-emerald-300' : point.late ? 'text-amber-300' : 'text-slate-400'}>
                  {point.scan ? 'Erledigt' : point.late ? 'Verspätet' : 'Offen'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeRound && (
        <section aria-label="Kontrollgangsanlagen" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-slate-100">Fotos und Anlagen</h3>
              <p className="text-[11px] text-slate-400">Dateien werden im Dokumentenmanagement gespeichert und revisionssicher mit dem Rundgang verknüpft.</p>
            </div>
            {isOnline && canUploadAttachment && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select value={selectedDocumentCategory} onChange={event => setSelectedDocumentCategory(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white">
                  {documentCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <label className="cursor-pointer rounded-lg bg-indigo-700 px-3 py-2 text-center text-xs font-semibold text-white">
                  {uploadingAttachment ? 'Upload läuft…' : 'Foto / Datei hinzufügen'}
                  <input type="file" accept="image/*,application/pdf" capture="environment" disabled={uploadingAttachment || !selectedDocumentCategory} onChange={event => {
                    void uploadRoundAttachment(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }} className="sr-only" />
                </label>
              </div>
            )}
          </div>
          {!isOnline && <p className="text-[11px] text-amber-200">Anlagen benötigen derzeit eine Verbindung; Offline-Foto-Uploads sind nicht verfügbar.</p>}
          {isOnline && !canUploadAttachment && <p className="text-[11px] text-amber-200">DMS-Upload nicht verfügbar: Es fehlen die Dokumentenrechte zum Lesen und Erstellen.</p>}
          {roundAttachments.length > 0 && (
            <ul className="space-y-1">
              {roundAttachments.map(attachment => (
                <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-300">
                  <span>{attachment.title} · {attachment.original_filename} · {Math.ceil(attachment.size_bytes / 1024)} KB</span>
                  <span className="text-[10px] text-slate-500">Scanstatus: {attachment.scan_status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
        <label className="mb-3 flex items-center gap-2 text-slate-300">
          <input type="checkbox" checked={captureGps} onChange={event => setCaptureGps(event.target.checked)} />
          GPS-Position optional bei Scans erfassen
        </label>
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
