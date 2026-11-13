import { Application } from 'express';

export function configureTrustedProxies(app: Application, value: string): void {
  const trustedProxies = value.split(',').map((proxy) => proxy.trim()).filter(Boolean);
  app.set('trust proxy', trustedProxies.length > 0 ? trustedProxies : false);
}
