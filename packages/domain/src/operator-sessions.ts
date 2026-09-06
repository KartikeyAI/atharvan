/** Intrinsic self-service authority, granted only after active-operator authentication. */
export const ownSessionCapability = "platform:authentication:sessions:self";

export interface OperatorSessionIdentity {
  readonly userId: string;
  readonly sessionId: string;
}

export interface OperatorSessionEntry {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly authenticationMethod: "passkey" | "email_otp";
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

export interface OperatorSessionInventory {
  readonly items: ReadonlyArray<OperatorSessionEntry>;
  readonly truncated: boolean;
  readonly observedAt: string;
}

export interface RevokeOwnSessionInput extends OperatorSessionIdentity {
  readonly commandId?: string;
  readonly operatorId: string;
  readonly targetSessionId: string;
  readonly reason: string;
  readonly correlationId: string;
}
