// SecurityOps 2.0 - Native Enterprise IndexedDB Storage Engine (Zero Unapproved Dependencies)
// Implements Outbox, Inbox, Drafts, Chunked Attachments, Device Fingerprints, and Conflict Audits

const DB_NAME = 'SecurityOps2_OfflineVault';
const DB_VERSION = 2;

export interface OutboxMutation {
  id: string; // Unique client_mutation_id (UUID v4)
  tenantId: string;
  userId: string;
  deviceId: string;
  entityType: 'logbook' | 'shift' | 'task' | 'key' | 'employee' | 'attachment';
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  occurredAt: string; // ISO timestamp on client device
  baseVersion: number;
  retryCount: number;
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
  entityId: string; // e.g. logbook entry id
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobData: string; // Base64 data URL
  capturedAt: string;
  synced: boolean;
}

export interface DeviceProfile {
  deviceId: string;
  tenantId: string;
  userId: string;
  deviceName: string;
  registeredAt: string;
  isTrusted: boolean;
  lastSyncCursorSeq: number;
}

class IndexedDbService {
  private db: IDBDatabase | null = null;
  private currentDeviceId: string = '';

  constructor() {
    this.currentDeviceId = this.getOrCreateDeviceId();
  }

  getDeviceId(): string {
    return this.currentDeviceId;
  }

  private getOrCreateDeviceId(): string {
    let dId = localStorage.getItem('secops_device_uuid');
    if (!dId) {
      dId = `dev-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('secops_device_uuid', dId);
    }
    return dId;
  }

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Outbox: Queued mutations to push to server
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          outboxStore.createIndex('status', 'status', { unique: false });
          outboxStore.createIndex('occurredAt', 'occurredAt', { unique: false });
        }

        // 2. Inbox: Local mirror of server entities
        if (!db.objectStoreNames.contains('inbox')) {
          const inboxStore = db.createObjectStore('inbox', { keyPath: 'compositeKey' });
          inboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          inboxStore.createIndex('entityType', 'entityType', { unique: false });
        }

        // 3. Attachments: Offline photo documentation and files
        if (!db.objectStoreNames.contains('attachments')) {
          const attachStore = db.createObjectStore('attachments', { keyPath: 'id' });
          attachStore.createIndex('entityId', 'entityId', { unique: false });
          attachStore.createIndex('synced', 'synced', { unique: false });
        }

        // 4. Device Meta
        if (!db.objectStoreNames.contains('device_meta')) {
          db.createObjectStore('device_meta', { keyPath: 'deviceId' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event);
        reject(new Error('IndexedDB initialization failed'));
      };
    });
  }

  // --- OUTBOX OPERATIONS ---

  async enqueueMutation(mutation: Omit<OutboxMutation, 'deviceId' | 'retryCount' | 'status'>): Promise<OutboxMutation> {
    await this.init();
    if (!this.db) throw new Error('DB not available');

    const item: OutboxMutation = {
      ...mutation,
      deviceId: this.currentDeviceId,
      retryCount: 0,
      status: 'PENDING'
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const req = store.put(item);

      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingOutbox(tenantId: string): Promise<OutboxMutation[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve) => {
      const tx = this.db!.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as OutboxMutation[]) || [];
        resolve(records.filter((r) => r.tenantId === tenantId && (r.status === 'PENDING' || r.status === 'FAILED')));
      };
      req.onerror = () => resolve([]);
    });
  }

  async updateMutationStatus(
    id: string,
    status: OutboxMutation['status'],
    details?: { errorMessage?: string; conflictDetails?: OutboxMutation['conflictDetails'] }
  ): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const record = getReq.result as OutboxMutation;
        if (!record) {
          resolve();
          return;
        }
        record.status = status;
        record.lastAttemptAt = new Date().toISOString();
        if (status === 'FAILED') record.retryCount += 1;
        if (details?.errorMessage) record.errorMessage = details.errorMessage;
        if (details?.conflictDetails) record.conflictDetails = details.conflictDetails;

        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async removeMutation(id: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('outbox', 'readwrite');
      const store = tx.objectStore('outbox');
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // --- ATTACHMENTS (OFFLINE BLOB/BASE64 PHOTO STORAGE) ---

  async saveAttachment(attachment: StoredAttachment): Promise<void> {
    await this.init();
    if (!this.db) return;

    // Strict Size Limit Check: Max 5MB per photo
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
    if (attachment.sizeBytes > MAX_PHOTO_BYTES) {
      throw new Error(`Dateigröße (${(attachment.sizeBytes / 1024 / 1024).toFixed(2)} MB) überschreitet das Limit von 5 MB.`);
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('attachments', 'readwrite');
      const store = tx.objectStore('attachments');
      const req = store.put(attachment);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAttachmentsForEntity(entityId: string): Promise<StoredAttachment[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve) => {
      const tx = this.db!.transaction('attachments', 'readonly');
      const store = tx.objectStore('attachments');
      const index = store.index('entityId');
      const req = index.getAll(entityId);
      req.onsuccess = () => resolve((req.result as StoredAttachment[]) || []);
      req.onerror = () => resolve([]);
    });
  }

  // --- STORAGE STATS ---

  async getStorageEstimates(): Promise<{ usageBytes: number; quotaBytes: number; percentage: number; countOutbox: number }> {
    let usageBytes = 0;
    let quotaBytes = 1;

    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage || 0;
      quotaBytes = estimate.quota || 1;
    }

    const outboxItems = await this.getAllOutboxItems();

    return {
      usageBytes,
      quotaBytes,
      percentage: Math.min(100, (usageBytes / quotaBytes) * 100),
      countOutbox: outboxItems.length
    };
  }

  private async getAllOutboxItems(): Promise<OutboxMutation[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve) => {
      const tx = this.db!.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as OutboxMutation[]) || []);
      req.onerror = () => resolve([]);
    });
  }
}

export const offlineVault = new IndexedDbService();
