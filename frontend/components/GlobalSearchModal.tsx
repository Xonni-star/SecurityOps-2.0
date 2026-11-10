import React, { useState, useEffect } from 'react';
import { Search, X, ArrowRight, Building, MapPin, Users, BookOpen, Key, CheckSquare, FileText } from 'lucide-react';
import { useSecurityStore } from '../store';
import { GlobalSearchResult } from '../types';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const { performGlobalSearch, setActiveTab } = useSecurityStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);

  useEffect(() => {
    if (query.trim().length >= 2) {
      setResults(performGlobalSearch(query));
    } else {
      setResults([]);
    }
  }, [query, performGlobalSearch]);

  if (!isOpen) return null;

  const handleSelectResult = (targetTab: string) => {
    setActiveTab(targetTab);
    onClose();
    setQuery('');
  };

  const getCategoryIcon = (cat: GlobalSearchResult['category']) => {
    switch (cat) {
      case 'Kunde': return <Building className="w-4 h-4 text-blue-400" />;
      case 'Objekt': return <MapPin className="w-4 h-4 text-indigo-400" />;
      case 'Mitarbeiter': return <Users className="w-4 h-4 text-emerald-400" />;
      case 'Wachbuch': return <BookOpen className="w-4 h-4 text-amber-400" />;
      case 'Schlüssel': return <Key className="w-4 h-4 text-cyan-400" />;
      case 'Aufgabe': return <CheckSquare className="w-4 h-4 text-purple-400" />;
      case 'Dokument': return <FileText className="w-4 h-4 text-rose-400" />;
      default: return <Search className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-20">
      <div className="bg-[#0b1329] border border-slate-700 rounded-2xl max-w-2xl w-full flex flex-col shadow-2xl overflow-hidden ring-1 ring-white/10">
        {/* Search Header */}
        <div className="p-4 border-b border-slate-800 flex items-center gap-3 bg-[#0f172a]">
          <Search className="w-5 h-5 text-blue-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Globale Suche über Kunden, Objekte, Mitarbeiter, Wachbuch, Schlüssel & Dokumente..."
            className="w-full bg-transparent text-sm text-slate-100 focus:outline-none placeholder:text-slate-500 font-medium"
          />
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-3 space-y-1 text-xs">
          {query.trim().length < 2 ? (
            <div className="p-6 text-center text-slate-500 text-xs">
              Tippen Sie mindestens 2 Zeichen ein, um systemweit zu suchen...
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-xs">
              Keine Treffer für &bdquo;{query}&ldquo; im aktuellen Mandanten gefunden.
            </div>
          ) : (
            results.map((res) => (
              <div
                key={`${res.category}-${res.id}`}
                onClick={() => handleSelectResult(res.targetTab)}
                className="p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 cursor-pointer flex items-center justify-between transition group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-800/90 shrink-0">
                    {getCategoryIcon(res.category)}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-200 group-hover:text-blue-400 transition-colors">
                      {res.title}
                    </div>
                    <div className="text-[11px] text-slate-400">{res.subtitle}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                    {res.category}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition" />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-3 border-t border-slate-800 bg-[#0a0f1d] flex items-center justify-between text-[11px] text-slate-500">
          <span>Tastaturkürzel: <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">ESC</kbd> zum Schließen</span>
          <span>{results.length} Treffer im aktuellen Mandanten</span>
        </div>
      </div>
    </div>
  );
};
