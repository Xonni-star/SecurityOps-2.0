// SecurityOps 2.0 - Central Enterprise API Client
import { ResponseEnvelope } from '../types';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  errors?: string[];

  constructor(status: number, message: string, errors?: string[]) {
    super(message);
    this.status = status;
    this.errors = errors;
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
          envelope.errors
        );
      }

      return envelope.data as T;
    } catch (err: any) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(500, err?.message || 'Verbindung zum Backend-Server fehlgeschlagen.');
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
}

export const apiClient = new ApiClient();
