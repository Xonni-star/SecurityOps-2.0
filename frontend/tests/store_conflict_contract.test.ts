import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSecurityStore } from '../store';
import { apiClient, ApiError } from '../services/apiClient';
import { offlineVault } from '../services/indexedDbService';

describe('SecurityOps 2.0 - Frontend Store Konfliktauflösung & API-Vertragstests (Schritt 5R.2.15 - Vitest)', () => {
  const queueId = `test-q-${Date.now()}`;

  beforeEach(() => {
    useSecurityStore.setState({
      currentTenantId: 'tenant-frankfurt',
      currentUserId: 'user-conflict-test',
      authUser: null,
      syncQueue: [
        {
          id: queueId,
          tenantId: 'tenant-frankfurt',
          userId: 'user-conflict-test',
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
    vi.restoreAllMocks();
  });

  test('1. Gültige Konfliktantwort mit data, applied: true und serverState entfernt Outbox und aktualisiert Store', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
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

    vi.spyOn(offlineVault, 'markSynced').mockResolvedValueOnce(undefined);

    await useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeUndefined();
    const task = state.tasks.find((t) => t.id === 'task-123');
    expect(task?.status).toBe('In Bearbeitung');
    expect(task?.title).toBe('Testaufgabe aktualisiert');
    expect(task?.revisionVersion).toBe(3);
  });

  test('2. API liefert kein data-Objekt: Outbox bleibt unverändert erhalten, Fehler wird geworfen', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce(null as any);
    const markSyncedSpy = vi.spyOn(offlineVault, 'markSynced');

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Ungültige Serverantwort');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
    expect(markSyncedSpy).not.toHaveBeenCalled();
  });

  test('3. API liefert applied: false: Outbox bleibt erhalten', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
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
    vi.spyOn(apiClient, 'post').mockResolvedValueOnce({
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
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('Network connection lost'));

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Network connection lost');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('6. HTTP-Fehler 409 Conflict: Outbox bleibt erhalten', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new ApiError(409, 'Versionskonflikt'));

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Versionskonflikt');

    const state = useSecurityStore.getState();
    expect(state.syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('refuses to resolve a conflict owned by another same-tenant user', async () => {
    const post = vi.spyOn(apiClient, 'post');
    useSecurityStore.setState({
      authUser: {
        id: 'different-user', email: '', fullName: '', role: '',
        tenantId: 'tenant-frankfurt', tenantName: '', permissions: []
      }
    });

    await expect(
      useSecurityStore.getState().resolveConflict(queueId, 'USE_LOCAL')
    ).rejects.toThrow('Konflikt gehört nicht zur aktuellen Mandanten- und Benutzeridentität');
    expect(post).not.toHaveBeenCalled();
    expect(useSecurityStore.getState().syncQueue.find((q) => q.id === queueId)).toBeDefined();
  });

  test('does not apply a confirmed server snapshot to a different identity after an in-flight resolution', async () => {
    let resolvePost!: (response: unknown) => void;
    vi.spyOn(apiClient, 'post').mockReturnValueOnce(
      new Promise(resolve => { resolvePost = resolve; })
    );
    const markSynced = vi.spyOn(offlineVault, 'markSynced').mockResolvedValue(undefined);
    const resolve = useSecurityStore.getState().resolveConflict(queueId, 'USE_SERVER');
    await vi.waitFor(() => expect(apiClient.post).toHaveBeenCalledOnce());
    useSecurityStore.setState({
      currentUserId: 'different-user',
      authUser: {
        id: 'different-user', email: '', fullName: '', role: '',
        tenantId: 'tenant-frankfurt', tenantName: '', permissions: []
      },
      syncQueue: [],
      tasks: [{ id: 'task-123', status: 'Other user state' }] as any
    });
    resolvePost({
      applied: true,
      clientUuid: queueId,
      entityType: 'task',
      strategy: 'USE_SERVER',
      serverState: { id: 'task-123', status: 'Server response from prior identity' }
    });

    await resolve;

    expect(markSynced).toHaveBeenCalledWith(queueId);
    expect(useSecurityStore.getState().tasks[0].status).toBe('Other user state');
    expect(useSecurityStore.getState().syncQueue).toHaveLength(0);
  });
});
