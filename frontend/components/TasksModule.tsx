import React, { useState } from 'react';
import { CheckSquare, Plus, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSecurityStore } from '../store';

export const TasksModule: React.FC = () => {
  const { tasks, toggleTaskStatus, addTask } = useSecurityStore();
  const [title, setTitle] = useState('');
  const [assignedToName, setAssignedToName] = useState('Alexander Schmidt');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    addTask({
      title,
      assignedToName,
      dueDate: new Date(Date.now() + 1000 * 3600 * 24 * 7).toISOString().split('T')[0],
      priority: 'Mittel',
      status: 'Offen',
      category: 'Audit'
    });

    setTitle('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Aufgaben- & Maßnahmenmanagement</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Wartungen, Nachschulungen, Kundenanforderungen und Audit-Fristen.
          </p>
        </div>
      </div>

      {/* Add Task Box */}
      <form onSubmit={handleAdd} className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Neue Aufgabe / Korrekturmaßnahme eingeben..."
          className="flex-1 bg-slate-800 text-xs text-slate-200 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          value={assignedToName}
          onChange={(e) => setAssignedToName(e.target.value)}
          placeholder="Verantwortlich"
          className="sm:w-48 bg-slate-800 text-xs text-slate-200 px-3 py-2 rounded-lg border border-slate-700"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow"
        >
          Aufgabe erstellen
        </button>
      </form>

      {/* Task List */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => toggleTaskStatus(task.id)}
            className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between transition"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={task.status === 'Erledigt'}
                onChange={() => {}}
                className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-blue-600 focus:ring-0"
              />
              <div>
                <span className={`text-xs font-semibold ${task.status === 'Erledigt' ? 'line-through text-slate-500' : 'text-slate-200'}`}>
                  {task.title}
                </span>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Verantwortlich: {task.assignedToName} • Frist: {task.dueDate} • Kategorie: {task.category}
                </div>
              </div>
            </div>

            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              task.status === 'Erledigt' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}>
              {task.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
