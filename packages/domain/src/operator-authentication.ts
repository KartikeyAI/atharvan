export type OperatorAuthenticationMethod = "email_otp" | "passkey";

export type OperatorAuthenticationAssuranceMode =
  "enrollment_required" | "passkey_verification_required" | "verified";

export interface OperatorAuthenticationAssurance {
  readonly mode: OperatorAuthenticationAssuranceMode;
  readonly strongAuthenticatorEnrolled: boolean;
  readonly authenticationMethod: OperatorAuthenticationMethod;
  readonly strongAuthenticationAt: string | null;
  readonly recentStepUp: boolean;
}
