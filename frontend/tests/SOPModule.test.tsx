import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  acknowledge: vi.fn(),
  loadTenantData: vi.fn(),
  setSOPs: vi.fn(),
  state: {
    sops: [] as any[],
    authUser: { permissions: ['sop:manage', 'sop:submit'], tenantId: 'tenant-a' },
    isOnline: true,
    sites: [],
    clients: [],
    employees: [],
    documents: [] as any[],
    acknowledgeSOP: vi.fn(),
    loadTenantData: vi.fn(),
    syncPendingSOPAcknowledgements: vi.fn()
  }
}));

vi.mock('../services/apiClient', () => ({
  apiClient: { get: mocks.get, post: mocks.post, patch: mocks.patch }
}));

vi.mock('../store', () => ({
  useSecurityStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}));

import { SOPModule } from '../components/SOPModule';

const draftSOP = {
  id: 'sop-1', assignmentId: 'assignment-1', tenantId: 'tenant-a', sopNumber: 'DA-1',
  title: 'Objektschutz', category: 'Objektbezogen', status: 'draft', version: '1',
  effectiveDate: '2026-01-01', author: 'QM', content: 'Zutritt prüfen.',
  mandatoryAcknowledgment: true, dmsDocumentId: 'dms-1', currentUserAcknowledgment: 'unacknowledged'
};

describe('SOPModule', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.state.sops = [draftSOP];
    mocks.state.authUser = { permissions: ['sop:manage', 'sop:submit'], tenantId: 'tenant-a' };
    mocks.state.isOnline = true;
    mocks.state.acknowledgeSOP = mocks.acknowledge;
    mocks.state.loadTenantData = mocks.loadTenantData;
    mocks.state.documents = [{
      id: 'dms-1', tenantId: 'tenant-a', title: 'Brandschutzplan', fileName: 'brandschutz.pdf',
      categoryId: 'cat-1', category: 'Sicherheit', sizeBytes: 100, uploadedAt: '2026-01-01',
      version: '1', status: 'Aktiv', scanStatus: 'clean', contentType: 'application/pdf',
      description: '', tags: [], linkedEntityType: 'general'
    }];
    mocks.get.mockResolvedValue([]);
    mocks.post.mockResolvedValue({});
    mocks.loadTenantData.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  test('opening does not acknowledge; the affirmative statement must be checked before confirming', async () => {
    await act(async () => root.render(<SOPModule />));
    const details = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Details & Verlauf'));
    expect(details).toBeDefined();
    await act(async () => details?.click());

    expect(mocks.acknowledge).not.toHaveBeenCalled();
    expect(container.textContent).toContain('DMS-Dokument öffnen: Brandschutzplan');
    expect(container.textContent).toContain('Ich habe diese Dienstanweisung gelesen und zur Kenntnis genommen.');
    const confirmButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Kenntnisnahme bestätigen'));
    expect(confirmButton?.disabled).toBe(true);
    const confirmation = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => {
      if (!confirmation) throw new Error('Bestätigungskontrolle fehlt');
      confirmation.click();
    });
    expect(confirmButton?.disabled).toBe(false);
    await act(async () => confirmButton?.click());
    expect(mocks.acknowledge).toHaveBeenCalledWith('sop-1');
  });

  test('management workflow submits a draft and creates an SOP with camelCase metadata and an existing DMS link', async () => {
    await act(async () => root.render(<SOPModule />));
    const submit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Zur Prüfung'));
    expect(submit).toBeUndefined();
    const create = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Neue Anweisung'));
    await act(async () => create?.click());
    const setValue = async (label: string, value: string) => {
      const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`);
      if (!field) throw new Error(`Missing field: ${label}`);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
        setter?.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await setValue('Anweisungsnummer', 'DA-NEW-1');
    await setValue('Titel', 'Neue SOP');
    await setValue('Inhalt', 'Schritt 1');
    await setValue('Beschreibung', 'Für den Objektschutz');
    await setValue('Gültig ab', '2026-12-01');
    await setValue('Gültig bis', '2027-12-01');
    await setValue('DMS-Dokument', 'dms-1');
    const save = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Speichern'));
    await act(async () => save?.click());
    expect(mocks.post).toHaveBeenCalledWith('/sops', expect.objectContaining({
      description: 'Für den Objektschutz',
      effectiveFrom: '2026-12-01',
      effectiveUntil: '2027-12-01',
      dmsDocumentId: 'dms-1'
    }));
  });

  test('management workflow exposes draft submission in the detail view', async () => {
    await act(async () => root.render(<SOPModule />));
    const details = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Details & Verlauf'));
    await act(async () => details?.click());
    const submit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Zur Prüfung'));
    expect(submit).toBeDefined();
    await act(async () => submit?.click());
    expect(mocks.post).toHaveBeenCalledWith('/sops/sop-1/submit', {});
  });

  test('read-only SOP permission does not expose the manager-only reports tab', async () => {
    mocks.state.authUser = { permissions: ['sop:read'], tenantId: 'tenant-a' };
    await act(async () => root.render(<SOPModule />));
    expect(container.textContent).not.toContain('Berichte');
    expect(container.textContent).toContain('Mitarbeiter-Dashboard');
  });

  test('sop:publish permission exposes the withdraw action', async () => {
    mocks.state.authUser = { permissions: ['sop:publish'], tenantId: 'tenant-a' };
    mocks.state.sops = [{ ...draftSOP, status: 'published' }];
    await act(async () => root.render(<SOPModule />));
    const details = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Details & Verlauf'));
    await act(async () => details?.click());
    const withdraw = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Zurückziehen'));
    expect(withdraw).toBeDefined();
    await act(async () => withdraw?.click());
    expect(mocks.post).toHaveBeenCalledWith('/sops/sop-1/withdraw', {});
  });

  test('an offline acknowledgment is explicitly shown as pending, never server-confirmed', async () => {
    mocks.state.authUser = { permissions: [], tenantId: 'tenant-a' };
    mocks.state.isOnline = false;
    await act(async () => root.render(<SOPModule />));

    expect(container.textContent).toContain('Offline-Modus');
    expect(container.textContent).toContain('Noch nicht bestätigt');
    expect(container.textContent).not.toContain('Serverbestätigt');
  });
});
