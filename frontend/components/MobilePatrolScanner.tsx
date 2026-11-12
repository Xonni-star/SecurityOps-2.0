import React, { useState, useRef } from 'react';
import {
  Radio,
  QrCode,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MapPin,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  VideoOff
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Checkpoint, Site } from '../types';

export const MobilePatrolScanner: React.FC = () => {
  const {
    getTenantSites,
    getTenantPatrolScans,
    addPatrolScan,
    currentUserId,
    currentUserName,
    isOnline
  } = useSecurityStore();

  const sites = getTenantSites();
  const scans = getTenantPatrolScans();
  const activeSite = sites[0];

  const [selectedMethod, setSelectedMethod] = useState<'QR_CODE' | 'NFC_TAG' | 'MANUELL'>('MANUELL');
  const [activeCheckpoint, setActiveCheckpoint] = useState<Checkpoint>(activeSite?.checkpoints[0] || {} as Checkpoint);
  const [scanSuccessMessage, setScanSuccessMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const startCamera = async () => {
    try {
      setCameraActive(true);
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch (err) {
      console.warn('Camera could not be accessed, fallback to simulated scan:', err);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
    }
    setCameraActive(false);
  };

  const handleExecuteScan = async (checkpoint: Checkpoint) => {
    // Anti-duplicate protection: check if same checkpoint was scanned in last 2 minutes
    const lastScan = scans.find((s) => s.checkpointId === checkpoint.id);
    if (lastScan) {
      const diffMs = Date.now() - new Date(lastScan.scannedAt).getTime();
      if (diffMs < 2 * 60 * 1000) {
        alert(`Achtung: Kontrollpunkt ${checkpoint.code} wurde bereits vor weniger als 2 Minuten abgetastet!`);
      }
    }

    try {
    await addPatrolScan({
      siteId: activeSite.id,
      siteName: activeSite.name,
      checkpointId: checkpoint.id,
      checkpointCode: checkpoint.code,
      checkpointName: checkpoint.name,
      guardId: currentUserId,
      guardName: currentUserName,
      method: selectedMethod,
      verifiedTag: checkpoint.rfidTag,
      notes: notes || 'Regulärer Kontrollgang-Scan'
    });

    setScanSuccessMessage(`Kontrollpunkt ${checkpoint.code} lokal erfasst${isOnline ? ' – Serverbestätigung steht aus' : ' – offline, Synchronisierung steht aus'}.`);
    setNotes('');
    stopCamera();

    setTimeout(() => {
      setScanSuccessMessage(null);
    }, 3500);
    } catch {
      alert('Kontrollpunkt konnte nicht sicher lokal gespeichert werden. Bitte erneut versuchen.');
    }
  };

  return (
    <div className="space-y-4 pb-20 text-xs">
      {/* Site Header */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div>
          <span className="text-[10px] text-blue-400 font-mono font-bold block">{activeSite?.siteCode}</span>
          <h2 className="text-sm font-bold text-white">{activeSite?.name}</h2>
          <span className="text-slate-400 text-[11px]">{activeSite?.checkpoints?.length} Kontrollpunkte im Umlauf</span>
        </div>
        <div className="p-2 rounded-xl bg-blue-600/10 text-blue-400">
          <Radio className="w-5 h-5 animate-pulse" />
        </div>
      </div>

      {/* Feedback Banner */}
      {scanSuccessMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{scanSuccessMessage}</span>
        </div>
      )}

      {/* Scan Method Switcher */}
      <div className="grid grid-cols-3 gap-2">
        <button
          disabled
          title="QR-Decodierung ist derzeit nicht implementiert"
          className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
            selectedMethod === 'QR_CODE'
              ? 'bg-blue-600/20 border-blue-500 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <QrCode className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-[11px]">QR (nicht verfügbar)</span>
        </button>

        <button
          disabled
          title="NFC-Lesen ist derzeit nicht implementiert"
          className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
            selectedMethod === 'NFC_TAG'
              ? 'bg-blue-600/20 border-blue-500 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <Radio className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-[11px]">NFC (nicht verfügbar)</span>
        </button>

        <button
          onClick={() => { setSelectedMethod('MANUELL'); stopCamera(); }}
          className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 transition ${
            selectedMethod === 'MANUELL'
              ? 'bg-blue-600/20 border-blue-500 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-400'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-amber-400" />
          <span className="font-semibold text-[11px]">Manuell</span>
        </button>
      </div>

      {/* Live Camera Scanner Box */}
      {cameraActive && (
        <div className="relative rounded-2xl overflow-hidden bg-black border border-blue-500/40 aspect-video flex items-center justify-center">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          <div className="absolute inset-0 border-2 border-dashed border-blue-400/60 m-8 rounded-xl pointer-events-none flex items-center justify-center">
            <span className="px-2 py-1 rounded bg-black/60 text-blue-300 text-[10px] font-mono">
              QR-Code im Rahmen zentrieren
            </span>
          </div>
          <button
            onClick={stopCamera}
            className="absolute top-2 right-2 px-2 py-1 rounded bg-slate-900/80 text-white text-[10px] font-semibold"
          >
            Kamera schließen
          </button>
        </div>
      )}

      {/* Checkpoints to Scan */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 className="font-bold text-slate-200">Kontrollpunkte für aktuellen Rundgang:</h3>

        <div className="space-y-2">
          {activeSite?.checkpoints?.map((cp) => {
            const hasRecentScan = scans.some((s) => s.checkpointId === cp.id);
            return (
              <div
                key={cp.id}
                className="p-3 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">{cp.code}</span>
                    <span className="text-slate-300">{cp.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{cp.locationDetails}</div>
                </div>

                <div className="flex items-center gap-2">
                  {hasRecentScan ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                      ✓ Abgetastet
                    </span>
                  ) : (
                    <button
                      onClick={() => handleExecuteScan(cp)}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow"
                    >
                      Jetzt Scannen
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Security Disclaimer */}
      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
        <span className="font-semibold text-slate-300 block flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          Sicherheitsnachweis nach DIN 77200:
        </span>
        <p>
          QR-Codes können theoretisch abfotografiert werden. Bei KRITIS-Objekten ist zusätzlich die Verifikation über NFC-Wandtransponder oder Leitstellen-Rückruf vorgeschrieben.
        </p>
      </div>
    </div>
  );
};
