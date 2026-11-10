import React, { useState } from 'react';
import {
  Building,
  Plus,
  ShieldCheck,
  Database,
  Lock,
  CheckCircle2,
  FileText,
  Users,
  AlertCircle
} from 'lucide-react';
import { store } from '../services/store';
import { Tenant } from '../types';

export const TenantModule: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [companyRegistrationNumber, setCompanyRegistrationNumber] = useState('');
  const [address, setAddress] = useState('');
  const [primaryContact, setPrimaryContact] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dinCert, setDinCert] = useState('TÜV-DIN77200-2025-DE');
  const [licenseLevel, setLicenseLevel] = useState<Tenant['licenseLevel']>('Enterprise Tier 1');
  const [maxGuards, setMaxGuards] = useState(100);

  const tenants = store.tenants;
  const activeTenant = store.getActiveTenant();

  const handleCreateTenant = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = (code || name.substring(0, 5)).toUpperCase().replace(/[^A-Z0-9]/g, '');
    store.addTenant({
      code: cleanCode,
      name,
      companyRegistrationNumber,
      address,
      primaryContact,
      email,
      phone,
      din77200CertificateNumber: dinCert,
      licenseLevel,
      activeModules: ['mod-core', 'mod-wachbuch', 'mod-schedule'],
      maxGuards: Number(maxGuards),
      dataStorageRegion: 'eu-central-1 (Frankfurt)',
      rlsSchemaName: `tenant_${cleanCode.toLowerCase()}_sec`
    });
    setShowAddModal(false);
    setCode('');
    setName('');
    setEmail('');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Mandantenverwaltung & Strikte Datenisolierung</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-200 font-mono">
              PostgreSQL Row Level Security (RLS)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Vollständige logische und datenbankbasierte Trennung nach DSGVO Art. 32 für mehrere Sicherheitsunternehmen.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Neuen Mandanten anlegen</span>
        </button>
      </div>

      {/* RLS Architecture Explainer Banner */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs space-y-2">
        <div className="flex items-center gap-2 text-emerald-400 font-bold">
          <Lock className="w-4 h-4" />
          <span>Multi-Tenant Sicherheitsgarantie auf Datenbankebene</span>
        </div>
        <p className="text-slate-300 leading-relaxed">
          Jede SQL-Abfrage wird über den FastAPI Context-Middleware-Filter mit <code className="bg-slate-950 px-1.5 py-0.5 rounded text-brand-300 font-mono">SET LOCAL app.current_tenant_id = &apos;{activeTenant.id}&apos;</code> abgesichert. Es ist technisch ausgeschlossen, dass Mitarbeiter von Mandant A Einblick in Wachbücher, Schichtpläne oder Kunden von Mandant B erhalten.
        </p>
      </div>

      {/* Tenant Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tenants.map((t) => {
          const isCurrent = t.id === store.activeTenantId;
          const tenantGuardsCount = store.employees.filter((e) => e.tenantId === t.id).length;
          const tenantSitesCount = store.sites.filter((s) => s.tenantId === t.id).length;
          const tenantIncidentsCount = store.incidents.filter((i) => i.tenantId === t.id).length;

          return (
            <div
              key={t.id}
              className={`p-5 rounded-2xl bg-slate-900 border transition-all ${
                isCurrent ? 'border-brand-500 shadow-lg shadow-brand-950/40 ring-1 ring-brand-500/40' : 'border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-950 text-brand-300 border border-slate-800">
                    {t.code}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                    {t.licenseLevel}
                  </span>
                </div>
                {isCurrent ? (
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Aktiv ausgewählt
                  </span>
                ) : (
                  <button
                    onClick={() => store.setActiveTenantId(t.id)}
                    className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  >
                    Als Arbeitsbereich wählen
                  </button>
                )}
              </div>

              <h3 className="font-bold text-white text-base mb-1">{t.name}</h3>
              <p className="text-xs text-slate-400 mb-3">{t.address}</p>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1.5 mb-3 font-mono">
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">Handelsregister:</span>
                  <span>{t.companyRegistrationNumber}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">DIN 77200 Zertifikat:</span>
                  <span className="text-emerald-400">{t.din77200CertificateNumber}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">PostgreSQL RLS-Schema:</span>
                  <span className="text-cyan-400">{t.rlsSchemaName}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="text-slate-500">Hosting & Backup-Region:</span>
                  <span>{t.dataStorageRegion}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2 border-t border-slate-800">
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="font-bold text-white block text-sm">{tenantGuardsCount}</span>
                  <span className="text-[10px] text-slate-400">Mitarbeiter ({t.maxGuards} max)</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="font-bold text-white block text-sm">{tenantSitesCount}</span>
                  <span className="text-[10px] text-slate-400">Objekte</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="font-bold text-white block text-sm">{tenantIncidentsCount}</span>
                  <span className="text-[10px] text-slate-400">Wachbucheinträge</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Tenant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTenant}
            className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neuen Sicherheitsdienst-Mandanten anlegen</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Mandanten-Kürzel</label>
                <input
                  type="text"
                  placeholder="z.B. SECU-BER"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 uppercase"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Lizenzklasse</label>
                <select
                  value={licenseLevel}
                  onChange={(e) => setLicenseLevel(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Enterprise Tier 1">Enterprise Tier 1</option>
                  <option value="Professional Tier 2">Professional Tier 2</option>
                  <option value="Standard Tier 3">Standard Tier 3</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Vollständiger Firmenname</label>
              <input
                type="text"
                placeholder="z.B. Berlin Wach- und Werkschutz GmbH"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Handelsregisternummer</label>
                <input
                  type="text"
                  placeholder="HRB 123456"
                  value={companyRegistrationNumber}
                  onChange={(e) => setCompanyRegistrationNumber(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Max. Wachpersonal</label>
                <input
                  type="number"
                  value={maxGuards}
                  onChange={(e) => setMaxGuards(Number(e.target.value))}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Leitstand E-Mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">24/7 Notruf-Telefon</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Firmensitz Anschrift</label>
              <input
                type="text"
                placeholder="Straße, PLZ Ort"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
              >
                Mandant mit RLS-Isolation anlegen
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
