import React, { useState } from 'react';
import {
  Smartphone,
  Tablet,
  Lock,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  QrCode,
  Sliders,
  Battery,
  Wifi,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Copy,
  ExternalLink
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { MobileDeviceEntity, KioskOperatingMode, StationProfileType, AndroidEnterpriseProvisioningPayload } from '../types';

export const MobileDeviceManager: React.FC = () => {
  const {
    getTenantMobileDevices,
    stationProfiles,
    activeStationProfile,
    setActiveStationProfile,
    currentKioskMode,
    setKioskMode,
    lockDeviceRemotely,
    wipeDeviceRemotely,
    getCurrentTenant
  } = useSecurityStore();

  const tenant = getCurrentTenant();
  const devices = getTenantMobileDevices();

  const [activeTab, setActiveTab] = useState<'fleet' | 'kiosk_profiles' | 'provisioning_qr'>('fleet');
  const [selectedDevice, setSelectedDevice] = useState<MobileDeviceEntity | null>(null);
  const [provisioningProfile, setProvisioningProfile] = useState<StationProfileType>(StationProfileType.PFORTE);
  const [provisioningKioskMode, setProvisioningKioskMode] = useState<KioskOperatingMode>(KioskOperatingMode.SINGLE_APP);

  const activeKioskDevices = devices.filter((d) => d.lockTaskModeActive).length;

  const sampleProvisioningJson: AndroidEnterpriseProvisioningPayload = {
    version: '2.0.4',
    packageName: 'de.securityops.mobile',
    checksumSha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
    enrollmentToken: `tok-${tenant.id}-kiosk-2025`,
    kioskMode: provisioningKioskMode,
    stationProfile: provisioningProfile,
    tenantId: tenant.id,
    apiBaseUrl: 'https://securityops.de/api/v1',
    adminPinHash: 'argon2id$v=19$m=65536,t=3,p=4$salt7720$hash',
    lockTaskPackages: ['de.securityops.mobile', 'com.android.camera', 'com.google.android.dialer']
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Mobile Geräteverwaltung & Kiosk-Flotte (MDM/EMM)</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Zentrale Verwaltung für dienstlich eingesetzte Android Enterprise & Apple iOS Geräte, Kiosk-Profile und Fernsperrung für {tenant.name}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-semibold flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>{activeKioskDevices} Geräte im Kiosk-Modus</span>
          </span>
        </div>
      </div>

      {/* Fleet Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Registrierte Dienstgeräte</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">{devices.length} Geräte</span>
          <span className="text-[10px] text-emerald-400">100% Mandanten-Scope</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Aktive Kiosk-Sperren</span>
          <span className="text-xl font-bold text-amber-400 mt-1 block">{activeKioskDevices} LockTask</span>
          <span className="text-[10px] text-slate-500">Android & Apple ASAM</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Arbeitsplatzprofile</span>
          <span className="text-xl font-bold text-slate-100 mt-1 block">{stationProfiles.length} Profile</span>
          <span className="text-[10px] text-blue-400">Pforte, Rundgang, Wachbuch</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-slate-400 block text-[11px]">Aktiver lokaler Modus</span>
          <span className="text-sm font-bold text-emerald-400 mt-1 block truncate">{currentKioskMode}</span>
          <span className="text-[10px] text-slate-500">{activeStationProfile.name}</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        <button
          onClick={() => setActiveTab('fleet')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            activeTab === 'fleet' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Dienstgeräte-Flotte ({devices.length})
        </button>
        <button
          onClick={() => setActiveTab('kiosk_profiles')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            activeTab === 'kiosk_profiles' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Kiosk-Arbeitsplatzprofile ({stationProfiles.length})
        </button>
        <button
          onClick={() => setActiveTab('provisioning_qr')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
            activeTab === 'provisioning_qr' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>Android Enterprise & Apple MDM Provisionierung</span>
        </button>
      </div>

      {/* Tab 1: Device Fleet */}
      {activeTab === 'fleet' && (
        <div className="space-y-3 text-xs">
          {devices.map((dev) => (
            <div
              key={dev.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 max-w-xl">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-slate-200 text-sm">{dev.deviceName}</span>
                  <span className="px-2 py-0.2 rounded text-[10px] font-mono bg-slate-800 text-blue-400 border border-slate-700">
                    {dev.platform}
                  </span>
                  <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                    dev.status === 'ACTIVE'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : dev.status === 'LOCKED'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}>
                    {dev.status}
                  </span>
                  {dev.lockTaskModeActive && (
                    <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-purple-500/10 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                      <Lock className="w-2.5 h-2.5" /> LockTask
                    </span>
                  )}
                </div>

                <div className="text-slate-400 text-xs">
                  Zugewiesen an: <strong className="text-slate-200">{dev.assignedUserName || 'Gemeinschafts-Terminal'}</strong> • Profil: <span className="text-blue-300">{dev.assignedStationProfile}</span>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono flex-wrap">
                  <span>OS: {dev.osVersion}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><Battery className="w-3 h-3 text-emerald-400" /> {dev.batteryLevel}%</span>
                  <span>•</span>
                  <span>Letzter Kontakt: {dev.lastContactAt}</span>
                  <span>•</span>
                  <span>ID: {dev.deviceId}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <button
                  onClick={() => lockDeviceRemotely(dev.deviceId)}
                  disabled={dev.status === 'LOCKED'}
                  className="px-3 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1 transition disabled:opacity-40"
                  title="Gerät per Lock Task Mode aus der Ferne sperren"
                >
                  <Lock className="w-3 h-3" />
                  <span>Fernsperren</span>
                </button>

                <button
                  onClick={() => {
                    if (confirm(`Achtung: Wollen Sie das Gerät "${dev.deviceName}" wirklich aus der Ferne löschen (Enterprise Wipe)?`)) {
                      wipeDeviceRemotely(dev.deviceId);
                    }
                  }}
                  disabled={dev.status === 'WIPED'}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold flex items-center gap-1 transition disabled:opacity-40"
                  title="Lokale Datenbank & Sitzung aus der Ferne löschen"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remote Wipe</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab 2: Kiosk Station Profiles */}
      {activeTab === 'kiosk_profiles' && (
        <div className="space-y-4 text-xs">
          <p className="text-slate-400">
            Arbeitsplatzprofile maskieren die Benutzeroberfläche auf den dienstlich erforderlichen Funktionsumfang. Die tatsächlichen Berechtigungen bleiben zusätzlich serverseitig verbindlich.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {stationProfiles.map((p) => {
              const isCurrent = activeStationProfile.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-5 rounded-2xl border flex flex-col justify-between transition ${
                    isCurrent
                      ? 'bg-blue-600/10 border-blue-500/50 shadow-md'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-200 text-sm">{p.name}</span>
                      <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-slate-800 text-blue-400">
                        {p.defaultKioskMode}
                      </span>
                    </div>

                    <p className="text-slate-400 text-xs">{p.description}</p>

                    <div className="pt-2 border-t border-slate-800/80 space-y-1 text-[11px] text-slate-400">
                      <div>Freigegebene Ansichten: <strong className="text-slate-300">{p.allowedViews.join(', ')}</strong></div>
                      <div>Auto-Logout: <strong className="text-slate-300">{p.autoLogoutMinutes > 0 ? `${p.autoLogoutMinutes} Minuten` : 'Deaktiviert'}</strong></div>
                      <div>Screenshot-Sperre: <strong className="text-emerald-400">{p.preventScreenCapture ? 'Aktiv (FLAG_SECURE)' : 'Aus'}</strong></div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                    {isCurrent ? (
                      <span className="text-[11px] text-emerald-400 font-bold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Aktives Profil
                      </span>
                    ) : (
                      <button
                        onClick={() => setActiveStationProfile(p.type)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition"
                      >
                        Auf dieser App anwenden
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Provisioning QR Payload */}
      {activeTab === 'provisioning_qr' && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 text-xs">
          <div className="border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">Android Enterprise & Apple MDM Bereitstellung</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Scannen Sie diesen QR-Code während des Werks-Einrichtungsassistenten (6x auf den Startbildschirm tippen), um das Gerät als <strong>Fully Managed Dedicated Device</strong> auszurollen.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Visual QR Simulator */}
            <div className="p-6 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center space-y-4">
              <div className="w-48 h-48 bg-white p-3 rounded-2xl shadow-xl flex items-center justify-center">
                <QrCode className="w-40 h-40 text-slate-900" />
              </div>
              <div className="text-center space-y-1">
                <span className="font-bold text-slate-200 block">Android Enterprise DPC Payload</span>
                <span className="text-[10px] text-slate-500 font-mono">DPC: de.securityops.mobile.dpc</span>
              </div>
            </div>

            {/* Config & Payload Inspector */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Ziel-Arbeitsplatzprofil</label>
                  <select
                    value={provisioningProfile}
                    onChange={(e) => setProvisioningProfile(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    {stationProfiles.map((p) => (
                      <option key={p.id} value={p.type}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Kiosk-Betriebsart</label>
                  <select
                    value={provisioningKioskMode}
                    onChange={(e) => setProvisioningKioskMode(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 font-mono"
                  >
                    <option value={KioskOperatingMode.SINGLE_APP}>Modus A: Einzel-App-Kiosk</option>
                    <option value={KioskOperatingMode.MULTI_APP}>Modus B: Mehr-App-Kiosk</option>
                    <option value={KioskOperatingMode.STANDARD}>Modus C: Normaler Betrieb</option>
                  </select>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  JSON Provisioning Payload (BSI TR-02102):
                </span>
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-blue-300 overflow-x-auto max-h-56">
                  <pre>{JSON.stringify(sampleProvisioningJson, null, 2)}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
