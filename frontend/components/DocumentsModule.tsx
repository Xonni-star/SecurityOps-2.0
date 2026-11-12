import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowLeft, ChevronRight, Download, Eye, FileText, Folder, FolderPlus,
  History, Pencil, Plus, RotateCcw, Search, Tag, Upload, X
} from 'lucide-react';
import { apiClient } from '../services/apiClient';
import { mapDmsDocumentRow, useSecurityStore } from '../store';
import { ManagedDocument } from '../types';

interface DocumentCategory {
  id: string;
  name: string;
  description?: string;
  is_archived: boolean;
}

interface DocumentFolder {
  id: string;
  parent_id: string | null;
  name: string;
  is_archived: boolean;
  document_count: number;
}

interface DocumentVersion {
  id: string;
  version_number: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  scan_status: string;
  created_at: string;
  created_by: string;
  restored_from_version?: number;
}

const fieldClass = 'w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';

function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function dateLabel(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('de-DE');
}

function relationshipTitle(document: ManagedDocument): string {
  if (document.linkedEntityType === 'general') return 'Allgemein';
  return document.linkedEntityName || document.linkedEntityType;
}

export const DocumentsModule: React.FC = () => {
  const documents = useSecurityStore((state) => state.documents);
  const setDocuments = useSecurityStore((state) => state.setDocuments);
  const authUser = useSecurityStore((state) => state.authUser);
  const allClients = useSecurityStore((state) => state.clients);
  const allSites = useSecurityStore((state) => state.sites);
  const allEmployees = useSecurityStore((state) => state.employees);
  const allIncidents = useSecurityStore((state) => state.guardBook);
  const allShifts = useSecurityStore((state) => state.shifts);
  const tenantId = authUser?.tenantId;
  const clients = useMemo(() => allClients.filter((item) => item.tenantId === tenantId), [allClients, tenantId]);
  const sites = useMemo(() => allSites.filter((item) => item.tenantId === tenantId), [allSites, tenantId]);
  const employees = useMemo(() => allEmployees.filter((item) => item.tenantId === tenantId), [allEmployees, tenantId]);
  const incidents = useMemo(() => allIncidents.filter((item) => item.tenantId === tenantId), [allIncidents, tenantId]);
  const shifts = useMemo(() => allShifts.filter((item) => item.tenantId === tenantId), [allShifts, tenantId]);

  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [archivedDocuments, setArchivedDocuments] = useState<ManagedDocument[]>([]);
  const [archivedView, setArchivedView] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'updated_at' | 'title' | 'created_at' | 'valid_until'>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFolder, setUploadFolder] = useState('');
  const [relationshipType, setRelationshipType] = useState('');
  const [relationshipId, setRelationshipId] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [editingDocument, setEditingDocument] = useState<ManagedDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editStatus, setEditStatus] = useState('Entwurf');
  const [editValidFrom, setEditValidFrom] = useState('');
  const [editValidUntil, setEditValidUntil] = useState('');
  const [editDocumentNumber, setEditDocumentNumber] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editRelationshipType, setEditRelationshipType] = useState('');
  const [editRelationshipId, setEditRelationshipId] = useState('');
  const [versionsDocument, setVersionsDocument] = useState<ManagedDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState('');
  const [preview, setPreview] = useState<{ url: string; type: string; title: string } | null>(null);

  const permissions = authUser?.permissions ?? [];
  const canCreate = permissions.includes('documents:create');
  const canUpdate = permissions.includes('documents:update');
  const canDownload = permissions.includes('documents:download');
  const canArchive = permissions.includes('documents:archive');
  const canRestore = permissions.includes('documents:restore');
  const canManage = permissions.includes('documents:manage');
  const canApprove = permissions.includes('documents:approve');

  const fetchDocumentPage = useCallback(async (archived: boolean): Promise<ManagedDocument[]> => {
    const allRows: any[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await apiClient.get<any[]>(
        `/documents?archived=${archived}&limit=200&offset=${offset}`
      );
      allRows.push(...page);
      if (page.length < 200) break;
      if (offset >= 100000) throw new Error('Das Dokumentenlimit für eine Ansicht wurde erreicht.');
    }
    return allRows.map((row) => mapDmsDocumentRow(row, authUser?.tenantId ?? ''));
  }, [authUser?.tenantId]);

  const refreshDocuments = useCallback(async (archived = archivedView) => {
    setError('');
    const loaded = await fetchDocumentPage(archived);
    if (archived) setArchivedDocuments(loaded);
    else setDocuments(loaded);
  }, [archivedView, fetchDocumentPage, setDocuments]);

  const refreshFoldersAndCategories = useCallback(async () => {
    const [categoryRows, folderRows] = await Promise.all([
      apiClient.get<DocumentCategory[]>('/documents/categories'),
      apiClient.get<DocumentFolder[]>('/documents/folders')
    ]);
    setCategories(categoryRows.filter((category) => !category.is_archived));
    setFolders(folderRows);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([refreshFoldersAndCategories(), refreshDocuments(archivedView)])
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Dokumente konnten nicht geladen werden.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [refreshDocuments, refreshFoldersAndCategories]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const visibleDocuments = archivedView ? archivedDocuments : documents.filter((document) => !document.archivedAt);
  const filteredDocuments = useMemo(() => visibleDocuments
    .filter((document) => !selectedFolder || document.folderId === selectedFolder)
    .filter((document) => categoryFilter === 'all' || document.categoryId === categoryFilter)
    .filter((document) => statusFilter === 'all' || document.status === statusFilter)
    .filter((document) => {
      const query = search.trim().toLocaleLowerCase('de-DE');
      return !query || [
        document.title, document.fileName, document.category, document.linkedEntityName,
        document.description, ...document.tags.map((tag) => tag.name)
      ].some((value) => value?.toLocaleLowerCase('de-DE').includes(query));
    })
    .sort((left, right) => {
      let comparison = 0;
      if (sortBy === 'title') comparison = left.title.localeCompare(right.title, 'de');
      else if (sortBy === 'created_at') comparison = left.uploadedAt.localeCompare(right.uploadedAt);
      else if (sortBy === 'valid_until') comparison = (left.validUntil ?? '').localeCompare(right.validUntil ?? '');
      else comparison = left.uploadedAt.localeCompare(right.uploadedAt);
      return sortDirection === 'asc' ? comparison : -comparison;
    }), [visibleDocuments, selectedFolder, categoryFilter, statusFilter, search, sortBy, sortDirection]);

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const breadcrumbs = useMemo(() => {
    const path: DocumentFolder[] = [];
    const seen = new Set<string>();
    let current = selectedFolder ? folderById.get(selectedFolder) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parent_id ? folderById.get(current.parent_id) : undefined;
    }
    return path;
  }, [selectedFolder, folderById]);

  const relationshipOptions = relationshipType === 'customer'
    ? clients.map((client) => ({ id: client.id, name: client.companyName }))
    : relationshipType === 'site'
      ? sites.map((site) => ({ id: site.id, name: site.name }))
      : relationshipType === 'employee'
        ? employees.map((employee) => ({ id: employee.id, name: `${employee.firstName} ${employee.lastName}` }))
        : relationshipType === 'shift'
          ? shifts.map((shift) => ({ id: shift.id, name: `${shift.siteName} · ${shift.date}` }))
          : relationshipType === 'incident'
            ? incidents.map((incident) => ({ id: incident.id, name: incident.title }))
            : [];
  const editRelationshipOptions = editRelationshipType === 'customer'
    ? clients.map((client) => ({ id: client.id, name: client.companyName }))
    : editRelationshipType === 'site'
      ? sites.map((site) => ({ id: site.id, name: site.name }))
      : editRelationshipType === 'employee'
        ? employees.map((employee) => ({ id: employee.id, name: `${employee.firstName} ${employee.lastName}` }))
        : editRelationshipType === 'shift'
          ? shifts.map((shift) => ({ id: shift.id, name: `${shift.siteName} · ${shift.date}` }))
          : editRelationshipType === 'incident'
            ? incidents.map((incident) => ({ id: incident.id, name: incident.title }))
            : [];

  const openEdit = (document: ManagedDocument) => {
    setEditingDocument(document);
    setEditTitle(document.title);
    setEditDescription(document.description);
    setEditCategory(document.categoryId);
    setEditStatus(document.status);
    setEditValidFrom(document.validFrom?.slice(0, 10) ?? '');
    setEditValidUntil(document.validUntil?.slice(0, 10) ?? '');
    setEditDocumentNumber(document.documentNumber ?? '');
    setEditTags(document.tags.map((tag) => tag.name).join(', '));
    setEditRelationshipType(document.linkedEntityType === 'general' ? '' : document.linkedEntityType);
    setEditRelationshipId(document.linkedEntityId ?? '');
  };

  const download = async (document: ManagedDocument, version?: number, inline = false) => {
    const query = new URLSearchParams();
    if (version) query.set('version', String(version));
    if (inline) query.set('inline', 'true');
    const suffix = query.size ? `?${query}` : '';
    const blob = await apiClient.downloadFile(`/documents/${document.id}/download${suffix}`);
    return blob;
  };

  const handleDownload = async (document: ManagedDocument, version?: number) => {
    try {
      setError('');
      const blob = await download(document, version);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Download fehlgeschlagen.');
    }
  };

  const handlePreview = async (document: ManagedDocument) => {
    try {
      setError('');
      const blob = await download(document, undefined, true);
      setPreview({ url: URL.createObjectURL(blob), type: document.contentType, title: document.title });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vorschau nicht verfügbar.');
    }
  };

  const submitUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!fileToUpload || !uploadCategory) return;
    const query = new URLSearchParams({
      title: uploadTitle,
      categoryId: uploadCategory,
      description: uploadDescription
    });
    if (uploadFolder) query.set('folderId', uploadFolder);
    if (relationshipType && relationshipId) {
      query.set('relationshipType', relationshipType);
      query.set('relationshipId', relationshipId);
    }
    try {
      setError('');
      setUploadProgress(0);
      await apiClient.uploadFile(`/documents?${query.toString()}`, fileToUpload, setUploadProgress);
      setUploadOpen(false);
      setFileToUpload(null);
      setUploadTitle('');
      setUploadDescription('');
      setRelationshipType('');
      setRelationshipId('');
      await refreshDocuments(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Upload fehlgeschlagen.');
    } finally {
      setUploadProgress(null);
    }
  };

  const submitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDocument) return;
    const tags = editTags.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      setError('');
      await apiClient.patch(`/documents/${editingDocument.id}`, {
        title: editTitle,
        categoryId: editCategory,
        description: editDescription,
        status: editStatus,
        validFrom: editValidFrom || null,
        validUntil: editValidUntil || null,
        documentNumber: editDocumentNumber || null,
        tags,
        relationship: {
          type: editRelationshipType || null,
          id: editRelationshipType && editRelationshipId ? editRelationshipId : null
        }
      });
      setEditingDocument(null);
      await refreshDocuments(archivedView);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Änderungen konnten nicht gespeichert werden.');
    }
  };

  const submitFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiClient.post('/documents/folders', { name: folderName, parentId: selectedFolder });
      setFolderDialogOpen(false);
      setFolderName('');
      await refreshFoldersAndCategories();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ordner konnte nicht erstellt werden.');
    }
  };

  const submitCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiClient.post('/documents/categories', { name: categoryName });
      setCategoryDialogOpen(false);
      setCategoryName('');
      await refreshFoldersAndCategories();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kategorie konnte nicht erstellt werden.');
    }
  };

  const openVersions = async (document: ManagedDocument) => {
    try {
      const history = await apiClient.get<DocumentVersion[]>(`/documents/${document.id}/versions`);
      setVersions(history);
      setVersionsDocument(document);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Versionshistorie konnte nicht geladen werden.');
    }
  };

  const restoreVersion = async (version: DocumentVersion) => {
    if (!versionsDocument) return;
    try {
      await apiClient.post(`/documents/${versionsDocument.id}/versions/${version.version_number}/restore`, {});
      await openVersions(versionsDocument);
      await refreshDocuments(archivedView);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Version konnte nicht wiederhergestellt werden.');
    }
  };

  const changeDocumentFolder = async (documentId: string, folderId: string) => {
    try {
      await apiClient.post(`/documents/${documentId}/move`, { folderId: folderId || null });
      await refreshDocuments(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dokument konnte nicht verschoben werden.');
    }
  };

  const changeFolderName = async (folder: DocumentFolder) => {
    const name = window.prompt('Neuer Ordnername', folder.name)?.trim();
    if (!name || name === folder.name) return;
    try {
      await apiClient.patch(`/documents/folders/${folder.id}`, { name });
      await refreshFoldersAndCategories();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ordner konnte nicht umbenannt werden.');
    }
  };

  const archiveFolder = async (folder: DocumentFolder) => {
    try {
      await apiClient.post(`/documents/folders/${folder.id}/archive`, {});
      if (selectedFolder === folder.id) setSelectedFolder(null);
      await refreshFoldersAndCategories();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ordner konnte nicht archiviert werden.');
    }
  };

  const archiveDocument = async (document: ManagedDocument) => {
    if (!window.confirm(`"${document.title}" archivieren? Die Datei und alle Versionen bleiben erhalten.`)) return;
    try {
      await apiClient.post(`/documents/${document.id}/archive`, {});
      await refreshDocuments(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dokument konnte nicht archiviert werden.');
    }
  };

  const restoreDocument = async (document: ManagedDocument) => {
    try {
      await apiClient.post(`/documents/${document.id}/restore`, {});
      await refreshDocuments(true);
      await refreshDocuments(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dokument konnte nicht wiederhergestellt werden.');
    }
  };

  const openVersionUpload = (document: ManagedDocument) => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await apiClient.uploadFile(`/documents/${document.id}/versions`, file, setUploadProgress);
        await refreshDocuments(false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Neue Version konnte nicht gespeichert werden.');
      } finally {
        setUploadProgress(null);
      }
    };
    input.click();
  };

  const statusClass = (status: string) => status === 'Freigegeben' || status === 'Veröffentlicht'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : status === 'Abgelaufen'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : status === 'In Prüfung'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
        : 'border-slate-700 bg-slate-800 text-slate-300';

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><FileText className="h-6 w-6 text-blue-400" />Dokumentenmanagement</h1>
          <p className="mt-1 text-xs text-slate-400">Mandantengeschützte Ablage, Suche und nachvollziehbare Versionen.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setStatusFilter('all'); setArchivedView((value) => !value); }} className={`${buttonClass} bg-slate-800 text-slate-200`}>
            {archivedView ? <ArrowLeft className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{archivedView ? 'Aktive Dokumente' : 'Archiv'}
          </button>
          {canCreate && <button type="button" disabled={!online} onClick={() => setUploadOpen(true)} className={`${buttonClass} bg-blue-600 text-white`}>
            <Upload className="h-4 w-4" />Dokument hochladen
          </button>}
        </div>
      </header>

      {!online && <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        Offline: Angezeigte Metadaten stammen aus dem Arbeitsspeicher. Upload, Download, Vorschau und Änderungen benötigen eine Verbindung; Dateien werden nicht offline gespeichert.
      </div>}
      {error && <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
        <span>{error}</span><button aria-label="Fehlermeldung schließen" onClick={() => setError('')}><X className="h-4 w-4" /></button>
      </div>}

      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">Ordner</h2>
            {canCreate && <button title="Unterordner erstellen" onClick={() => setFolderDialogOpen(true)} className="rounded p-1 text-blue-300 hover:bg-slate-800"><FolderPlus className="h-4 w-4" /></button>}
          </div>
          <button onClick={() => setSelectedFolder(null)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${selectedFolder === null ? 'bg-blue-600/20 text-blue-200' : 'text-slate-300 hover:bg-slate-800'}`}>
            <Folder className="h-4 w-4" />Alle Ordner
          </button>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {folders.map((folder) => <div key={folder.id} className="group flex items-center gap-1">
              <button onClick={() => setSelectedFolder(folder.id)} className={`min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-xs ${selectedFolder === folder.id ? 'bg-blue-600/20 text-blue-200' : 'text-slate-400 hover:bg-slate-800'}`}>
                <Folder className="mr-2 inline h-3.5 w-3.5" />{folder.name}<span className="ml-1 text-slate-600">({folder.document_count})</span>
              </button>
              {canUpdate && <button title="Ordner umbenennen" onClick={() => void changeFolderName(folder)} className="hidden p-1 text-slate-500 hover:text-blue-300 group-hover:block"><Pencil className="h-3 w-3" /></button>}
              {canArchive && folder.document_count === 0 && <button title="Leeren Ordner archivieren" onClick={() => void archiveFolder(folder)} className="hidden p-1 text-slate-500 hover:text-rose-300 group-hover:block"><Archive className="h-3 w-3" /></button>}
            </div>)}
            {folders.length === 0 && <p className="px-2 py-2 text-xs text-slate-600">Noch keine Ordner.</p>}
          </div>
          {canManage && <button onClick={() => setCategoryDialogOpen(true)} className="mt-2 w-full border-t border-slate-800 pt-3 text-left text-xs text-blue-300 hover:text-blue-200">
            <Plus className="mr-1 inline h-3.5 w-3.5" />Kategorie verwalten
          </button>}
        </aside>

        <section className="min-w-0 space-y-4">
          <nav aria-label="Brotkrumennavigation" className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            <button onClick={() => setSelectedFolder(null)} className="hover:text-slate-200">Dokumente</button>
            {breadcrumbs.map((folder) => <React.Fragment key={folder.id}><ChevronRight className="h-3 w-3" /><button onClick={() => setSelectedFolder(folder.id)} className="hover:text-slate-200">{folder.name}</button></React.Fragment>)}
            {archivedView && <><ChevronRight className="h-3 w-3" /><span className="text-amber-300">Archiv</span></>}
          </nav>
          <div className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-3 md:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(120px,auto))]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input aria-label="Dokumente suchen" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Titel, Datei, Kunde, Schlagwort ..." className={`${fieldClass} pl-9`} />
            </label>
            <select aria-label="Kategorie filtern" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={fieldClass}>
              <option value="all">Alle Kategorien</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select aria-label="Status filtern" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={fieldClass}>
              <option value="all">Alle Status</option>{(archivedView ? ['Archiviert'] : ['Entwurf', 'In Prüfung', 'Freigegeben', 'Veröffentlicht', 'Abgelaufen']).map((status) => <option key={status}>{status}</option>)}
            </select>
            <select aria-label="Sortierung" value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} className={fieldClass}>
              <option value="updated_at">Änderungsdatum</option><option value="created_at">Erstellungsdatum</option><option value="title">Titel</option><option value="valid_until">Gültigkeit</option>
            </select>
            <button onClick={() => setSortDirection((value) => value === 'asc' ? 'desc' : 'asc')} className={`${buttonClass} bg-slate-800 text-slate-300`}>
              {sortDirection === 'asc' ? 'Aufsteigend' : 'Absteigend'}
            </button>
          </div>

          {loading ? <div role="status" className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-sm text-slate-400">Dokumente werden geladen ...</div>
            : filteredDocuments.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-3 text-sm text-slate-300">Keine Dokumente gefunden.</p><p className="mt-1 text-xs text-slate-500">Passe Suche und Filter an oder lade ein Dokument hoch.</p>
            </div>
              : <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredDocuments.map((document) => <article key={document.id} className="flex min-w-0 flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-300">{document.category}</span>
                      <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${statusClass(document.status)}`}>{document.status}</span>
                    </div>
                    <h2 className="mt-3 break-words text-sm font-bold text-slate-100">{document.title}</h2>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{document.fileName}</p>
                    <p className="mt-2 text-xs text-slate-400">v{document.version} · {bytesLabel(document.sizeBytes)} · {dateLabel(document.uploadedAt)}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">Zuordnung: {relationshipTitle(document)}</p>
                    {document.validUntil && <p className="mt-1 text-xs text-slate-500">Gültig bis: {dateLabel(document.validUntil)}</p>}
                    <p className={`mt-2 text-[10px] ${document.scanStatus === 'clean' ? 'text-emerald-300' : document.scanStatus === 'infected' ? 'text-rose-300' : 'text-amber-300'}`}>
                      Virenprüfung: {document.scanStatus === 'clean' ? 'geprüft' : document.scanStatus === 'infected' ? 'infiziert' : 'nicht durchgeführt'}
                    </p>
                    {document.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{document.tags.map((tag) => <span key={tag.id} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400"><Tag className="mr-1 inline h-2.5 w-2.5" />{tag.name}</span>)}</div>}
                    {!archivedView && canUpdate && <select aria-label={`Ordner für ${document.title}`} value={document.folderId ?? ''} onChange={(event) => void changeDocumentFolder(document.id, event.target.value)} className="mt-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-400">
                      <option value="">Kein Ordner</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-800 pt-3">
                    {canDownload && <button disabled={!online} title="Herunterladen" onClick={() => void handleDownload(document)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40"><Download className="h-4 w-4" /></button>}
                    {canDownload && ['application/pdf', 'image/', 'text/'].some((type) => type.endsWith('/') ? document.contentType.startsWith(type) : document.contentType === type) && <button disabled={!online} title="Vorschau" onClick={() => void handlePreview(document)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Eye className="h-4 w-4" /></button>}
                    {!archivedView && canUpdate && <>
                      <button title="Metadaten bearbeiten" onClick={() => openEdit(document)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-blue-300"><Pencil className="h-4 w-4" /></button>
                      <button disabled={!online} title="Neue Version hochladen" onClick={() => openVersionUpload(document)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-blue-300"><Upload className="h-4 w-4" /></button>
                    </>}
                    <button title="Versionshistorie" onClick={() => void openVersions(document)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-blue-300"><History className="h-4 w-4" /></button>
                    {!archivedView && canArchive && <button title="Archivieren" onClick={() => void archiveDocument(document)} className="rounded-lg p-2 text-slate-400 hover:bg-amber-500/10 hover:text-amber-300"><Archive className="h-4 w-4" /></button>}
                    {archivedView && canRestore && <button title="Wiederherstellen" onClick={() => void restoreDocument(document)} className="rounded-lg p-2 text-emerald-300 hover:bg-emerald-500/10"><RotateCcw className="h-4 w-4" /></button>}
                  </div>
                </article>)}
              </div>}
        </section>
      </div>

      {uploadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <form onSubmit={submitUpload} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-slate-700 bg-[#0f172a] p-5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3"><h2 className="font-bold text-white">Dokument hochladen</h2><button type="button" onClick={() => setUploadOpen(false)} aria-label="Dialog schließen"><X className="h-5 w-5 text-slate-400" /></button></div>
          <label className="block text-xs text-slate-400">Datei *<input required type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.bmp" onChange={(event) => { const file = event.target.files?.[0] ?? null; setFileToUpload(file); if (file && !uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, '')); }} className={`${fieldClass} mt-1`} /></label>
          {fileToUpload && <p className="text-xs text-slate-500">{fileToUpload.name} · {bytesLabel(fileToUpload.size)}</p>}
          <label className="block text-xs text-slate-400">Titel *<input required maxLength={255} value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} className={`${fieldClass} mt-1`} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Kategorie *<select required value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)} className={`${fieldClass} mt-1`}><option value="">Kategorie wählen</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="text-xs text-slate-400">Ordner<select value={uploadFolder} onChange={(event) => setUploadFolder(event.target.value)} className={`${fieldClass} mt-1`}><option value="">Kein Ordner</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
          </div>
          <label className="block text-xs text-slate-400">Beschreibung<textarea maxLength={10000} value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} className={`${fieldClass} mt-1`} rows={3} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Zuordnung<select value={relationshipType} onChange={(event) => { setRelationshipType(event.target.value); setRelationshipId(''); }} className={`${fieldClass} mt-1`}>
              <option value="">Allgemein</option><option value="customer">Kunde</option><option value="site">Objekt</option><option value="employee">Mitarbeiter</option><option value="shift">Schicht</option><option value="incident">Wachbuchereignis</option>
            </select></label>
            <label className="text-xs text-slate-400">Datensatz<select disabled={!relationshipType} value={relationshipId} onChange={(event) => setRelationshipId(event.target.value)} className={`${fieldClass} mt-1 disabled:opacity-50`}><option value="">Auswählen ...</option>{relationshipOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          </div>
          {uploadProgress !== null && <div role="status"><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div><p className="mt-1 text-right text-xs text-slate-400">{uploadProgress}%</p></div>}
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-3"><button type="button" onClick={() => setUploadOpen(false)} className={`${buttonClass} bg-slate-800 text-slate-300`}>Abbrechen</button><button disabled={!online || !fileToUpload || !uploadCategory || uploadProgress !== null} className={`${buttonClass} bg-blue-600 text-white`}><Upload className="h-4 w-4" />Hochladen</button></div>
        </form>
      </div>}

      {editingDocument && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <form onSubmit={submitEdit} className="max-h-[90vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-2xl border border-slate-700 bg-[#0f172a] p-5">
          <div className="flex justify-between"><h2 className="font-bold text-white">Dokument bearbeiten</h2><button type="button" onClick={() => setEditingDocument(null)} aria-label="Dialog schließen"><X className="h-5 w-5 text-slate-400" /></button></div>
          <label className="block text-xs text-slate-400">Titel<input required value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className={`${fieldClass} mt-1`} /></label>
          <label className="block text-xs text-slate-400">Kategorie<select value={editCategory} onChange={(event) => setEditCategory(event.target.value)} className={`${fieldClass} mt-1`}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="block text-xs text-slate-400">Beschreibung<textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} className={`${fieldClass} mt-1`} rows={3} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Status<select value={editStatus} onChange={(event) => setEditStatus(event.target.value)} className={`${fieldClass} mt-1`}>
              {['Entwurf', 'In Prüfung', 'Freigegeben', 'Veröffentlicht', 'Abgelaufen'].map((status) => <option key={status} disabled={['Freigegeben', 'Veröffentlicht'].includes(status) && !canApprove}>{status}</option>)}
            </select></label>
            <label className="text-xs text-slate-400">Dokumentennummer<input value={editDocumentNumber} onChange={(event) => setEditDocumentNumber(event.target.value)} className={`${fieldClass} mt-1`} /></label>
            <label className="text-xs text-slate-400">Gültig ab<input type="date" value={editValidFrom} onChange={(event) => setEditValidFrom(event.target.value)} className={`${fieldClass} mt-1`} /></label>
            <label className="text-xs text-slate-400">Gültig bis<input type="date" value={editValidUntil} onChange={(event) => setEditValidUntil(event.target.value)} className={`${fieldClass} mt-1`} /></label>
          </div>
          <label className="block text-xs text-slate-400">Schlagwörter (Komma-getrennt)<input value={editTags} onChange={(event) => setEditTags(event.target.value)} className={`${fieldClass} mt-1`} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">Zuordnung<select value={editRelationshipType} onChange={(event) => { setEditRelationshipType(event.target.value); setEditRelationshipId(''); }} className={`${fieldClass} mt-1`}>
              <option value="">Allgemein</option><option value="customer">Kunde</option><option value="site">Objekt</option><option value="employee">Mitarbeiter</option><option value="shift">Schicht</option><option value="incident">Wachbuchereignis</option>
            </select></label>
            <label className="text-xs text-slate-400">Datensatz<select disabled={!editRelationshipType} value={editRelationshipId} onChange={(event) => setEditRelationshipId(event.target.value)} className={`${fieldClass} mt-1`}><option value="">Auswählen ...</option>{editRelationshipOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-3"><button type="button" onClick={() => setEditingDocument(null)} className={`${buttonClass} bg-slate-800 text-slate-300`}>Abbrechen</button><button disabled={!online || !canUpdate} className={`${buttonClass} bg-blue-600 text-white`}>Änderungen speichern</button></div>
        </form>
      </div>}

      {versionsDocument && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0f172a] p-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3"><div><h2 className="font-bold text-white">Versionshistorie</h2><p className="mt-1 text-xs text-slate-400">{versionsDocument.title}</p></div><button onClick={() => setVersionsDocument(null)} aria-label="Dialog schließen"><X className="h-5 w-5 text-slate-400" /></button></div>
          <div className="mt-3 divide-y divide-slate-800">{versions.map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0"><p className="text-sm font-semibold text-slate-200">Version {version.version_number} {Number(version.version_number) === Number(versionsDocument.version) && <span className="text-xs text-blue-300">(aktuell)</span>}</p><p className="mt-1 truncate text-xs text-slate-500">{version.original_filename} · {bytesLabel(Number(version.size_bytes))} · {dateLabel(version.created_at)}</p><p className="mt-1 text-[10px] text-amber-300">Virenscan: {version.scan_status === 'clean' ? 'geprüft' : version.scan_status === 'infected' ? 'infiziert' : 'nicht durchgeführt'}{version.restored_from_version ? ` · wiederhergestellt aus v${version.restored_from_version}` : ''}</p></div>
            <div className="flex gap-2">{canDownload && <button disabled={!online} onClick={() => void handleDownload(versionsDocument, Number(version.version_number))} className={`${buttonClass} bg-slate-800 text-slate-300`}><Download className="h-3.5 w-3.5" />Download</button>}{canUpdate && Number(version.version_number) !== Number(versionsDocument.version) && <button disabled={!online} onClick={() => void restoreVersion(version)} className={`${buttonClass} bg-blue-600/20 text-blue-200`}><RotateCcw className="h-3.5 w-3.5" />Als neue Version wiederherstellen</button>}</div>
          </div>)}</div>
        </section>
      </div>}

      {folderDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><form onSubmit={submitFolder} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-[#0f172a] p-5"><div className="flex justify-between"><h2 className="font-bold text-white">Ordner erstellen</h2><button type="button" onClick={() => setFolderDialogOpen(false)} aria-label="Dialog schließen"><X className="h-5 w-5 text-slate-400" /></button></div><label className="block text-xs text-slate-400">Name<input required value={folderName} onChange={(event) => setFolderName(event.target.value)} className={`${fieldClass} mt-1`} /></label><p className="text-xs text-slate-500">Neuer Unterordner von: {selectedFolder ? folderById.get(selectedFolder)?.name : 'Dokumente'}</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setFolderDialogOpen(false)} className={`${buttonClass} bg-slate-800 text-slate-300`}>Abbrechen</button><button className={`${buttonClass} bg-blue-600 text-white`}>Erstellen</button></div></form></div>}

      {categoryDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><form onSubmit={submitCategory} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-700 bg-[#0f172a] p-5"><div className="flex justify-between"><h2 className="font-bold text-white">Kategorie erstellen</h2><button type="button" onClick={() => setCategoryDialogOpen(false)} aria-label="Dialog schließen"><X className="h-5 w-5 text-slate-400" /></button></div><label className="block text-xs text-slate-400">Name<input required minLength={2} maxLength={100} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className={`${fieldClass} mt-1`} /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setCategoryDialogOpen(false)} className={`${buttonClass} bg-slate-800 text-slate-300`}>Abbrechen</button><button className={`${buttonClass} bg-blue-600 text-white`}>Erstellen</button></div></form></div>}

      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-3">
        <section className="flex h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-700 bg-[#0f172a] p-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2"><h2 className="truncate text-sm font-bold text-white">{preview.title}</h2><button onClick={() => setPreview(null)} aria-label="Vorschau schließen"><X className="h-5 w-5 text-slate-400" /></button></div>
          {preview.type.startsWith('image/') ? <img src={preview.url} alt={preview.title} className="m-auto max-h-full max-w-full object-contain" /> : <iframe title={`Vorschau: ${preview.title}`} src={preview.url} sandbox="" className="mt-2 min-h-0 flex-1 rounded bg-white" />}
        </section>
      </div>}
    </div>
  );
};
