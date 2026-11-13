// SecurityOps 2.0 - Central Enterprise API Client
import { ResponseEnvelope } from '../types';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  errors?: string[];
  isNetworkError: boolean;
  code?: string;
  data?: unknown;

  constructor(
    status: number,
    message: string,
    errors?: string[],
    isNetworkError = false,
    code?: string,
    data?: unknown
  ) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.isNetworkError = isNetworkError;
    this.code = code;
    this.data = data;
  }
}

export interface RequestOptions extends RequestInit {
  tenantId?: string;
  skipAuth?: boolean;
}

class ApiClient {
  private currentTenantId: string = 'tenant-frankfurt';
  private csrfToken: string | null = null;

  constructor() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('secops_access_token');
        const storedTenant = localStorage.getItem('secops_tenant_id');
        if (storedTenant) {
          this.currentTenantId = storedTenant;
        }
      }
    } catch {
      // Fallback für Umgebungen mit gesperrtem localStorage
    }
  }

  setCsrfToken(token: string | null) { this.csrfToken = token; }

  setTenantId(tenantId: string) {
    this.currentTenantId = tenantId;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('secops_tenant_id', tenantId);
      }
    } catch {}
  }

  getTenantId(): string {
    return this.currentTenantId;
  }

  async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {})
    };

    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
      });

      if (response.status === 401) {
        this.csrfToken = null;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('securityops:unauthorized'));
      }

      const envelope: ResponseEnvelope = await response.json();
      const csrf = response.headers.get('x-csrf-token');
      if (csrf) this.csrfToken = csrf;
      if (!response.ok || !envelope.success) {
        throw new ApiError(
          response.status,
          envelope.message || 'API-Anfrage fehlgeschlagen',
          envelope.errors,
          false,
          envelope.code,
          envelope.data
        );
      }

      return envelope.data as T;
    } catch (err: any) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(500, err?.message || 'Verbindung zum Backend-Server fehlgeschlagen.', undefined, true);
    }
  }

  get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  patch<T>(endpoint: string, body: any, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }

  delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  uploadFile<T>(endpoint: string, file: File, onProgress?: (percent: number) => void): Promise<T> {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', url);
      request.withCredentials = true;
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      if (this.csrfToken) request.setRequestHeader('X-CSRF-Token', this.csrfToken);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      request.onerror = () => reject(new ApiError(500, 'Verbindung zum Backend-Server fehlgeschlagen.'));
      request.onload = () => {
        const csrf = request.getResponseHeader('x-csrf-token');
        if (csrf) this.csrfToken = csrf;
        if (request.status === 401 && typeof window !== 'undefined') {
          this.csrfToken = null;
          window.dispatchEvent(new Event('securityops:unauthorized'));
        }
        let envelope: ResponseEnvelope;
        try {
          envelope = JSON.parse(request.responseText) as ResponseEnvelope;
        } catch {
          reject(new ApiError(request.status || 500, 'Ungültige Antwort vom Backend.'));
          return;
        }
        if (request.status < 200 || request.status >= 300 || !envelope.success) {
          reject(new ApiError(request.status, envelope.message || 'Upload fehlgeschlagen', envelope.errors));
          return;
        }
        onProgress?.(100);
        resolve(envelope.data as T);
      };
      request.send(file);
    });
  }

  async downloadFile(endpoint: string): Promise<Blob> {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (response.status === 401) {
        this.csrfToken = null;
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('securityops:unauthorized'));
      }
      const csrf = response.headers.get('x-csrf-token');
      if (csrf) this.csrfToken = csrf;
      if (!response.ok) {
        const envelope = await response.json() as ResponseEnvelope;
        throw new ApiError(response.status, envelope.message || 'Download fehlgeschlagen', envelope.errors);
      }
      return await response.blob();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, error instanceof Error ? error.message : 'Download fehlgeschlagen.');
    }
  }
}

export const apiClient = new ApiClient();
