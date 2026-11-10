import React, { useState } from 'react';
import {
  Users,
  Award,
  AlertTriangle,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Phone,
  Mail,
  UserX
} from 'lucide-react';
import { store } from '../services/store';
import { Employee, Qualification } from '../types';

interface EmployeesModuleProps {
  globalSearch: string;
}

export const EmployeesModule: React.FC<EmployeesModuleProps> = ({ globalSearch }) => {
  const [showAddEmpModal, setShowAddEmpModal] = useState<boolean>(false);

  // New employee form
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('Sicherheitsmitarbeiter Werkschutz');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employmentType, setEmploymentType] = useState<Employee['employmentType']>('Vollzeit');
  const [has34a, setHas34a] = useState(true);

  const employees = store.employees.filter((emp) => {
    return (
      emp.firstName.toLowerCase().includes(globalSearch.toLowerCase()) ||
      emp.lastName.toLowerCase().includes(globalSearch.toLowerCase()) ||
      emp.personnelNumber.toLowerCase().includes(globalSearch.toLowerCase()) ||
      emp.role.toLowerCase().includes(globalSearch.toLowerCase())
    );
  });

  const handleCreateEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    const newQualifications: Qualification[] = has34a
      ? [
          {
            id: `q-${Date.now()}`,
            name: 'Sachkundeprüfung gem. § 34a GewO (IHK)',
            type: '34a_Sachkunde',
            issuer: 'IHK',
            issuedDate: '2023-01-01',
            expiryDate: '2033-01-01',
            isValid: true
          },
          {
            id: `q-${Date.now() + 1}`,
            name: 'Betrieblicher Ersthelfer (DGUV)',
            type: 'Erste_Hilfe',
            issuer: 'DRK',
            issuedDate: '2024-01-01',
            expiryDate: '2026-01-01',
            isValid: true
          }
        ]
      : [
          {
            id: `q-${Date.now()}`,
            name: 'Unterrichtungsnachweis § 34a GewO (IHK)',
            type: '34a_Unterrichtung',
            issuer: 'IHK',
            issuedDate: '2022-01-01',
            expiryDate: '2032-01-01',
            isValid: true
          }
        ];

    store.addEmployee({
      personnelNumber: `SEC-${Math.floor(1000 + Math.random() * 9000)}`,
      firstName,
      lastName,
      role,
      email,
      phone,
      status: 'Aktiv',
      employmentType,
      targetHours: employmentType === 'Vollzeit' ? 173 : 120,
      actualHoursMonth: 0,
      overtimeBalance: 0,
      qualifications: newQualifications
    });

    setShowAddEmpModal(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Mitarbeiterverwaltung & § 34a Nachweiskontrolle</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-brand-500/20 text-brand-200 font-mono">
              BewachV Konform
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Personalstamm, Sachkundeprüfung nach § 34a GewO, Brandschutz, Ersthelfer und lückenlose Fristenüberwachung.
          </p>
        </div>

        <button
          onClick={() => setShowAddEmpModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Mitarbeiter anlegen</span>
        </button>
      </div>

      {/* Grid of Employees */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {employees.map((emp) => {
          const hasInvalidCert = emp.qualifications.some((q) => !q.isValid);
          return (
            <div
              key={emp.id}
              className={`p-4 rounded-2xl bg-slate-900 border transition-all ${
                hasInvalidCert ? 'border-amber-500/60 shadow-lg shadow-amber-950/20' : 'border-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-sm">
                      {emp.firstName} {emp.lastName}
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-slate-800 text-slate-300">
                      {emp.personnelNumber}
                    </span>
                  </div>
                  <p className="text-xs text-brand-300 font-medium">{emp.role}</p>
                </div>

                <select
                  value={emp.status}
                  onChange={(e) =>
                    store.updateEmployeeStatus(emp.id, e.target.value as Employee['status'])
                  }
                  className={`text-[11px] px-2 py-1 rounded font-bold border focus:outline-none cursor-pointer ${
                    emp.status === 'Aktiv'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : emp.status === 'Urlaub'
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                      : 'bg-rose-950 text-rose-300 border-rose-800'
                  }`}
                >
                  <option value="Aktiv">Aktiv</option>
                  <option value="Urlaub">Urlaub</option>
                  <option value="Krank">Krank</option>
                  <option value="Freigestellt">Freigestellt</option>
                </select>
              </div>

              <div className="text-xs text-slate-400 space-y-1 my-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  <span>{emp.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  <span>{emp.phone}</span>
                </div>
                <div className="flex items-center justify-between pt-1 text-[11px] border-t border-slate-800 text-slate-300">
                  <span>
                    Stunden/Monat: <strong>{emp.actualHoursMonth}h</strong> / {emp.targetHours}h
                  </span>
                  <span>
                    Überstunden:{' '}
                    <strong className={emp.overtimeBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {emp.overtimeBalance > 0 ? `+${emp.overtimeBalance}` : emp.overtimeBalance}h
                    </strong>
                  </span>
                </div>
              </div>

              {/* Qualifications Badge List */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Nachweise & Qualifikationen:
                </span>
                {emp.qualifications.map((q) => (
                  <div
                    key={q.id}
                    className={`p-2 rounded-lg text-xs flex items-center justify-between border ${
                      q.isValid
                        ? 'bg-slate-950 border-slate-800 text-slate-200'
                        : 'bg-amber-950/50 border-amber-600/50 text-amber-200 animate-pulse'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Award
                        className={`w-3.5 h-3.5 shrink-0 ${q.isValid ? 'text-brand-400' : 'text-amber-400'}`}
                      />
                      <span className="truncate max-w-[180px] font-medium">{q.name}</span>
                    </div>
                    <span className="text-[10px] font-mono shrink-0">
                      {q.isValid ? `Gültig bis ${q.expiryDate}` : 'ABGELAUFEN!'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Employee Modal */}
      {showAddEmpModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEmployee}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neuen Sicherheitsmitarbeiter anlegen</h3>
              <button
                type="button"
                onClick={() => setShowAddEmpModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Vorname</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Nachname</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Funktion / Rolle</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
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
              <label className="block text-slate-400 mb-1">Anstellungsart</label>
              <select
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as Employee['employmentType'])}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              >
                <option value="Vollzeit">Vollzeit (173h/Monat)</option>
                <option value="Teilzeit">Teilzeit (120h/Monat)</option>
                <option value="Minijob">Minijob (538€ Basis)</option>
                <option value="Subunternehmer">Subunternehmer</option>
              </select>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center gap-2">
              <input
                type="checkbox"
                id="quali34a"
                checked={has34a}
                onChange={(e) => setHas34a(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-brand-500"
              />
              <label htmlFor="quali34a" className="text-slate-200 cursor-pointer">
                IHK-Sachkundeprüfung gem. § 34a GewO liegt vollständig vor
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowAddEmpModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-500"
              >
                Mitarbeiter speichern
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
