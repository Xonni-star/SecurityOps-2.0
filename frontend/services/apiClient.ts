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
  private token: string | null = null;
  private currentTenantId: string = '11111111-1111-1111-1111-111111111111';

  constructor() {
    this.token = localStorage.getItem('secops_access_token');
    const storedTenant = localStorage.getItem('secops_tenant_id');
    if (storedTenant) {
      this.currentTenantId = storedTenant;
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('secops_access_token', token);
    } else {
      localStorage.removeItem('secops_access_token');
    }
  }

  setTenantId(tenantId: string) {
    this.currentTenantId = tenantId;
    localStorage.setItem('secops_tenant_id', tenantId);
  }

  getToken(): string | null {
    return this.token;
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

    if (!options.skipAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        console.warn('[API 401] Sitzung ungültig oder abgelaufen.');
      }

      const envelope: ResponseEnvelope = await response.json();
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
}

export const apiClient = new ApiClient();
