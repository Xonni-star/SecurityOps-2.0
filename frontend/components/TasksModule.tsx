import React, { useState } from 'react';
import { CheckSquare2, Plus, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { store } from '../services/store';
import { OperationalTask } from '../types';

export const TasksModule: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [title, setTitle] = useState('');
  const [siteName, setSiteName] = useState('Logistikzentrum Nord & Hochregallager');
  const [assignedTo, setAssignedTo] = useState('Timo Kranz');
  const [dueDate, setDueDate] = useState('2025-05-20');
  const [priority, setPriority] = useState<OperationalTask['priority']>('Normal');
  const [category, setCategory] = useState<OperationalTask['category']>('Audit');

  const tasks = store.tasks;

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    store.addTask({
      title,
      siteName,
      assignedTo,
      dueDate,
      priority,
      status: 'Offen',
      category
    });
    setShowAddModal(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare2 className="w-5 h-5 text-brand-400" />
            <h2 className="text-base font-bold text-white">Aufgaben- & Maßnahmenmanagement</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Nachbearbeitung von Sicherheitsaudits, Kundenanforderungen und wiederkehrenden Prüfungen.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shadow-brand-900/40"
        >
          <Plus className="w-4 h-4" />
          <span>Aufgabe erstellen</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    task.priority === 'Dringend'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-blue-500/20 text-blue-300'
                  }`}
                >
                  {task.priority}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">Frist: {task.dueDate}</span>
              </div>
              <h3 className="font-bold text-white text-sm mb-1">{task.title}</h3>
              <p className="text-xs text-slate-400">{task.siteName}</p>
              <p className="text-xs text-brand-300 mt-1">Verantwortlich: {task.assignedTo}</p>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400">Status: {task.status}</span>
              <button
                onClick={() =>
                  store.updateTaskStatus(
                    task.id,
                    task.status === 'Erledigt' ? 'In Bearbeitung' : 'Erledigt'
                  )
                }
                className={`text-xs px-2.5 py-1 rounded font-semibold ${
                  task.status === 'Erledigt'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {task.status === 'Erledigt' ? '✓ Erledigt' : 'Als erledigt markieren'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateTask}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Neue Aufgabe / Maßnahme zuweisen</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Aufgabentitel</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Verantwortlicher</label>
                <input
                  type="text"
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Frist / Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Priorität</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Dringend">Dringend</option>
                  <option value="Normal">Normal</option>
                  <option value="Niedrig">Niedrig</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Kategorie</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  <option value="Audit">Audit</option>
                  <option value="Wartung">Wartung</option>
                  <option value="Schulung">Schulung</option>
                  <option value="Kundenanforderung">Kundenanforderung</option>
                </select>
              </div>
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
                Aufgabe anlegen
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
