export interface FirstLoginVerificationMessage {
  readonly to: string;
  readonly code: string;
  readonly expiresAt: Date;
  readonly correlationId: string;
}

export interface TransactionalEmailReceipt {
  readonly providerMessageId: string;
  readonly acceptedAt: Date;
}

export interface TransactionalEmailSender {
  sendFirstLoginVerification(
    message: FirstLoginVerificationMessage,
  ): Promise<TransactionalEmailReceipt>;
}

export class EmailDeliveryNotConfiguredError extends Error {
  override readonly name = "EmailDeliveryNotConfiguredError";

  constructor() {
    super("Transactional email delivery is not configured.");
  }
}

export const unconfiguredTransactionalEmailSender: TransactionalEmailSender = {
  sendFirstLoginVerification() {
    return Promise.reject(new EmailDeliveryNotConfiguredError());
  },
};
