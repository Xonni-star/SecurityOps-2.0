import React, { useState } from 'react';
import {
  Users,
  Plus,
  ShieldCheck,
  Award,
  AlertTriangle,
  FileCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Search
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { Employee, QualificationType, UserRole } from '../types';

export const EmployeesModule: React.FC = () => {
  const { employees, addEmployee, updateEmployee } = useSecurityStore();
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.GUARD);
  const [hourlyRate, setHourlyRate] = useState(18.50);
  const [weeklyHours, setWeeklyHours] = useState(40);
  const [primaryQual, setPrimaryQual] = useState<QualificationType>(QualificationType.GEWO_34A_SACHKUNDE);

  const filteredEmployees = employees.filter((e) =>
    `${e.firstName} ${e.lastName} ${e.personnelNumber}`.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const newEmp: Omit<Employee, 'id'> = {
      personnelNumber: `MA-${Math.floor(1000 + Math.random() * 9000)}`,
      firstName,
      lastName,
      email,
      phone,
      role,
      status: 'Aktiv',
      weeklyHours,
      hourlyRate,
      dateOfJoining: new Date().toISOString().split('T')[0],
      assignedSiteIds: [],
      qualifications: [
        {
          id: `q-${Date.now()}`,
          type: primaryQual,
          issueDate: new Date().toISOString().split('T')[0],
          expiryDate: new Date(Date.now() + 1000 * 3600 * 24 * 365 * 5).toISOString().split('T')[0],
          certificateNumber: `IHK-CERT-${Math.floor(1000 + Math.random() * 9000)}`,
          verified: true
        }
      ]
    };

    addEmployee(newEmp);
    setIsModalOpen(false);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Mitarbeiterverwaltung & § 34a GewO Qualifikationen</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Personalstammdaten, lückenlose Nachweisführung für das Bewacherregister und Fortbildungsüberwachung.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Mitarbeiter anlegen</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md w-full">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Nach Name oder Personalnummer suchen..."
          className="w-full bg-slate-900 text-xs text-slate-200 pl-9 pr-3 py-2 rounded-xl border border-slate-800 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Employee Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredEmployees.map((emp) => (
          <div
            key={emp.id}
            className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between shadow-sm"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-200 text-sm">{emp.firstName} {emp.lastName}</h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                      {emp.personnelNumber}
                    </span>
                  </div>
                  <p className="text-xs text-blue-400 font-medium mt-0.5">{emp.role}</p>
                </div>

                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  emp.status === 'Aktiv'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : emp.status === 'Krank'
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                }`}>
                  {emp.status}
                </span>
              </div>

              <div className="mt-3 space-y-1 text-xs text-slate-400">
                <div>E-Mail: <span className="text-slate-300">{emp.email}</span></div>
                <div>Telefon: <span className="text-slate-300">{emp.phone}</span></div>
                <div>Vertrag: <span className="text-slate-300">{emp.weeklyHours}h / Woche ({emp.hourlyRate} €/h)</span></div>
              </div>

              {/* Qualifications list */}
              <div className="mt-4 pt-3 border-t border-slate-800/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-2">
                  Qualifikationen & Nachweise:
                </span>
                <div className="space-y-1.5">
                  {emp.qualifications.map((q) => {
                    const isExpiring = new Date(q.expiryDate).getTime() < Date.now();
                    return (
                      <div
                        key={q.id}
                        className="p-2 rounded-lg bg-slate-800/40 border border-slate-800 flex items-center justify-between text-[11px]"
                      >
                        <div className="truncate pr-2">
                          <span className="font-medium text-slate-300 block truncate">{q.type}</span>
                          <span className="text-[10px] text-slate-500 font-mono">Gültig bis: {q.expiryDate}</span>
                        </div>

                        {isExpiring ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 text-[10px] font-bold">
                            Abgelaufen
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                            Gültig
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
              <span className="text-slate-500 text-[11px]">Eintritt: {emp.dateOfJoining}</span>
              <button
                onClick={() => {
                  const newStatus = emp.status === 'Aktiv' ? 'Krank' : 'Aktiv';
                  updateEmployee(emp.id, { status: newStatus as any });
                }}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Status ändern
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Add Employee */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Neue Wachkraft anlegen</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Vorname *</label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Nachname *</label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">E-Mail *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Telefon</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Rolle</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    {Object.values(UserRole).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">GewO Nachweis</label>
                  <select
                    value={primaryQual}
                    onChange={(e) => setPrimaryQual(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value={QualificationType.GEWO_34A_SACHKUNDE}>Sachkundeprüfung § 34a</option>
                    <option value={QualificationType.GEWO_34A_UNTERRICHTUNG}>Unterrichtung § 34a</option>
                    <option value={QualificationType.FIRST_AID}>Betrieblicher Ersthelfer</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  Mitarbeiter speichern
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
