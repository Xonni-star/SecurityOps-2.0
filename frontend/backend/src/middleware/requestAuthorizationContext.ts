import { AsyncLocalStorage } from 'async_hooks';

interface RequestAuthorizationContext {
  userId: string;
  permissionCode: string;
}

const requestAuthorizationContext = new AsyncLocalStorage<RequestAuthorizationContext>();

export function runWithAuthorizationContext(
  userId: string,
  callback: () => void
): void {
  requestAuthorizationContext.run({ userId, permissionCode: '' }, callback);
}

export function setActivePermissionCode(permissionCode: string): void {
  const context = requestAuthorizationContext.getStore();
  if (context) context.permissionCode = permissionCode;
}

export function getRequestAuthorizationContext(): RequestAuthorizationContext | undefined {
  return requestAuthorizationContext.getStore();
}
