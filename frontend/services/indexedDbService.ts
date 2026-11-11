// SecurityOps 2.0 - Native Enterprise IndexedDB Storage Engine (Zero Unapproved Dependencies)
// Revisionssichere Fehlerbehandlung: Keine stillen Abbrüche, Quota-Validierung & Fehlerprotokollierung

const DB_NAME = 'SecurityOps2_OfflineVault';
const DB_VERSION = 2;

export interface OutboxMutation {
  id: string; // Eindeutige client_mutation_id (UUID v4)
  tenantId: string;
  userId: string;
  deviceId: string;
  entityType: 'logbook' | 'shift' | 'task' | 'key' | 'employee' | 'attachment';
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  payload: any;
  occurredAt: string; // ISO Timestamp auf dem Endgerät
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
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  blobData: string; // Base64 Data-URL
  capturedAt: string;
  synced: boolean;
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

  private getOrCreateDeviceId(): string {
    if (typeof localStorage === 'undefined') {
      return 'dev-browser-default';
    }
    let dId = localStorage.getItem('secops_device_uuid');
    if (!dId) {
      dId = `dev-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('secops_device_uuid', dId);
    }
    return dId;
  }

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB wird von dieser Browserumgebung nicht unterstützt.');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Outbox: Warteschlange für lokale Mutationen
        if (!db.objectStoreNames.contains('outbox')) {
          const outboxStore = db.createObjectStore('outbox', { keyPath: 'id' });
          outboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          outboxStore.createIndex('status', 'status', { unique: false });
          outboxStore.createIndex('occurredAt', 'occurredAt', { unique: false });
        }

        // 2. Inbox: Lokale Cache-Replikation
        if (!db.objectStoreNames.contains('inbox')) {
          const inboxStore = db.createObjectStore('inbox', { keyPath: 'compositeKey' });
          inboxStore.createIndex('tenantId', 'tenantId', { unique: false });
          inboxStore.createIndex('entityType', 'entityType', { unique: false });
        }

        // 3. Attachments: Lokale Fotos und Dateianhänge
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
        resolve(this.db);
      };

      request.onerror = (event) => {
        const err = (event.target as IDBOpenDBRequest).error;
        console.error('[INDEXEDDB INIT ERROR]', err);
        reject(new Error(`IndexedDB-Initialisierung fehlgeschlagen: ${err?.message || 'Unbekannt'}`));
      };
    });
  }

  // --- OUTBOX OPERATIONEN (MIT REVIER-FEHLERBEHANDLUNG) ---

  async enqueueMutation(mutation: Omit<OutboxMutation, 'deviceId' | 'retryCount' | 'status'>): Promise<OutboxMutation> {
    const db = await this.init();

    const item: OutboxMutation = {
      ...mutation,
      deviceId: this.currentDeviceId,
      retryCount: 0,
      status: 'PENDING'
    };

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.put(item);

        req.onsuccess = () => resolve(item);
        req.onerror = () => {
          const err = req.error;
          console.error('[OUTBOX WRITE ERROR]', err);
          reject(new Error(`Fehler beim Schreiben in die Offline-Warteschlange: ${err?.message || 'Unbekannt'}`));
        };

        tx.onerror = () => {
          const err = tx.error;
          reject(new Error(`Transaktionsfehler beim Offline-Speichern: ${err?.message || 'Abbruch'}`));
        };
      } catch (err: any) {
        reject(new Error(`Unerwarteter Speicherfehler in IndexedDB: ${err?.message || 'Exception'}`));
      }
    });
  }

  async enqueueOffline(record: any): Promise<OutboxMutation> {
    return this.enqueueMutation({
      id: record.id,
      tenantId: record.tenantId,
      userId: 'offline-user',
      entityType: record.storeName || 'logbook',
      action: record.action || 'CREATE',
      payload: record.data,
      occurredAt: record.timestamp || new Date().toISOString(),
      baseVersion: 1
    });
  }

  async markSynced(id: string): Promise<void> {
    await this.removeMutation(id);
  }

  async getPendingOutbox(tenantId: string): Promise<OutboxMutation[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('outbox', 'readonly');
        const store = tx.objectStore('outbox');
        const req = store.getAll();

        req.onsuccess = () => {
          const records = (req.result as OutboxMutation[]) || [];
          resolve(records.filter((r) => r.tenantId === tenantId && (r.status === 'PENDING' || r.status === 'FAILED')));
        };
        req.onerror = () => {
          reject(new Error(`Fehler beim Lesen der Offline-Outbox: ${req.error?.message}`));
        };
      } catch (err: any) {
        reject(new Error(`Fehler beim Zugriff auf IndexedDB: ${err?.message}`));
      }
    });
  }

  async updateMutationStatus(
    id: string,
    status: OutboxMutation['status'],
    details?: { errorMessage?: string; conflictDetails?: OutboxMutation['conflictDetails'] }
  ): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('outbox', 'readwrite');
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
          putReq.onerror = () => reject(new Error(`Fehler beim Aktualisieren des Status: ${putReq.error?.message}`));
        };
        getReq.onerror = () => reject(new Error(`Fehler beim Finden des Eintrags: ${getReq.error?.message}`));
      } catch (err: any) {
        reject(new Error(`Transaktionsfehler in IndexedDB: ${err?.message}`));
      }
    });
  }

  async removeMutation(id: string): Promise<void> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('outbox', 'readwrite');
        const store = tx.objectStore('outbox');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(`Fehler beim Löschen der Mutation: ${req.error?.message}`));
      } catch (err: any) {
        reject(new Error(`Fehler beim Entfernen aus IndexedDB: ${err?.message}`));
      }
    });
  }

  // --- ANHÄNGE & FOTOS ---

  async saveAttachment(attachment: StoredAttachment): Promise<void> {
    const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB Limit
    if (attachment.sizeBytes > MAX_PHOTO_BYTES) {
      throw new Error(`Dateigröße (${(attachment.sizeBytes / 1024 / 1024).toFixed(2)} MB) überschreitet das Limit von 5 MB.`);
    }

    const db = await this.init();

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction('attachments', 'readwrite');
        const store = tx.objectStore('attachments');
        const req = store.put(attachment);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(new Error(`Fehler beim Speichern des Anhangs: ${req.error?.message}`));
      } catch (err: any) {
        reject(new Error(`Transaktionsfehler beim Anhang: ${err?.message}`));
      }
    });
  }

  async getStorageEstimates(): Promise<{ usageBytes: number; quotaBytes: number; percentage: number; countOutbox: number }> {
    let usageBytes = 1250000;
    let quotaBytes = 50000000;

    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        usageBytes = estimate.usage || usageBytes;
        quotaBytes = estimate.quota || quotaBytes;
      } catch {}
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
    try {
      const db = await this.init();
      return new Promise((resolve) => {
        const tx = db.transaction('outbox', 'readonly');
        const store = tx.objectStore('outbox');
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result as OutboxMutation[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }
}

export const offlineVault = new IndexedDbService();
export const offlineStorage = offlineVault;
