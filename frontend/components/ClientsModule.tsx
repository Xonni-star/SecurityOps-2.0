import React, { useState } from 'react';
import { Building2, Plus, Phone, Mail, FileText, CheckCircle2 } from 'lucide-react';
import { store } from '../services/store';

export const ClientsModule: React.FC = () => {
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [slaLevel, setSlaLevel] = useState<'Gold (24/7 Intervention)' | 'Silber (Werkschutz)' | 'Bronze (Revierdienst)'>('Gold (24/7 Intervention)');
  const [monthlyRevenue, setMonthlyRevenue] = useState(25000);

  const clients = store.clients;

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    store.addClient({
      customerNumber: `KD-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`,
      name,
      industry,
      contactPerson,
      email,
      phone,
      address,
      contractStart: '2025-01-01',
      contractEnd: '2027-12-31',
      slaLevel,
      billingStatus: 'Aktiv',
      assignedSitesCount: 1,
      monthlyRevenue: Number(monthlyRevenue)
    });
    setShowAddClientModal(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Kundenverwaltung & Dienstleistungsverträge</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Auftraggeberstammdaten, SLA-Vereinbarungen, Vertragslaufzeiten und zugewiesene Objekte.
          </p>
        </div>

        <button
          onClick={() => setShowAddClientModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Kunde anlegen</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {clients.map((cli) => (
          <div
            key={cli.id}
            className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  {cli.customerNumber}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-300">
                  {cli.billingStatus}
                </span>
              </div>

              <h3 className="font-bold text-white text-base mb-1">{cli.name}</h3>
              <p className="text-xs text-brand-300 mb-3">{cli.industry}</p>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs space-y-1.5 mb-3">
                <p className="text-white font-medium">Ansprechpartner: {cli.contactPerson}</p>
                <div className="flex items-center gap-2 text-slate-400">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span>{cli.email}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  <span>{cli.phone}</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/60 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">SLA-Stufe:</span>
                  <span className="font-semibold text-emerald-400">{cli.slaLevel}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Vertragslaufzeit:</span>
                  <span className="font-mono">{cli.contractStart} bis {cli.contractEnd}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <span className="text-slate-400">Umsatz/Monat:</span>
              <span className="font-mono font-bold text-white text-sm">
                {cli.monthlyRevenue.toLocaleString('de-DE')} €
              </span>
            </div>
          </div>
        ))}
      </div>

      {showAddClientModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateClient}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neuen Kundenstamm anlegen</h3>
              <button
                type="button"
                onClick={() => setShowAddClientModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Unternehmensname</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Branche</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Ansprechpartner</label>
                <input
                  type="text"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Monatsvolumen (€)</label>
                <input
                  type="number"
                  value={monthlyRevenue}
                  onChange={(e) => setMonthlyRevenue(Number(e.target.value))}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">E-Mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Telefon</label>
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
              <label className="block text-slate-400 mb-1">SLA-Klasse</label>
              <select
                value={slaLevel}
                onChange={(e) => setSlaLevel(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="Gold (24/7 Intervention)">Gold (24/7 Intervention & Werkschutz)</option>
                <option value="Silber (Werkschutz)">Silber (Werkschutz & Pforte)</option>
                <option value="Bronze (Revierdienst)">Bronze (Revier- und Streifendienst)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddClientModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
              >
                Kunde anlegen
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
