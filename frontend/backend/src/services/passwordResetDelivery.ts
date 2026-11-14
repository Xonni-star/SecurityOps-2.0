export interface PasswordResetEmail {
  recipientEmail: string;
  recipientName: string;
  tenantId: string;
  token: string;
  expiresAt: string;
}

export interface PasswordResetDeliveryProvider {
  sendPasswordResetEmail(email: PasswordResetEmail): Promise<void>;
}

export class PasswordResetDeliveryError extends Error {
  constructor() {
    super('Password reset email delivery failed.');
    this.name = 'PasswordResetDeliveryError';
  }
}

let provider: PasswordResetDeliveryProvider | null = null;

export function configurePasswordResetDeliveryProvider(
  configuredProvider: PasswordResetDeliveryProvider | null
): void {
  provider = configuredProvider;
}

export function getPasswordResetDeliveryProvider(): PasswordResetDeliveryProvider | null {
  return provider;
}

export async function deliverPasswordResetEmail(
  configuredProvider: PasswordResetDeliveryProvider,
  email: PasswordResetEmail
): Promise<void> {
  try {
    await configuredProvider.sendPasswordResetEmail(email);
  } catch {
    throw new PasswordResetDeliveryError();
  }
}
