import React, { useState } from 'react';
import {
  FileText,
  Plus,
  Search,
  Filter,
  Download,
  Trash2,
  Paperclip,
  Building,
  MapPin,
  Users,
  ShieldAlert,
  FileCheck
} from 'lucide-react';
import { useSecurityStore } from '../store';
import { ManagedDocument } from '../types';

export const DocumentsModule: React.FC = () => {
  const {
    getTenantDocuments,
    getTenantClients,
    getTenantSites,
    getTenantEmployees,
    getTenantGuardBook,
    addDocument,
    deleteDocument
  } = useSecurityStore();

  const documents = getTenantDocuments();
  const clients = getTenantClients();
  const sites = getTenantSites();
  const employees = getTenantEmployees();
  const guardBook = getTenantGuardBook();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Form states
  const [docTitle, setDocTitle] = useState('');
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState<ManagedDocument['category']>('Vertrag');
  const [linkedEntityType, setLinkedEntityType] = useState<ManagedDocument['linkedEntityType']>('general');
  const [linkedEntityId, setLinkedEntityId] = useState('');

  const filteredDocs = documents.filter((doc) => {
    const matchesCat = categoryFilter === 'ALL' || doc.category === categoryFilter;
    const matchesQuery =
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.fileName.toLowerCase().includes(search.toLowerCase()) ||
      (doc.linkedEntityName && doc.linkedEntityName.toLowerCase().includes(search.toLowerCase()));
    return matchesCat && matchesQuery;
  });

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let entityName = 'Allgemein';
    if (linkedEntityType === 'customer') {
      const c = clients.find((x) => x.id === linkedEntityId);
      if (c) entityName = c.companyName;
    } else if (linkedEntityType === 'site') {
      const s = sites.find((x) => x.id === linkedEntityId);
      if (s) entityName = s.name;
    } else if (linkedEntityType === 'employee') {
      const em = employees.find((x) => x.id === linkedEntityId);
      if (em) entityName = `${em.firstName} ${em.lastName}`;
    } else if (linkedEntityType === 'incident') {
      const gb = guardBook.find((x) => x.id === linkedEntityId);
      if (gb) entityName = gb.title;
    }

    addDocument({
      title: docTitle,
      fileName: fileName || `${docTitle.toLowerCase().replace(/\s+/g, '_')}.pdf`,
      category,
      sizeBytes: Math.floor(1000000 + Math.random() * 4000000),
      version: '1.0',
      linkedEntityType,
      linkedEntityId: linkedEntityId || undefined,
      linkedEntityName: entityName
    });

    setIsUploadModalOpen(false);
    setDocTitle('');
    setFileName('');
    setLinkedEntityId('');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1000000) return `${(bytes / 1000000).toFixed(1)} MB`;
    return `${Math.round(bytes / 1000)} KB`;
  };

  const getEntityIcon = (type: ManagedDocument['linkedEntityType']) => {
    switch (type) {
      case 'customer':
        return <Building className="w-3.5 h-3.5 text-blue-400" />;
      case 'site':
        return <MapPin className="w-3.5 h-3.5 text-indigo-400" />;
      case 'employee':
        return <Users className="w-3.5 h-3.5 text-emerald-400" />;
      case 'incident':
        return <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold text-white">Zentrales Dokumentenmanagement (DMS)</h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Revisionssichere Ablage mit polymorpher Zuordnung zu Kunden, Objekten, Personalakten und Vorfallsberichten.
          </p>
        </div>

        <button
          onClick={() => setIsUploadModalOpen(true)}
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/20 transition flex items-center gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Dokument hochladen</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs">
        <div className="relative w-full sm:flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Dokumententitel, Dateiname oder Verknüpfung suchen..."
            className="w-full bg-slate-800 text-slate-200 pl-9 pr-3 py-2 rounded-lg border border-slate-700 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full sm:w-auto bg-slate-800 text-slate-200 px-3 py-2 rounded-lg border border-slate-700 focus:outline-none"
          >
            <option value="ALL">Alle Kategorien</option>
            <option value="Vertrag">Verträge</option>
            <option value="Dienstanweisung">Dienstanweisungen</option>
            <option value="Personalakte">Personalakten / Nachweise</option>
            <option value="Vorfallsbericht">Vorfallsberichte</option>
            <option value="Auditnachweis">Auditnachweise</option>
          </select>
        </div>
      </div>

      {/* Document Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDocs.length === 0 ? (
          <div className="col-span-full p-8 text-center bg-slate-900/50 rounded-xl border border-slate-800 text-slate-400 text-xs">
            Keine Dokumente für diese Filterkriterien hinterlegt.
          </div>
        ) : (
          filteredDocs.map((doc) => (
            <div
              key={doc.id}
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between shadow-sm"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {doc.category}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">v{doc.version}</span>
                </div>

                <h3 className="font-bold text-slate-200 text-sm mt-3 line-clamp-2">{doc.title}</h3>
                <p className="text-[11px] font-mono text-slate-400 mt-1 truncate">{doc.fileName}</p>

                {doc.linkedEntityName && (
                  <div className="mt-3 p-2.5 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center gap-2 text-xs">
                    {getEntityIcon(doc.linkedEntityType)}
                    <span className="truncate text-slate-300">{doc.linkedEntityName}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                <span>{formatFileSize(doc.sizeBytes)} • {doc.uploadedAt}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => alert(`Herunterladen von "${doc.fileName}" gestartet.`)}
                    className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition"
                    title="Herunterladen"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Dokument "${doc.title}" unwiderruflich löschen?`)) {
                        deleteDocument(doc.id);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
                    title="Löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Neues Dokument hinterlegen</h3>
              <button onClick={() => setIsUploadModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Dokumententitel *</label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="z. B. Bewachungsvertrag Nachtrag 2025"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Kategorie</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Vertrag">Vertrag</option>
                    <option value="Dienstanweisung">Dienstanweisung</option>
                    <option value="Personalakte">Personalakte</option>
                    <option value="Vorfallsbericht">Vorfallsbericht</option>
                    <option value="Auditnachweis">Auditnachweis</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Dateiname</label>
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="z. B. vertrag_2025.pdf"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Polymorphe Zuordnung</label>
                  <select
                    value={linkedEntityType}
                    onChange={(e) => {
                      setLinkedEntityType(e.target.value as any);
                      setLinkedEntityId('');
                    }}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="general">Allgemeines Dokument</option>
                    <option value="customer">Kunde</option>
                    <option value="site">Sicherheitsobjekt</option>
                    <option value="employee">Mitarbeiter</option>
                    <option value="incident">Wachbuch-Vorfall</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Konkreter Bezug</label>
                  <select
                    value={linkedEntityId}
                    onChange={(e) => setLinkedEntityId(e.target.value)}
                    disabled={linkedEntityType === 'general'}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-200 disabled:opacity-40"
                  >
                    <option value="">Auswählen...</option>
                    {linkedEntityType === 'customer' && clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.companyName}</option>
                    ))}
                    {linkedEntityType === 'site' && sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    {linkedEntityType === 'employee' && employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                    ))}
                    {linkedEntityType === 'incident' && guardBook.map((g) => (
                      <option key={g.id} value={g.id}>{g.title.slice(0, 35)}...</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                >
                  Hochladen & Verknüpfen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
