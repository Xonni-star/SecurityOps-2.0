import { useSecurityStore } from '../store';
import { apiClient, ApiError } from '../services/apiClient';
import { offlineVault } from '../services/indexedDbService';

describe('SecurityOps 2.0 - Frontend Store Konfliktauflösung & API-Vertragstests (Schritt 5R.2.6)', () => {
  const queueId = `test-q-${Date.now()}`;

  beforeEach(() => {
    useSecurityStore.setState({
      syncQueue: [
        {
          id: queueId,
          tenantId: 'tenant-frankfurt',
          entityType: 'task',
          action: 'UPDATE',
          payload: { id: 'task-123', status: 'In Bearbeitung', title: 'Testaufgabe' },
          createdAt: new Date().toISOString(),
          retryCount: 0,
          status: 'conflict',
          conflictDetails: { serverVersion: 2, clientVersion: 1 }
        }
      ],
      tasks: [
        {
          id: 'task-123',
          tenantId: 'tenant-frankfurt',
          title: 'Testaufgabe',
          assignedToName: 'Einsatzleitung',
          dueDate: '2025-06-01',
          priority: 'Hoch',
          status: 'Offen',
          category: 'Audit',
          revisionVersion: 1
        }
      ]
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('1. Gültige Konfliktantwort mit data, applied: true und serverState entfernt Outbox und aktualisiert Store', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValueOnce({
      applied: true,
      clientUuid: queueId,
      entityType: 'task',
      strategy: 'USE_LOCAL',
      serverState: {
        id: 'task-123',
        status: 'In Bearbeitung',
        title: 'Testaufgabe aktualisiert',
        revision_version: 3
      }
    });

    jest.spyOn(offlineVault, 'markSynced').mockResolvedValueOnce(undefined);

    await useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeUndefined();
    const task = state.tasks.find((t) => t.id === 'task-123');
    expect(task?.status).toBe('In Bearbeitung');
    expect(task?.title).toBe('Testaufgabe aktualisiert');
    expect(task?.revisionVersion).toBe(3);
  });

  test('2. API liefert kein data-Objekt: Outbox bleibt unverändert erhalten, Fehler wird geworfen', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValueOnce(null as any);
    const markSyncedSpy = jest.spyOn(offlineVault, 'markSynced');

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Ungültige Serverantwort');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
    expect(markSyncedSpy).not.toHaveBeenCalled();
  });

  test('3. API liefert applied: false: Outbox bleibt erhalten', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValueOnce({
      applied: false,
      clientUuid: queueId,
      entityType: 'task',
      strategy: 'USE_LOCAL',
      serverState: { id: 'task-123', status: 'Offen' }
    });

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Ungültige Serverantwort');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('4. API liefert keinen serverState: Outbox bleibt erhalten', async () => {
    jest.spyOn(apiClient, 'post').mockResolvedValueOnce({
      applied: true,
      clientUuid: queueId,
      entityType: 'task',
      strategy: 'USE_LOCAL',
      serverState: null
    });

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Ungültige Serverantwort');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('5. Netzwerkfehler während Konfliktauflösung: Outbox bleibt erhalten und wirft Fehler', async () => {
    jest.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('Network connection lost'));

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Network connection lost');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('6. HTTP-Fehler 409 Conflict: Outbox bleibt erhalten', async () => {
    jest.spyOn(apiClient, 'post').mockRejectedValueOnce(new ApiError(409, 'Versionskonflikt'));

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Versionskonflikt');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });
});
