// SecurityOps 2.0 - Zuverlässige Enterprise IndexedDB Storage Engine (Schritt 5R gehärtet)
// Wartet bei Schreiboperationen zwingend auf transaction.oncomplete.
// Behandelt transaction.onerror und transaction.onabort als echte Fehler. Keine verschluckten Fehler!

const DB_NAME = 'SecurityOps2_OfflineVault';
const DB_VERSION = 7;
const MAX_AUTOMATIC_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

function patrolMutationOrder(mutation: OutboxMutation): number {
  if (mutation.entityType !== 'patrol') return 0;
  if (mutation.payload?.recordType === 'round_start') return 0;
  if (mutation.payload?.recordType === 'round_complete') return 2;
  return 1;
}

export interface OutboxMutation {
  id: string; // Eindeutige client_mutation_id (UUID v4)
  tenantId: string;
  userId: string;
  deviceId: string;
  entityType: 'guardbook' | 'shift' | 'task' | 'key' | 'employee' | 'attachment' | 'patrol' | 'handover' | 'client' | 'site';
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'QUALIFICATION_CREATE' | 'QUALIFICATION_UPDATE' | 'ABSENCE_CREATE' | 'ABSENCE_REVIEW';
  payload: any;
  occurredAt: string;
  baseVersion: number;
  retryCount: number;
  retryable?: boolean;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'SYNCED' | 'CONFLICT' | 'FAILED';
  errorMessage?: string;
  conflictDetails?: {
    serverVersion: number;
    clientVersion: number;
    serverPayload: any;
    clientPayload: any;
  };
}

export interface StoredAttachment {
  id: string;
  tenantId: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobData: string;
  capturedAt: string;
  synced: boolean;
}

export interface StoredSOPAcknowledgement {
  clientMutationId: string;
  tenantId: string;
  userId: string;
  sopId: string;
  assignmentId: string;
  versionId: string;
  version: string;
  capturedAt: string;
  status: 'pending' | 'stale';
}

export interface StoredAlarmMutation {
  clientMutationId: string;
  tenantId: string;
  userId: string;
  type: 'incident_report' | 'action_create' | 'status_change';
  payload: Record<string, unknown>;
  capturedAt: string;
  status: 'pending' | 'confirmed' | 'conflict';
  serverId?: string;
  errorMessage?: string;
  updatedAt: string;
}

interface StoredAlarmPlanCache {
  cacheKey: string;
  tenantId: string;
  userId: string;
  plans: any[];
  types: any[];
  sites: any[];
  cachedAt: string;
}

interface StoredPatrolCheckpointCache {
  cacheKey: string;
  tenantId: string;
  userId: string;
  checkpoints: Array<Record<string, unknown>>;
  routes?: Array<Record<string, unknown>>;
  cachedAt: string;
}

export interface StoredPlanningCache {
  cacheKey: string;
  tenantId: string;
  userId: string;
  shifts: any[];
  periods: any[];
  rangeFrom?: string;
  rangeTo?: string;
  cachedAt: string;
}

export interface StoredPatrolRound {
  cacheKey: string;
  tenantId: string;
  userId: string;
  roundId: string;
  siteId: string;
  routeId: string | null;
  routeVersion: number | null;
  startedAt: string;
  status: 'in_progress' | 'completion_pending';
  serverSynced: boolean;
}

export class IndexedDbService {
  private db: IDBDatabase | null = null;
  private currentDeviceId: string = '';

  constructor() {
    this.currentDeviceId = this.getOrCreateDeviceId();
  }

