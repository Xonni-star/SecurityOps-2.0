import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  state: {
    employees: [] as any[],
    sites: [] as any[],
    addEmployee: vi.fn(),
    updateEmployee: vi.fn(),
    archiveEmployee: vi.fn(),
    restoreEmployee: vi.fn(),
    addQualification: vi.fn(),
    updateQualification: vi.fn(),
    addAbsence: vi.fn(),
    reviewAbsence: vi.fn(),
    getTenantDocuments: vi.fn(() => [])
  }
}));

vi.mock('../store', () => ({
  useSecurityStore: (selector?: (state: typeof mocks.state) => unknown) =>
    selector ? selector(mocks.state) : mocks.state
}));

import { EmployeesModule } from '../components/EmployeesModule';

const sites = [
  { id: 'site-1', name: 'Hauptwache', siteCode: 'HW-1', archivedAt: null },
  { id: 'site-2', name: 'Bürogebäude', siteCode: 'BG-2', archivedAt: null }
];

describe('EmployeesModule site assignments', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.state.employees = [];
    mocks.state.sites = sites;
    mocks.state.addEmployee = mocks.addEmployee;
    mocks.state.updateEmployee = mocks.updateEmployee;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function setField(label: string, value: string): Promise<void> {
    const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!field) throw new Error(`Missing field: ${label}`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
      setter?.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  test('create submits selected assignedSiteIds to the employee store action', async () => {
    await act(async () => root.render(<EmployeesModule />));
    const create = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Mitarbeiter anlegen'));
    await act(async () => create?.click());

    const site = container.querySelector<HTMLInputElement>('input[aria-label="Standort Hauptwache"]');
    await act(async () => site?.click());
    await setField('Personalnummer', 'MA-NEW-1');
    await setField('Vorname', 'Erika');
    await setField('Nachname', 'Muster');
    await setField('E-Mail', 'erika@example.test');
    await setField('Telefon', '+49 30 123');

    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Speichern');
    await act(async () => save?.click());

    expect(mocks.addEmployee).toHaveBeenCalledWith(expect.objectContaining({
      personnelNumber: 'MA-NEW-1',
      assignedSiteIds: ['site-1']
    }));
  });

  test('edit loads and submits changed assignedSiteIds', async () => {
    mocks.state.employees = [{
      id: 'employee-1', tenantId: 'tenant-a', personnelNumber: 'MA-1',
      firstName: 'Erika', lastName: 'Muster', email: 'erika@example.test',
      phone: '+49 30 123', role: 'Wachdienstmitarbeiter', status: 'Aktiv',
      weeklyHours: 40, qualifications: [], assignedSiteIds: ['site-1'],
      hourlyRate: 18.5, dateOfJoining: '2024-01-01'
    }];
    await act(async () => root.render(<EmployeesModule />));
    const edit = container.querySelector<HTMLButtonElement>('button[title="Bearbeiten"]');
    await act(async () => edit?.click());

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Standort Hauptwache"]')?.checked).toBe(true);
    const secondSite = container.querySelector<HTMLInputElement>('input[aria-label="Standort Bürogebäude"]');
    await act(async () => secondSite?.click());
    const save = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.trim() === 'Speichern');
    await act(async () => save?.click());

    expect(mocks.updateEmployee).toHaveBeenCalledWith('employee-1', expect.objectContaining({
      assignedSiteIds: ['site-1', 'site-2']
    }));
  });
});
