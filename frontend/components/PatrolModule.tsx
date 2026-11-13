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
  building_name?: string | null;
  area_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  token_version: number;
  required_interval_minutes: number;
  active: boolean;
  archived_at?: string | null;
}

interface PatrolRoute {
  id: string;
  site_id: string;
  site_name: string;
  route_code: string;
  name: string;
  current_version: number;
  active: boolean;
  archived_at?: string | null;
  flexible_order?: boolean;
  target_duration_minutes?: number | null;
  late_tolerance_minutes?: number;
  time_window_start?: string | null;
  time_window_end?: string | null;
  schedule_timezone?: string;
  recurrence_frequency?: 'none' | 'daily' | 'weekly';
  recurrence_interval?: number;
  recurrence_days?: number[];
  assigned_employees?: Array<{ id: string; name: string }>;
  assigned_employee_groups?: Array<{ id: string; name: string }>;
  checkpoints: Array<{ checkpointId: string; code: string; name: string; sequence: number; plannedOffsetMinutes: number }>;
}

interface PatrolEmployeeGroup {
  id: string;
  site_id: string;
  name: string;
  archived_at?: string | null;
  employees: Array<{ id: string; name: string }>;
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

interface PatrolScheduledOccurrence {
  id: string;
  site_name: string;
  route_code: string;
  route_version: number;
  scheduled_at: string;
  deadline_at: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'missed' | 'abandoned';
  employee_name?: string | null;
}

interface PatrolScanAttempt {
  id: string;
  employee_name?: string | null;
  checkpoint_code?: string | null;
  reason_code: string;
  outcome: 'rejected' | 'duplicate';
  server_received_at: string;
}

interface PatrolStats {
  scans: { total: number; verified: number; manual: number };
  exceptions: { total: number; urgent: number };
  rounds: { total: number; in_progress: number; completed: number };
  scheduledOccurrences: { total: number; scheduled: number; missed: number; abandoned: number };
  scanAttempts: { total: number; rejected: number; duplicate: number } | null;
}

interface CreatedCheckpoint extends PatrolCheckpoint {
  scanPayload: string;
}

function queryString(filters: Record<string, string>): string {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const value = query.toString();
  return value ? `?${value}` : '';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('de-DE');
}

export const PatrolModule: React.FC = () => {
  const {
    getTenantSites, getTenantEmployees, currentTenantId, authUser, isOnline, enqueueOfflineAction,
    triggerManualSync, syncQueue
  } = useSecurityStore();
  const sites = getTenantSites();
  const tenantEmployees = getTenantEmployees();
  const permissions = authUser?.permissions || [];
  const canManage = permissions.includes('patrol:manage') ||
    permissions.includes('patrol:checkpoint:manage') ||
    permissions.includes('patrol:route:manage');
  const canReadScanAttempts = permissions.includes('patrol:scan-attempt:read') ||
    permissions.includes('patrol:history:read') ||
    permissions.includes('patrol:audit');
  const canReportException = permissions.includes('patrol:exception:create');
  const [siteId, setSiteId] = useState('');
  const [clientId, setClientId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [stats, setStats] = useState<PatrolStats | null>(null);
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [routes, setRoutes] = useState<PatrolRoute[]>([]);
  const [employeeGroups, setEmployeeGroups] = useState<PatrolEmployeeGroup[]>([]);
  const [scans, setScans] = useState<PatrolScan[]>([]);
  const [exceptions, setExceptions] = useState<PatrolException[]>([]);
  const [scheduledOccurrences, setScheduledOccurrences] = useState<PatrolScheduledOccurrence[]>([]);
  const [scanAttempts, setScanAttempts] = useState<PatrolScanAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [createdCheckpoint, setCreatedCheckpoint] = useState<CreatedCheckpoint | null>(null);
  const [checkpointQr, setCheckpointQr] = useState('');
  const [checkpointCode, setCheckpointCode] = useState('');
  const [checkpointName, setCheckpointName] = useState('');
  const [checkpointLocation, setCheckpointLocation] = useState('');
  const [checkpointBuilding, setCheckpointBuilding] = useState('');
  const [checkpointArea, setCheckpointArea] = useState('');
  const [checkpointLatitude, setCheckpointLatitude] = useState('');
  const [checkpointLongitude, setCheckpointLongitude] = useState('');
  const [checkpointInterval, setCheckpointInterval] = useState(60);
  const [editingCheckpointId, setEditingCheckpointId] = useState('');
  const [routeCode, setRouteCode] = useState('');
  const [routeName, setRouteName] = useState('');
  const [routeChangeReason, setRouteChangeReason] = useState('');
  const [flexibleOrder, setFlexibleOrder] = useState(false);
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(60);
  const [lateToleranceMinutes, setLateToleranceMinutes] = useState(5);
  const [timeWindowStart, setTimeWindowStart] = useState('');
  const [timeWindowEnd, setTimeWindowEnd] = useState('');
  const [scheduleTimezone, setScheduleTimezone] = useState('UTC');
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<'none' | 'daily' | 'weekly'>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<string[]>([]);
  const [assignedEmployeeGroupIds, setAssignedEmployeeGroupIds] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupEmployeeIds, setNewGroupEmployeeIds] = useState<string[]>([]);
  const [selectedCheckpointIds, setSelectedCheckpointIds] = useState<string[]>([]);
  const [versionRouteId, setVersionRouteId] = useState('');
  const [exceptionCategory, setExceptionCategory] = useState('other');
  const [exceptionSeverity, setExceptionSeverity] = useState('normal');
  const [exceptionDescription, setExceptionDescription] = useState('');

  const filters = useMemo(() => queryString({
    siteId, clientId, employeeId, routeId, status, category, from, to
  }), [siteId, clientId, employeeId, routeId, status, category, from, to]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardData, checkpointData, routeData, groupData, scanData, exceptionData, attemptData, occurrenceData] = await Promise.all([
        apiClient.get<PatrolStats>(`/patrol/dashboard${filters}`),
        apiClient.get<PatrolCheckpoint[]>(`/patrol/checkpoints${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
        apiClient.get<PatrolRoute[]>(`/patrol/routes${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
        apiClient.get<PatrolEmployeeGroup[]>(`/patrol/employee-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
        apiClient.get<PatrolScan[]>(`/patrol/scans${filters}`),
        apiClient.get<PatrolException[]>(`/patrol/exceptions${filters}`),
        canReadScanAttempts
          ? apiClient.get<PatrolScanAttempt[]>(`/patrol/scan-attempts${filters}`)
          : Promise.resolve([]),
        apiClient.get<PatrolScheduledOccurrence[]>(`/patrol/scheduled-occurrences${filters}`)
      ]);
      setStats(dashboardData);
      setCheckpoints(checkpointData);
      setRoutes(routeData);
      setEmployeeGroups(groupData);
      setScans(scanData);
      setExceptions(exceptionData);
      setScanAttempts(attemptData);
      setScheduledOccurrences(occurrenceData);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollgangsdaten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [canReadScanAttempts, filters, siteId]);

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
    if (Boolean(checkpointLatitude.trim()) !== Boolean(checkpointLongitude.trim())) {
      setErrorMessage('Breiten- und Längengrad müssen gemeinsam angegeben werden.');
      return;
    }
    const latitude = checkpointLatitude.trim() ? Number(checkpointLatitude) : null;
    const longitude = checkpointLongitude.trim() ? Number(checkpointLongitude) : null;
    if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) {
      setErrorMessage('GPS-Koordinaten müssen gültige Zahlen sein.');
      return;
    }
    const checkpointPayload = {
      code: checkpointCode,
      name: checkpointName,
      locationDetails: checkpointLocation,
      buildingName: checkpointBuilding || null,
      areaName: checkpointArea || null,
      latitude,
      longitude,
      requiredIntervalMinutes: checkpointInterval
    };
    setSaving(true);
    try {
      if (editingCheckpointId) {
        await apiClient.patch(`/patrol/checkpoints/${editingCheckpointId}`, checkpointPayload);
        setNotice('Kontrollpunkt aktualisiert; historische Scan- und Routendaten bleiben unverändert.');
      } else {
        const created = await apiClient.post<CreatedCheckpoint>('/patrol/checkpoints', {
          siteId,
          ...checkpointPayload
        });
        setCreatedCheckpoint(created);
        setNotice('Kontrollpunkt angelegt. Der neue QR-/NFC-Token ist nur jetzt sichtbar; sicher verwahren und am Kontrollpunkt hinterlegen.');
      }
      setCheckpointCode('');
      setCheckpointName('');
      setCheckpointLocation('');
      setCheckpointBuilding('');
      setCheckpointArea('');
      setCheckpointLatitude('');
      setCheckpointLongitude('');
      setEditingCheckpointId('');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunkt konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const editCheckpoint = (point: PatrolCheckpoint) => {
    setSiteId(point.site_id);
    setEditingCheckpointId(point.id);
    setCheckpointCode(point.code);
    setCheckpointName(point.name);
    setCheckpointLocation(point.location_details);
    setCheckpointBuilding(point.building_name ?? '');
    setCheckpointArea(point.area_name ?? '');
    setCheckpointLatitude(point.latitude == null ? '' : String(point.latitude));
    setCheckpointLongitude(point.longitude == null ? '' : String(point.longitude));
    setCheckpointInterval(point.required_interval_minutes);
    setCreatedCheckpoint(null);
    setNotice('');
  };

  const setCheckpointActive = async (point: PatrolCheckpoint, active: boolean) => {
    setSaving(true);
    try {
      await apiClient.patch(`/patrol/checkpoints/${point.id}/status`, { active });
      setNotice(active ? 'Kontrollpunkt aktiviert.' : 'Kontrollpunkt deaktiviert; Scans werden serverseitig abgelehnt.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Kontrollpunktstatus konnte nicht geändert werden.');
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

  const archiveRoute = async (routeId: string) => {
    setSaving(true);
    try {
      await apiClient.post(`/patrol/routes/${routeId}/archive`, {});
      setNotice('Route archiviert; historische Kontrollgänge und Routenversionen bleiben erhalten.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Route konnte nicht archiviert werden.');
    } finally {
      setSaving(false);
    }
  };

  const selectedForRoute = checkpoints.filter(point => point.site_id === siteId && selectedCheckpointIds.includes(point.id));
  const makeRoutePayload = () => ({
    name: routeName,
    changeReason: routeChangeReason,
    flexibleOrder,
    targetDurationMinutes,
    lateToleranceMinutes,
    timeWindowStart: timeWindowStart || null,
    timeWindowEnd: timeWindowEnd || null,
    scheduleTimezone,
    recurrenceFrequency,
    recurrenceInterval,
    recurrenceDays: recurrenceFrequency === 'weekly' ? recurrenceDays : [],
    employeeIds: assignedEmployeeIds,
    employeeGroupIds: assignedEmployeeGroupIds,
    checkpoints: selectedForRoute.map((point, index) => ({ checkpointId: point.id, plannedOffsetMinutes: index * point.required_interval_minutes }))
  });

  const createEmployeeGroup = async () => {
    if (!siteId || !newGroupName.trim() || !newGroupEmployeeIds.length) {
      setErrorMessage('Wählen Sie ein Objekt, einen Gruppennamen und mindestens einen Mitarbeiter.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/patrol/employee-groups', {
        siteId,
        name: newGroupName.trim(),
        employeeIds: newGroupEmployeeIds
      });
      setNewGroupName('');
      setNewGroupEmployeeIds([]);
      setNotice('Mitarbeitergruppe für dieses Objekt angelegt.');
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Mitarbeitergruppe konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

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
  const clients = Array.from(new Map(currentSites.map(site => [site.clientId, site.clientName])).entries());
  const employees = tenantEmployees
    .filter(employee => !employee.archivedAt && (!siteId || employee.assignedSiteIds.includes(siteId)))
    .map(employee => [employee.id, `${employee.firstName} ${employee.lastName}`] as [string, string]);
  const renderRoutePlanning = () => (
    <div className="space-y-3 rounded-lg border border-slate-800 p-3 sm:col-span-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-[11px] text-slate-300">Zeitfenster von
          <input type="time" value={timeWindowStart} onChange={event => setTimeWindowStart(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
        <label className="text-[11px] text-slate-300">Zeitfenster bis
          <input type="time" value={timeWindowEnd} onChange={event => setTimeWindowEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
        <label className="text-[11px] text-slate-300">Zeitzone (IANA)
          <input value={scheduleTimezone} onChange={event => setScheduleTimezone(event.target.value)} placeholder="Europe/Berlin" maxLength={64} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
        <label className="text-[11px] text-slate-300">Wiederholung
          <select value={recurrenceFrequency} onChange={event => {
            const frequency = event.target.value as 'none' | 'daily' | 'weekly';
            setRecurrenceFrequency(frequency);
            if (frequency !== 'weekly') setRecurrenceDays([]);
          }} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="none">Keine</option><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option>
          </select>
        </label>
        <label className="text-[11px] text-slate-300">Intervall
          <input type="number" min={1} max={365} value={recurrenceInterval} onChange={event => setRecurrenceInterval(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        </label>
      </div>
      {recurrenceFrequency === 'weekly' && (
        <fieldset className="flex flex-wrap gap-3 text-[11px] text-slate-300">
          <legend>Wochentage</legend>
          {['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'].map((day, index) => (
            <label key={day} className="flex items-center gap-1">
              <input type="checkbox" checked={recurrenceDays.includes(index)} onChange={event => setRecurrenceDays(current =>
                event.target.checked ? [...current, index].sort() : current.filter(value => value !== index)
              )} />{day}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-wrap gap-3 text-[11px] text-slate-300">
        <legend>Mitarbeiterzuordnung (optional)</legend>
        {employees.length ? employees.map(([id, name]) => (
          <label key={id} className="flex items-center gap-1">
            <input type="checkbox" checked={assignedEmployeeIds.includes(id)} onChange={event => setAssignedEmployeeIds(current =>
              event.target.checked ? [...current, id] : current.filter(value => value !== id)
            )} />{name}
          </label>
        )) : <span>Keine zugeordneten Mitarbeiter für dieses Objekt verfügbar.</span>}
      </fieldset>
      <fieldset className="flex flex-wrap gap-3 text-[11px] text-slate-300">
        <legend>Mitarbeitergruppen (optionale Routenzuweisung)</legend>
        {employeeGroups.filter(group => group.site_id === siteId && !group.archived_at).length
          ? employeeGroups.filter(group => group.site_id === siteId && !group.archived_at).map(group => (
            <label key={group.id} className="flex items-center gap-1">
              <input type="checkbox" checked={assignedEmployeeGroupIds.includes(group.id)} onChange={event => setAssignedEmployeeGroupIds(current =>
                event.target.checked ? [...current, group.id] : current.filter(value => value !== group.id)
              )} />{group.name} ({group.employees.length})
            </label>
          )) : <span>Für dieses Objekt sind keine aktiven Mitarbeitergruppen angelegt.</span>}
      </fieldset>
      <div className="space-y-2 rounded-lg border border-slate-800 p-3">
        <p className="text-[11px] text-slate-300">Mitarbeitergruppe für das ausgewählte Objekt anlegen</p>
        <input value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="Gruppenname" maxLength={120} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-300">
          {employees.map(([id, name]) => (
            <label key={id} className="flex items-center gap-1">
              <input type="checkbox" checked={newGroupEmployeeIds.includes(id)} onChange={event => setNewGroupEmployeeIds(current =>
                event.target.checked ? [...current, id] : current.filter(value => value !== id)
              )} />{name}
            </label>
          ))}
        </div>
        <button type="button" onClick={() => void createEmployeeGroup()} disabled={saving || !siteId} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 disabled:opacity-50">Gruppe anlegen</button>
      </div>
      <p className="text-[10px] text-slate-500">Wiederholungen werden mit lokalem Datum in der IANA-Zeitzone versioniert und automatisch in geplante Rundgänge überführt.</p>
    </div>
  );

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

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Kunde
          <select value={clientId} onChange={event => setClientId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Kunden</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Objekt
          <select value={siteId} onChange={event => setSiteId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Objekte</option>{currentSites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Mitarbeiter
          <select value={employeeId} onChange={event => setEmployeeId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Mitarbeiter</option>{employees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Route
          <select value={routeId} onChange={event => setRouteId(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Routen</option>{routes.map(route => <option key={route.id} value={route.id}>{route.route_code} · {route.name}</option>)}
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Rundgangstatus
          <select value={status} onChange={event => setStatus(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Status</option><option value="in_progress">Laufend</option><option value="completed">Abgeschlossen</option><option value="abandoned">Abgebrochen</option>
          </select>
        </label>
        <label className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-slate-300">Abweichungstyp
          <select value={category} onChange={event => setCategory(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white">
            <option value="">Alle Abweichungen</option><option value="missed_checkpoint">Kontrollpunkt ausgelassen</option><option value="late_checkpoint">Verspäteter Kontrollpunkt</option><option value="missed_round">Geplanter Rundgang verpasst</option><option value="abandoned_round">Rundgang abgebrochen</option><option value="access_blocked">Zugang blockiert</option><option value="hazard">Gefahr</option><option value="damage">Schaden</option><option value="other">Sonstige</option>
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
        <MetricCard label="Geplante Kontrollen" value={stats?.scheduledOccurrences?.scheduled} detail={`${stats?.scheduledOccurrences?.missed ?? 0} überfällig · ${stats?.scheduledOccurrences?.abandoned ?? 0} abgebrochen`} icon={<Clock3 className="h-4 w-4 text-amber-400" />} />
        {canReadScanAttempts && <MetricCard label="Scanversuche" value={stats?.scanAttempts?.total} detail={`${stats?.scanAttempts?.rejected ?? 0} abgewiesen · ${stats?.scanAttempts?.duplicate ?? 0} doppelt`} icon={<ShieldCheck className="h-4 w-4 text-amber-400" />} />}
      </section>

      <DataPanel title="Geplante und überfällige Kontrollgänge" loading={loading} empty={!scheduledOccurrences.length}>
        <div className="max-h-80 space-y-2 overflow-auto">
          {scheduledOccurrences.map(occurrence => (
            <article key={occurrence.id} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><strong className="text-sm text-slate-100">{occurrence.route_code} · {occurrence.site_name}</strong><p className="text-[11px] text-slate-400">{formatTime(occurrence.scheduled_at)} · Version {occurrence.route_version}{occurrence.employee_name ? ` · ${occurrence.employee_name}` : ''}</p></div>
              <span className={`rounded px-2 py-1 text-[10px] ${occurrence.status === 'missed' || occurrence.status === 'abandoned' ? 'bg-red-500/15 text-red-200' : 'bg-indigo-500/15 text-indigo-200'}`}>{occurrence.status}</span>
            </article>
          ))}
        </div>
      </DataPanel>

      {canReadScanAttempts && <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <h2 className="border-b border-slate-800 px-4 py-3 font-semibold text-white">Abgewiesene und doppelte Scanversuche</h2>
        {loading ? <p className="p-4 text-sm text-slate-400">Wird geladen …</p> : scanAttempts.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">Keine Scanversuche im gewählten Filterzeitraum.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-400"><tr><th className="px-4 py-2">Zeit</th><th className="px-4 py-2">Mitarbeiter</th><th className="px-4 py-2">Kontrollpunkt</th><th className="px-4 py-2">Ergebnis</th></tr></thead>
              <tbody>{scanAttempts.map(attempt => (
                <tr key={attempt.id} className="border-t border-slate-800 text-slate-300">
                  <td className="px-4 py-2">{formatTime(attempt.server_received_at)}</td>
                  <td className="px-4 py-2">{attempt.employee_name || 'Unbekannt'}</td>
                  <td className="px-4 py-2">{attempt.checkpoint_code || 'Unbekannt'}</td>
                  <td className="px-4 py-2">{attempt.outcome === 'duplicate' ? 'Doppelter Scan' : `Abgewiesen · ${attempt.reason_code}`}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>}

      {canManage && (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <form onSubmit={createCheckpoint} className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-bold text-white">{editingCheckpointId ? 'Kontrollpunkt bearbeiten' : 'Kontrollpunkt anlegen'}</h2>
            <p className="text-[11px] text-slate-400">Ein zufälliger 256-Bit-Token wird erzeugt; gespeichert wird nur sein SHA-256-Hash. Der Token ist nur nach Anlegen oder Rotation sichtbar.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input required maxLength={50} value={checkpointCode} onChange={event => setCheckpointCode(event.target.value)} placeholder="Code (z. B. CP-01)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input required maxLength={150} value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="Name" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input maxLength={2000} value={checkpointLocation} onChange={event => setCheckpointLocation(event.target.value)} placeholder="Standortdetails" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input maxLength={150} value={checkpointBuilding} onChange={event => setCheckpointBuilding(event.target.value)} placeholder="Gebäude (optional)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input maxLength={150} value={checkpointArea} onChange={event => setCheckpointArea(event.target.value)} placeholder="Bereich (optional)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input type="number" min={-90} max={90} step="any" value={checkpointLatitude} onChange={event => setCheckpointLatitude(event.target.value)} placeholder="Breitengrad (optional)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <input type="number" min={-180} max={180} step="any" value={checkpointLongitude} onChange={event => setCheckpointLongitude(event.target.value)} placeholder="Längengrad (optional)" className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              <label className="text-slate-300">Prüfintervall (Min.)
                <input type="number" min={1} max={1440} value={checkpointInterval} onChange={event => setCheckpointInterval(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={saving || !siteId} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> {editingCheckpointId ? 'Änderungen speichern' : 'Kontrollpunkt speichern'}</button>
              {editingCheckpointId && <button type="button" onClick={() => { setEditingCheckpointId(''); setCheckpointCode(''); setCheckpointName(''); setCheckpointLocation(''); setCheckpointBuilding(''); setCheckpointArea(''); setCheckpointLatitude(''); setCheckpointLongitude(''); }} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200">Bearbeitung abbrechen</button>}
            </div>
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
              <label className="flex items-center gap-2 text-[11px] text-slate-300 sm:col-span-2">
                <input type="checkbox" checked={flexibleOrder} onChange={event => setFlexibleOrder(event.target.checked)} />
                Flexible Reihenfolge erlauben (sonst feste Reihenfolge)
              </label>
              <label className="text-[11px] text-slate-300">Soll-Dauer (Min.)
                <input type="number" min={1} max={10080} value={targetDurationMinutes} onChange={event => setTargetDurationMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
              <label className="text-[11px] text-slate-300">Verspätungstoleranz (Min.)
                <input type="number" min={0} max={1440} value={lateToleranceMinutes} onChange={event => setLateToleranceMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
              {renderRoutePlanning()}
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
              <label className="flex items-center gap-2 text-[11px] text-slate-300 sm:col-span-2">
                <input type="checkbox" checked={flexibleOrder} onChange={event => setFlexibleOrder(event.target.checked)} />
                Flexible Reihenfolge erlauben (sonst feste Reihenfolge)
              </label>
              <label className="text-[11px] text-slate-300">Soll-Dauer (Min.)
                <input type="number" min={1} max={10080} value={targetDurationMinutes} onChange={event => setTargetDurationMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
              <label className="text-[11px] text-slate-300">Verspätungstoleranz (Min.)
                <input type="number" min={0} max={1440} value={lateToleranceMinutes} onChange={event => setLateToleranceMinutes(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-white" />
              </label>
              {renderRoutePlanning()}
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
              <div className="flex items-center justify-between gap-2"><strong className="text-slate-100">{route.route_code} · {route.name}</strong><span className="rounded bg-indigo-500/15 px-2 py-1 text-indigo-200">v{route.current_version}{route.active ? '' : ' · inaktiv'}</span></div>
              <p className="mt-1 text-[11px] text-slate-400">{route.site_name} · {route.checkpoints.map(point => point.code).join(route.flexible_order ? ' · ' : ' → ')}</p>
              <p className="mt-1 text-[10px] text-slate-500">{route.flexible_order ? 'Flexible Reihenfolge' : 'Feste Reihenfolge'} · Soll {route.target_duration_minutes ?? '—'} Min. · Verspätungstoleranz {route.late_tolerance_minutes ?? 5} Min. · {route.schedule_timezone ?? 'UTC'}</p>
              {canManage && route.active && <button disabled={saving} onClick={() => void archiveRoute(route.id)} className="mt-2 rounded bg-slate-800 px-2 py-1 text-[10px] text-amber-200">Route archivieren</button>}
            </article>
          ))}</div>
        </DataPanel>

        <DataPanel title="Kontrollpunkte" loading={loading} empty={!checkpoints.length}>
          <div className="space-y-2">{checkpoints.map(point => (
            <article key={point.id} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><strong className="text-slate-100">{point.code} · {point.name}</strong><p className="mt-1 text-[11px] text-slate-400">{point.site_name} · Token v{point.token_version} · Intervall {point.required_interval_minutes} Min. · {point.active ? 'aktiv' : point.archived_at ? 'archiviert' : 'deaktiviert'}</p><p className="mt-1 text-[10px] text-slate-500">{[point.building_name, point.area_name, point.location_details, point.latitude != null && point.longitude != null ? `${point.latitude}, ${point.longitude}` : null].filter(Boolean).join(' · ')}</p></div>
              {canManage && !point.archived_at && <div className="flex flex-wrap gap-2"><button disabled={saving} onClick={() => editCheckpoint(point)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-200">Bearbeiten</button><button disabled={saving} onClick={() => void setCheckpointActive(point, !point.active)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-indigo-200">{point.active ? 'Deaktivieren' : 'Aktivieren'}</button>{point.active && <button disabled={saving} onClick={() => void rotateToken(point.id)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-blue-200">Token rotieren</button>}<button disabled={saving} onClick={() => void archiveCheckpoint(point.id)} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-amber-200">Archivieren</button></div>}
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
