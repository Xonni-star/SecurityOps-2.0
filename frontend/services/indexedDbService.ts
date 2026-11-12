// SecurityOps 2.0 - Zuverlässige Enterprise IndexedDB Storage Engine (Schritt 5R gehärtet)
// Wartet bei Schreiboperationen zwingend auf transaction.oncomplete.
// Behandelt transaction.onerror und transaction.onabort als echte Fehler. Keine verschluckten Fehler!

const DB_NAME = 'SecurityOps2_OfflineVault';
const DB_VERSION = 3;

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

  async getPendingOutbox(tenantId: string): Promise<OutboxMutation[]> {
    const db = await this.init();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const req = store.getAll();

      req.onsuccess = () => {
        const records = (req.result as OutboxMutation[]) || [];
        // Nur Einträge des jeweiligen Mandanten zurückliefern, die PENDING oder FAILED sind
        resolve(records.filter((r) => r.tenantId === tenantId && (r.status === 'PENDING' || r.status === 'FAILED')));
      };

      req.onerror = () => {
        reject(req.error || new Error('[INDEXEDDB FEHLER] Lesen der Outbox fehlgeschlagen'));
      };
    });
  }

  /**
   * Aktualisiert den Status einer Mutation in der Outbox erst nach Bestätigung.
   */
  async updateMutationStatus(
    id: string,
    status: OutboxMutation['status'],
    details?: { errorMessage?: string; conflictDetails?: OutboxMutation['conflictDetails'] }
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
        if (status === 'FAILED') record.retryCount += 1;
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
