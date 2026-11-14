import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  storeState: {
    documents: [] as unknown[],
    setDocuments: vi.fn(),
    authUser: {
      tenantId: 'tenant-a',
      permissions: ['documents:read', 'documents:download']
    },
    clients: [],
    sites: [],
    employees: [],
    guardBook: [],
    shifts: []
  }
}));

vi.mock('../services/apiClient', () => ({
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    patch: vi.fn(),
    uploadFile: vi.fn(),
    downloadFile: vi.fn()
  }
}));

vi.mock('../store', () => ({
  mapDmsDocumentRow: (row: unknown) => row,
  useSecurityStore: (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState)
}));

import { DocumentsModule } from '../components/DocumentsModule';

const activeDocument = {
  id: 'active-doc',
  tenantId: 'tenant-a',
  title: 'Active policy',
  fileName: 'active.pdf',
  categoryId: 'category-a',
  category: 'Contracts',
  sizeBytes: 120,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  version: '1',
  status: 'Entwurf',
  scanStatus: 'not_scanned' as const,
  fileReleased: true,
  contentType: 'application/pdf',
  description: '',
  tags: [],
  linkedEntityType: 'general' as const
};

const archivedDocument = {
  ...activeDocument,
  id: 'archived-doc',
  title: 'Archived policy',
  fileName: 'archived.pdf',
  status: 'Archiviert',
  archivedAt: '2026-01-02T00:00:00.000Z'
};

describe('DocumentsModule archive view', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.storeState.setDocuments = vi.fn((documents: unknown[]) => {
      mocks.storeState.documents = documents;
    });
    mocks.storeState.authUser.permissions = ['documents:read', 'documents:download'];
    mocks.apiPost.mockResolvedValue({ scan_status: 'clean', released: true });
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/documents/categories' || endpoint === '/documents/folders') return Promise.resolve([]);
      return Promise.resolve(endpoint.includes('archived=true') ? [archivedDocument] : [activeDocument]);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('loads archived documents when switching to the archive and active documents when returning', async () => {
    await act(async () => {
      root.render(<DocumentsModule />);
    });
    expect(container.textContent).toContain('Active policy');

    const archiveButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Archiv'));
    expect(archiveButton).toBeDefined();
    await act(async () => archiveButton?.click());

    expect(mocks.apiGet).toHaveBeenCalledWith(expect.stringContaining('archived=true'));
    expect(container.textContent).toContain('Archived policy');
    expect(container.textContent).not.toContain('Active policy');

    const activeButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Aktive Dokumente'));
    expect(activeButton).toBeDefined();
    await act(async () => activeButton?.click());

    expect(mocks.apiGet).toHaveBeenLastCalledWith(expect.stringContaining('archived=false'));
    expect(container.textContent).toContain('Active policy');
    expect(container.textContent).not.toContain('Archived policy');
  });

  test('shows quarantine status and hides file actions while a scan is unavailable', async () => {
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/documents/categories' || endpoint === '/documents/folders') return Promise.resolve([]);
      return Promise.resolve([{
        ...activeDocument,
        scanStatus: 'unavailable',
        fileReleased: false
      }]);
    });

    await act(async () => {
      root.render(<DocumentsModule />);
    });

    expect(container.textContent).toContain('Scanner nicht verfügbar · Quarantäne');
    expect(container.querySelector('button[title="Herunterladen"]')).toBeNull();
    expect(container.querySelector('button[title="Vorschau"]')).toBeNull();
    expect(container.textContent).not.toContain('Erneut prüfen');
  });

  test('lets users with update permission retry a quarantined scan', async () => {
    mocks.storeState.authUser.permissions = ['documents:read', 'documents:update'];
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/documents/categories' || endpoint === '/documents/folders') return Promise.resolve([]);
      if (endpoint === '/documents/active-doc/versions') {
        return Promise.resolve([{
          id: 'version-a',
          version_number: 1,
          original_filename: 'active.pdf',
          content_type: 'application/pdf',
          size_bytes: 120,
          scan_status: 'unavailable',
          released: false,
          storage_deleted_at: null,
          storage_deletion_pending_at: null,
          created_at: '2026-01-01T00:00:00.000Z',
          created_by: 'user-a'
        }]);
      }
      return Promise.resolve(endpoint.includes('archived=true') ? [archivedDocument] : [activeDocument]);
    });

    await act(async () => root.render(<DocumentsModule />));
    const historyButton = container.querySelector('button[title="Versionshistorie"]');
    await act(async () => historyButton?.click());
    const rescanButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Erneut prüfen'));
    expect(rescanButton).toBeDefined();

    await act(async () => rescanButton?.click());
    expect(mocks.apiPost).toHaveBeenCalledWith('/documents/active-doc/versions/1/rescan', {});
    expect(container.textContent).toContain('erfolgreich erneut geprüft und freigegeben');
  });
});