  getDeviceId(): string {
    return this.currentDeviceId;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private getOrCreateDeviceId(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        let dId = localStorage.getItem('secops_device_uuid');
        if (!dId) {
          dId = `dev-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15)}`;
          localStorage.setItem('secops_device_uuid', dId);
        }
        return dId;
      }
    } catch (e) {
      console.warn('[STORAGE NOTICE] localStorage nicht verfügbar:', e);
    }
    return 'dev-browser-vault';
  }

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB wird von diesem Browser / Iframe nicht unterstützt.');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          outboxStore.createIndex('status', 'status', { unique: false });
          outboxStore.createIndex('occurredAt', 'occurredAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('inbox')) {
          const inboxStore = db.createObjectStore('inbox', { keyPath: 'compositeKey' });
          inboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          inboxStore.createIndex('entityType', 'entityType', { unique: false });
        }

        if (!db.objectStoreNames.contains('attachments')) {
          const attachStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachStore.createIndex('entityId', 'entityId', { unique: false });
          attachStore.createIndex('synced', 'synced', { unique: false });
        }

        if (!db.objectStoreNames.contains('sopAcknowledgements')) {
          const sopStore = db.createObjectStore('sopAcknowledgements', { keyPath: 'clientMutationId' });
          sopStore.createIndex('tenantUser', ['tenantId', 'userId'], { unique: false });
          sopStore.createIndex('acknowledgementKey', 'acknowledgementKey', { unique: true });
        }

        if (!db.objectStoreNames.contains('alarmMutations')) {
          const alarmStore = db.createObjectStore('alarmMutations', { keyPath: 'clientMutationId' });
          alarmStore.createIndex('tenantUser', ['tenantId', 'userId'], { unique: false });
          alarmStore.createIndex('status', 'status', { unique: false });
          alarmStore.createIndex('capturedAt', 'capturedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('alarmPlanCache')) {
          const planCache = db.createObjectStore('alarmPlanCache', { keyPath: 'cacheKey' });
          planCache.createIndex('tenantUser', ['tenantId', 'userId'], { unique: true });
        }

        if (!db.objectStoreNames.contains('patrolCheckpointCache')) {
          const checkpointCache = db.createObjectStore('patrolCheckpointCache', { keyPath: 'cacheKey' });
          checkpointCache.createIndex('tenantUser', ['tenantId', 'userId'], { unique: true });
        }

        if (!db.objectStoreNames.contains('patrolRounds')) {
          const patrolRounds = db.createObjectStore('patrolRounds', { keyPath: 'cacheKey' });
          patrolRounds.createIndex('tenantUser', ['tenantId', 'userId'], { unique: false });
        }

        if (!db.objectStoreNames.contains('planningCache')) {
          const planningCache = db.createObjectStore('planningCache', { keyPath: 'cacheKey' });
          planningCache.createIndex('tenantUser', ['tenantId', 'userId'], { unique: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        const openedDb = this.db;
        openedDb.onversionchange = () => {
          openedDb.close();
          if (this.db === openedDb) this.db = null;
        };
        resolve(this.db);
      };

      request.onerror = () => {
        reject(request.error || new Error('Fehler beim Öffnen von IndexedDB'));
      };
    });
  }

  /**
   * Speichert eine Mutation transaktionssicher in der Outbox.
   * Wartet zwingend auf transaction.oncomplete!
   * Bei transaction.onerror oder onabort wird ein echter Fehler geworfen.
   */
  async enqueueMutation(mutation: Omit<OutboxMutation, 'deviceId' | 'retryCount' | 'status'>): Promise<OutboxMutation> {
    const db = await this.init();

    const item: OutboxMutation = {
      ...mutation,
      deviceId: this.currentDeviceId,
      retryCount: 0,
      status: 'PENDING'
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');

      tx.oncomplete = () => {
        resolve(item);
      };

      tx.onerror = () => {
        reject(tx.error || new Error(`[INDEXEDDB FEHLER] Speichern der Mutation ${item.id} fehlgeschlagen`));
      };

      tx.onabort = () => {
        reject(tx.error || new Error(`[INDEXEDDB ABORT] Transaktion für ${item.id} abgebrochen`));
      };

      const store = tx.objectStore('outbox');
      store.put(item);
    });
  }

  async enqueueOffline(record: any): Promise<void> {
    await this.enqueueMutation({
      id: record.id,
      tenantId: record.tenantId,
      userId: 'offline-guard',
      entityType: record.storeName || 'guardbook',
      action: record.action || 'CREATE',
      payload: record.data,
      occurredAt: record.timestamp || new Date().toISOString(),
      baseVersion: 1
    });
  }

  async getPendingOutbox(
    tenantId: string,
    userId: string,
    options: { includeFailed?: boolean } = {}
  ): Promise<OutboxMutation[]> {
    if (!userId) return [];
    const db = await this.init();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as OutboxMutation[]) || [];
        // Never replay mutations without an exact tenant and user owner.
        resolve(records
          .filter((r) => r.tenantId === tenantId && r.userId === userId &&
            (r.status === 'PENDING' || (r.status === 'FAILED' && (
              options.includeFailed ||
              (r.retryable === true && Number.isFinite(Date.parse(r.nextAttemptAt || '')) &&
                Date.parse(r.nextAttemptAt || '') <= now)
            ))))
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || patrolMutationOrder(a) - patrolMutationOrder(b)));
      };

      req.onerror = () => {
        reject(req.error || new Error('[INDEXEDDB FEHLER] Lesen der Outbox fehlgeschlagen'));
      };
    });
  }

  async getOutbox(
    tenantId: string,
    entityType?: OutboxMutation['entityType'],
    userId?: string
  ): Promise<OutboxMutation[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const request = tx.objectStore('outbox').getAll();
      request.onsuccess = () => {
        const records = (request.result as OutboxMutation[]) || [];
        resolve(records.filter(record => record.tenantId === tenantId &&
          (!entityType || record.entityType === entityType) &&
          (!userId || record.userId === userId)));
      };
      request.onerror = () => reject(request.error || new Error('[INDEXEDDB FEHLER] Lesen der Outbox fehlgeschlagen'));
    });
  }

  /**
   * Aktualisiert den Status einer Mutation in der Outbox erst nach Bestätigung.
   */
  async updateMutationStatus(
    id: string,
    status: OutboxMutation['status'],
    details?: {
      errorMessage?: string;
      conflictDetails?: OutboxMutation['conflictDetails'];
      retryable?: boolean;
    }
  ): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Aktualisierung für ${id} fehlgeschlagen`));
      tx.onabort = () => reject(tx.error || new Error(`Transaktion für ${id} abgebrochen`));

      const store = tx.objectStore('outbox');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result as OutboxMutation;
        if (!record) {
          return;
        }
        record.status = status;
        record.lastAttemptAt = new Date().toISOString();
        if (status === 'FAILED') {
          record.retryCount += 1;
          const canRetry = details?.retryable === true && record.retryCount <= MAX_AUTOMATIC_RETRIES;
          record.retryable = canRetry;
          record.nextAttemptAt = canRetry
            ? new Date(Date.now() + Math.min(
                RETRY_BASE_DELAY_MS * (2 ** (record.retryCount - 1)),
                RETRY_MAX_DELAY_MS
              )).toISOString()
            : undefined;
        } else {
          record.retryable = false;
          record.nextAttemptAt = undefined;
        }
        if (details?.errorMessage) record.errorMessage = details.errorMessage;
        if (details?.conflictDetails) record.conflictDetails = details.conflictDetails;

        store.put(record);
      };
    });
  }

  /**
   * Entfernt eine Mutation erst NACH erfolgreicher Serverquittierung.
   */
  async removeMutation(id: string): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Löschen der Mutation ${id} fehlgeschlagen`));
      tx.onabort = () => reject(tx.error || new Error(`Transaktion ${id} abgebrochen`));

      const store = tx.objectStore('outbox');
      store.delete(id);
    });
  }

  async markSynced(id: string): Promise<void> {
    await this.removeMutation(id);
  }

  async enqueueSOPAcknowledgement(
    acknowledgement: StoredSOPAcknowledgement
  ): Promise<{ acknowledgement: StoredSOPAcknowledgement; created: boolean }> {
    const db = await this.init();
    const acknowledgementKey = [
      acknowledgement.tenantId,
      acknowledgement.userId,
      acknowledgement.assignmentId,
      acknowledgement.versionId
    ].join(':');

    return new Promise((resolve, reject) => {
      const tx = db.transaction('sopAcknowledgements', 'readwrite');
      const store = tx.objectStore('sopAcknowledgements');
      let result: { acknowledgement: StoredSOPAcknowledgement; created: boolean } | undefined;

      tx.oncomplete = () => resolve(result!);
      tx.onerror = () => reject(tx.error || new Error('Speichern der SOP-Kenntnisnahme fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('SOP-Kenntnisnahme-Transaktion abgebrochen'));

      const existingRequest = store.index('acknowledgementKey').get(acknowledgementKey);
      existingRequest.onsuccess = () => {
        if (existingRequest.result) {
          const existing = existingRequest.result as StoredSOPAcknowledgement;
          result = { acknowledgement: existing, created: false };
          return;
        }
        store.add({ ...acknowledgement, acknowledgementKey });
        result = { acknowledgement, created: true };
      };
      existingRequest.onerror = () => tx.abort();
    });
  }

  async getSOPAcknowledgements(tenantId: string, userId: string): Promise<StoredSOPAcknowledgement[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('sopAcknowledgements', 'readonly');
      const request = tx.objectStore('sopAcknowledgements')
        .index('tenantUser')
        .getAll(IDBKeyRange.only([tenantId, userId]));

      request.onsuccess = () => resolve((request.result || []) as StoredSOPAcknowledgement[]);
      request.onerror = () => reject(request.error || new Error('Lesen der SOP-Kenntnahmen fehlgeschlagen'));
    });
  }

  async updateSOPAcknowledgement(
    clientMutationId: string,
    status: StoredSOPAcknowledgement['status']
  ): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('sopAcknowledgements', 'readwrite');
      const store = tx.objectStore('sopAcknowledgements');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Aktualisierung der SOP-Kenntnahme ${clientMutationId} fehlgeschlagen`));
      tx.onabort = () => reject(tx.error || new Error(`SOP-Kenntnahme-Transaktion ${clientMutationId} abgebrochen`));

      const request = store.get(clientMutationId);
      request.onsuccess = () => {
        if (!request.result) return;
        store.put({ ...request.result, status });
      };
      request.onerror = () => tx.abort();
    });
  }

  async removeSOPAcknowledgement(clientMutationId: string): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('sopAcknowledgements', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Löschen der SOP-Kenntnahme ${clientMutationId} fehlgeschlagen`));
      tx.onabort = () => reject(tx.error || new Error(`SOP-Kenntnahme-Transaktion ${clientMutationId} abgebrochen`));
      tx.objectStore('sopAcknowledgements').delete(clientMutationId);
    });
  }

  async enqueueAlarmMutation(
    mutation: Omit<StoredAlarmMutation, 'status' | 'updatedAt'>
  ): Promise<StoredAlarmMutation> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alarmMutations', 'readwrite');
      const store = tx.objectStore('alarmMutations');
      let result: StoredAlarmMutation;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Speichern der Alarmmutation fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Alarmmutation-Transaktion abgebrochen'));
      const existing = store.get(mutation.clientMutationId);
      existing.onsuccess = () => {
        if (existing.result) {
          result = existing.result as StoredAlarmMutation;
          return;
        }
        result = {
          ...mutation,
          status: 'pending',
          updatedAt: new Date().toISOString()
        };
        store.add(result);
      };
      existing.onerror = () => tx.abort();
    });
  }

  async getAlarmMutations(tenantId: string, userId: string): Promise<StoredAlarmMutation[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alarmMutations', 'readonly');
      const request = tx.objectStore('alarmMutations').index('tenantUser')
        .getAll(IDBKeyRange.only([tenantId, userId]));
      request.onsuccess = () => resolve((request.result || []) as StoredAlarmMutation[]);
      request.onerror = () => reject(request.error || new Error('Lesen der Alarmmutationen fehlgeschlagen'));
    });
  }

  async updateAlarmMutation(
    clientMutationId: string,
    updates: Partial<Pick<StoredAlarmMutation, 'status' | 'serverId' | 'errorMessage'>>
  ): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alarmMutations', 'readwrite');
      const store = tx.objectStore('alarmMutations');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Aktualisieren der Alarmmutation fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Alarmmutations-Transaktion abgebrochen'));
      const request = store.get(clientMutationId);
      request.onsuccess = () => {
        if (!request.result) {
          tx.abort();
          reject(new Error(`Alarmmutation ${clientMutationId} wurde nicht gefunden`));
          return;
        }
        store.put({ ...request.result, ...updates, updatedAt: new Date().toISOString() });
      };
      request.onerror = () => tx.abort();
    });
  }

  async saveEmergencyPlanCache(
    tenantId: string,
    userId: string,
    plans: any[],
    types: any[] = [],
    sites: any[] = []
  ): Promise<void> {
    const db = await this.init();
    const cache: StoredAlarmPlanCache = {
      cacheKey: `${tenantId}:${userId}`,
      tenantId,
      userId,
      plans: plans.map(plan => ({ ...plan, contacts: [] })),
      types,
      sites,
      cachedAt: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alarmPlanCache', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Speichern des Offline-Notfallplancaches fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Offline-Notfallplancache-Transaktion abgebrochen'));
      tx.objectStore('alarmPlanCache').put(cache);
    });
  }

  async getEmergencyPlanCache(tenantId: string, userId: string): Promise<StoredAlarmPlanCache | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('alarmPlanCache', 'readonly');
      const request = tx.objectStore('alarmPlanCache').get(`${tenantId}:${userId}`);
      request.onsuccess = () => resolve((request.result as StoredAlarmPlanCache) ?? null);
      request.onerror = () => reject(request.error || new Error('Lesen des Offline-Notfallplancaches fehlgeschlagen'));
    });
  }

  async savePatrolCheckpointCache(
    tenantId: string,
    userId: string,
    checkpoints: Array<Record<string, unknown>>,
    routes: Array<Record<string, unknown>> = []
  ): Promise<void> {
    const db = await this.init();
    const cache: StoredPatrolCheckpointCache = {
      cacheKey: `${tenantId}:${userId}`,
      tenantId,
      userId,
      checkpoints,
      routes,
      cachedAt: new Date().toISOString()
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patrolCheckpointCache', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Speichern der Kontrollpunkt-Offline-Daten fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Kontrollpunkt-Cache-Transaktion abgebrochen'));
      tx.objectStore('patrolCheckpointCache').put(cache);
    });
  }

  async getPatrolCheckpointCache(tenantId: string, userId: string): Promise<StoredPatrolCheckpointCache | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const request = db.transaction('patrolCheckpointCache', 'readonly')
        .objectStore('patrolCheckpointCache').get(`${tenantId}:${userId}`);
      request.onsuccess = () => resolve((request.result as StoredPatrolCheckpointCache) ?? null);
      request.onerror = () => reject(request.error || new Error('Lesen des Kontrollpunkt-Offline-Caches fehlgeschlagen'));
    });
  }

  async savePatrolRound(round: Omit<StoredPatrolRound, 'cacheKey'>): Promise<void> {
    const db = await this.init();
    const stored: StoredPatrolRound = {
      ...round,
      cacheKey: `${round.tenantId}:${round.userId}:${round.roundId}`
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patrolRounds', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Speichern des Offline-Kontrollgangs fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Offline-Kontrollgang-Transaktion abgebrochen'));
      tx.objectStore('patrolRounds').put(stored);
    });
  }

  async getPatrolRounds(tenantId: string, userId: string): Promise<StoredPatrolRound[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patrolRounds', 'readonly');
      const request = tx.objectStore('patrolRounds').index('tenantUser').getAll([tenantId, userId]);
      request.onsuccess = () => resolve((request.result as StoredPatrolRound[]) || []);
      request.onerror = () => reject(request.error || new Error('Lesen der Offline-Kontrollgänge fehlgeschlagen'));
    });
  }

  async deletePatrolRound(tenantId: string, userId: string, roundId: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patrolRounds', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Entfernen des Offline-Kontrollgangs fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Offline-Kontrollgang-Transaktion abgebrochen'));
      tx.objectStore('patrolRounds').delete(`${tenantId}:${userId}:${roundId}`);
    });
  }

  async markPatrolRoundSynced(tenantId: string, userId: string, roundId: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('patrolRounds', 'readwrite');
      const store = tx.objectStore('patrolRounds');
      const request = store.get(`${tenantId}:${userId}:${roundId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Aktualisieren des Offline-Kontrollgangs fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Offline-Kontrollgang-Transaktion abgebrochen'));
      request.onsuccess = () => {
        if (!request.result) return;
        store.put({ ...request.result, serverSynced: true });
      };
    });
  }

  async savePlanningCache(
    tenantId: string,
    userId: string,
    shifts: any[],
    periods: any[],
    range?: { from: string; to: string }
  ): Promise<void> {
    const db = await this.init();
    const cache: StoredPlanningCache = {
      cacheKey: `${tenantId}:${userId}`,
      tenantId,
      userId,
      shifts,
      periods,
      rangeFrom: range?.from,
      rangeTo: range?.to,
      cachedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction('planningCache', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Speichern des Offline-Dienstplancaches fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Offline-Dienstplancache-Transaktion abgebrochen'));
      tx.objectStore('planningCache').put(cache);
    });
  }

  async getPlanningCache(tenantId: string, userId: string): Promise<StoredPlanningCache | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('planningCache', 'readonly');
      const request = tx.objectStore('planningCache').get(`${tenantId}:${userId}`);
      request.onsuccess = () => resolve((request.result as StoredPlanningCache) ?? null);
      request.onerror = () => reject(request.error || new Error('Lesen des Offline-Dienstplancaches fehlgeschlagen'));
    });
  }

  async getStorageEstimates(): Promise<{ usageBytes: number; quotaBytes: number; percentage: number } | null> {
    if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') return null;
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.usage !== 'number' || typeof estimate.quota !== 'number' || estimate.quota <= 0) return null;
    return {
      usageBytes: estimate.usage,
      quotaBytes: estimate.quota,
      percentage: (estimate.usage / estimate.quota) * 100
    };
  }

  // --- ANHÄNGE & FOTODOKUMENTATION ---

  async saveAttachment(attachment: StoredAttachment): Promise<void> {
    const MAX_BYTES = 5 * 1024 * 1024;
    if (attachment.sizeBytes > MAX_BYTES) {
      throw new Error(`Dateigröße (${(attachment.sizeBytes / 1024 / 1024).toFixed(2)} MB) überschreitet das Limit von 5 MB.`);
    }

    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('attachments', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Speichern des Anhangs fehlgeschlagen'));
      tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen'));

      const store = tx.objectStore('attachments');
      store.put(attachment);
    });
  }
}

export const offlineVault = new IndexedDbService();
export const offlineStorage = offlineVault;
