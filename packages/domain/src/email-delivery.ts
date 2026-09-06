/** Operational metadata only: no recipient address, OTP, auth identifier, or ciphertext. */
export interface EmailDeliveryEntry {
  readonly id: string;
  readonly operatorId: string;
  readonly state:
    | "pending"
    | "leased"
    | "accepted"
    | "delivered"
    | "bounced"
    | "complained"
    | "expired"
    | "cancelled"
    | "dead_letter";
  readonly attempts: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly nextAttemptAt: string;
  readonly updatedAt: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly templateVersion: "v1" | "v2";
  readonly templateLocale: "en" | "hi";
}
export interface EmailDeliveryPage {
  readonly items: readonly EmailDeliveryEntry[];
  readonly activeSuppressions: readonly EmailRecipientSuppressionEntry[];
  readonly truncated: boolean;
  readonly suppressionsTruncated: boolean;
  readonly observedAt: string;
  readonly providerConfigured: boolean;
  readonly feedbackConfigured: boolean;
  readonly canManage: boolean;
}

export interface EmailDeliveryHealth {
  readonly pending: number;
  readonly leased: number;
  readonly deadLetters: number;
  readonly expired: number;
  readonly bounced: number;
  readonly complained: number;
  readonly activeSuppressions: number;
  readonly oldestPendingAt: string | null;
  readonly observedAt: string;
}

export interface EmailRecipientSuppressionEntry {
  readonly id: string;
  readonly reason: "bounced" | "complained" | "failed" | "suppressed";
  readonly createdAt: string;
  readonly source:
    | { readonly kind: "verification"; readonly deliveryId: string }
    | { readonly kind: "operational_alert"; readonly deliveryId: string };
}

export interface ManageEmailDeliveryCommand {
  readonly commandId: string;
  readonly deliveryId: string;
  readonly action: "retry" | "cancel";
  readonly sessionId: string;
  readonly correlationId: string;
  readonly reason: string;
}

export interface RestoreEmailRecipientCommand {
  readonly commandId: string;
  readonly suppressionId: string;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly reason: string;
}
