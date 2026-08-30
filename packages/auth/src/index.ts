import {
  assertDelegableOperatorCapabilities,
  assertPlatformCommandAuthorized,
  digestVerificationCode,
  generateVerificationCode,
  getOperatorEmailDomain,
  normalizeOperatorEmail,
  normalizeOrganizationDomain,
  platformCapabilityWildcard,
  verifyVerificationCode,
  type AuthenticatedOperator,
} from "@atharvan/domain";
import type { TransactionalEmailSender } from "@atharvan/email";
import {
  betterAuth,
  type BetterAuthOptions,
  type Session,
  type User,
} from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";

import { OnboardingCommandRejectedError } from "./errors";

const defaultInvitationLifetimeMs = 24 * 60 * 60 * 1_000;
const defaultVerificationLifetimeMs = 10 * 60 * 1_000;
const defaultMaximumVerificationAttempts = 5;
const betterAuthOtpLifetimeSeconds = 10 * 60;

export type StoreCommandResult =
  | { readonly outcome: "created"; readonly id: string }
  | { readonly outcome: "already_exists"; readonly id: string }
  | {
      readonly outcome: "rejected";
      readonly reason:
        | "different_super_administrator_exists"
        | "domain_not_allowed"
        | "domain_already_active"
        | "domain_not_active"
        | "last_active_domain"
        | "operator_already_active"
        | "invitation_already_pending";
    };

export interface VerificationAttemptContext {
  readonly challengeId: string;
  readonly codeDigest: string;
}

export interface OperatorOnboardingStore {
  bootstrapSuperAdministrator(input: {
    readonly operatorId: string;
    readonly normalizedEmail: string;
    readonly emailDomain: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<StoreCommandResult>;

  addAllowedEmailDomain(input: {
    readonly actorId: string;
    readonly domainId: string;
    readonly normalizedDomain: string;
    readonly includeSubdomains: boolean;
    readonly isPublicDomainException: boolean;
    readonly correlationId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<StoreCommandResult>;

  disableAllowedEmailDomain(input: {
    readonly actorId: string;
    readonly normalizedDomain: string;
    readonly membershipLockdown: boolean;
    readonly correlationId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<StoreCommandResult>;

  createInvitation(input: {
    readonly actorId: string;
    readonly operatorId: string;
    readonly invitationId: string;
    readonly normalizedEmail: string;
    readonly emailDomain: string;
    readonly organizationId: string;
    readonly intendedCapabilities: ReadonlyArray<string>;
    readonly intendedRoleDefinitionId?: string;
    readonly tokenFingerprint: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly approvalReference?: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<StoreCommandResult>;

  prepareVerificationChallenge(input: {
    readonly challengeId: string;
    readonly normalizedEmail: string;
    readonly codeDigest: string;
    readonly maximumAttempts: number;
    readonly correlationId: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<
    | {
        readonly prepared: true;
        readonly email: string;
        readonly correlationId: string;
      }
    | { readonly prepared: false }
  >;

  recordVerificationDelivery(input: {
    readonly challengeId: string;
    readonly providerMessageId: string;
  }): Promise<void>;

  abandonVerificationChallenge(input: {
    readonly challengeId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;

  findVerificationAttemptContext(
    normalizedEmail: string,
  ): Promise<VerificationAttemptContext | null>;

  recordFailedVerification(input: {
    readonly challengeId: string;
    readonly expectedDigest: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;

  activateVerifiedOperator(input: {
    readonly challengeId: string;
    readonly expectedDigest: string;
    readonly normalizedEmail: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<boolean>;
}

export interface OperatorSessionPolicyStore {
  canIssueSignInOtp(input: {
    readonly normalizedEmail: string;
    readonly now: Date;
  }): Promise<boolean>;

  activateOperatorForAuthUser(input: {
    readonly authUserId: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<AuthenticatedOperator | null>;

  resolveActiveOperator(
    authUserId: string,
  ): Promise<AuthenticatedOperator | null>;
}

export interface AtharvanAuthOptions {
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly policyStore: OperatorSessionPolicyStore;
  readonly emailSender: TransactionalEmailSender;
  readonly secret: string;
  readonly verificationHmacSecret: string;
  readonly baseURL: string;
  readonly trustedOrigins: ReadonlyArray<string>;
  readonly now?: () => Date;
  readonly defer?: (operation: Promise<void>) => void;
}

export function createAtharvanAuth(options: AtharvanAuthOptions) {
  const now = options.now ?? (() => new Date());

  return betterAuth({
    appName: "Atharvan",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    database: options.database,
    trustedOrigins: [...options.trustedOrigins],
    emailAndPassword: { enabled: false },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 8 * 60 * 60,
      updateAge: 60 * 60,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 20,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "atharvan",
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
        disableIpTracking: false,
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: betterAuthOtpLifetimeSeconds,
        allowedAttempts: 5,
        disableSignUp: false,
        resendStrategy: "rotate",
        storeOTP: {
          hash: (otp) =>
            digestBetterAuthOtp(otp, options.verificationHmacSecret),
        },
        async sendVerificationOTP(data) {
          if (data.type !== "sign-in") {
            return;
          }

          const delivery = options.emailSender
            .sendFirstLoginVerification({
              to: normalizeOperatorEmail(data.email),
              code: data.otp,
              expiresAt: new Date(
                now().getTime() + betterAuthOtpLifetimeSeconds * 1_000,
              ),
              correlationId: crypto.randomUUID(),
            })
            .then(() => undefined);

          if (options.defer) {
            options.defer(delivery);
            return;
          }

          await delivery;
        },
      }),
    ],
    disabledPaths: [
      "/email-otp/check-verification-otp",
      "/email-otp/verify-email",
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
      "/sign-up/email",
      "/sign-in/email",
      "/change-email",
      "/change-password",
      "/set-password",
      "/delete-user",
      "/update-user",
    ],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/email-otp/send-verification-otp") {
          return;
        }

        const request = readOtpRequest(context.body);

        if (request === null) {
          return context.json({ success: true });
        }

        const eligible = await options.policyStore.canIssueSignInOtp({
          normalizedEmail: request.email,
          now: now(),
        });

        if (!eligible) {
          return context.json({ success: true });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user: User & Record<string, unknown>) => {
            let normalizedEmail: string;

            try {
              normalizedEmail = normalizeOperatorEmail(user.email);
            } catch {
              return false;
            }

            return options.policyStore.canIssueSignInOtp({
              normalizedEmail,
              now: now(),
            });
          },
        },
      },
      session: {
        create: {
          before: async (session: Session & Record<string, unknown>) => {
            const operator =
              await options.policyStore.activateOperatorForAuthUser({
                authUserId: session.userId,
                correlationId: crypto.randomUUID(),
                now: now(),
              });

            return operator !== null;
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

export async function digestBetterAuthOtp(
  otp: string,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`atharvan:better-auth:email-otp:${otp}`),
  );

  return encodeBase64Url(new Uint8Array(digest));
}

function readOtpRequest(body: unknown): { readonly email: string } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const candidate = body as {
    readonly email?: unknown;
    readonly type?: unknown;
  };

  if (candidate.type !== "sign-in" || typeof candidate.email !== "string") {
    return null;
  }

  try {
    return { email: normalizeOperatorEmail(candidate.email) };
  } catch {
    return null;
  }
}

export interface OperatorOnboardingServiceOptions {
  readonly store: OperatorOnboardingStore;
  readonly emailSender: TransactionalEmailSender;
  readonly verificationHmacSecret: string;
  readonly now?: () => Date;
}

export function createOperatorOnboardingService(
  options: OperatorOnboardingServiceOptions,
) {
  const now = options.now ?? (() => new Date());

  return {
    async bootstrapSuperAdministrator(input: {
      readonly email: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const normalizedEmail = normalizeOperatorEmail(input.email);
      const commandTime = now();
      const result = await options.store.bootstrapSuperAdministrator({
        operatorId: crypto.randomUUID(),
        normalizedEmail,
        emailDomain: getOperatorEmailDomain(normalizedEmail),
        correlationId: input.correlationId ?? crypto.randomUUID(),
        reason: requireReason(input.reason),
        now: commandTime,
      });

      return requireAcceptedResult(result);
    },

    async addAllowedEmailDomain(input: {
      readonly actor: AuthenticatedOperator;
      readonly domain: string;
      readonly includeSubdomains?: boolean;
      readonly isPublicDomainException?: boolean;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorizeMembershipDomainChange(input.actor, commandTime);
      const result = await options.store.addAllowedEmailDomain({
        actorId: input.actor.operatorId,
        domainId: crypto.randomUUID(),
        normalizedDomain: normalizeOrganizationDomain(input.domain),
        includeSubdomains: input.includeSubdomains ?? false,
        isPublicDomainException: input.isPublicDomainException ?? false,
        correlationId: input.correlationId ?? crypto.randomUUID(),
        reason: requireReason(input.reason),
        now: commandTime,
      });

      return requireAcceptedResult(result);
    },

    async disableAllowedEmailDomain(input: {
      readonly actor: AuthenticatedOperator;
      readonly domain: string;
      readonly membershipLockdown?: boolean;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorizeMembershipDomainChange(input.actor, commandTime);
      const result = await options.store.disableAllowedEmailDomain({
        actorId: input.actor.operatorId,
        normalizedDomain: normalizeOrganizationDomain(input.domain),
        membershipLockdown: input.membershipLockdown ?? false,
        correlationId: input.correlationId ?? crypto.randomUUID(),
        reason: requireReason(input.reason),
        now: commandTime,
      });

      return requireAcceptedResult(result);
    },

    async createInvitation(input: {
      readonly actor: AuthenticatedOperator;
      readonly email: string;
      readonly organizationId: string;
      readonly intendedCapabilities: ReadonlyArray<string>;
      readonly intendedRoleDefinitionId?: string;
      readonly reason: string;
      readonly approvalReference?: string;
      readonly expiresAt?: Date;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: input.actor,
        requestedCapability: "platform:operators:invite",
      });
      assertDelegableOperatorCapabilities(input.intendedCapabilities);

      const normalizedEmail = normalizeOperatorEmail(input.email);
      const invitationToken = generateOpaqueToken();
      const expiresAt =
        input.expiresAt ??
        new Date(commandTime.getTime() + defaultInvitationLifetimeMs);

      if (expiresAt.getTime() <= commandTime.getTime()) {
        throw new OnboardingCommandRejectedError(
          "invitation_expiry_must_be_future",
        );
      }

      const result = await options.store.createInvitation({
        actorId: input.actor.operatorId,
        operatorId: crypto.randomUUID(),
        invitationId: crypto.randomUUID(),
        normalizedEmail,
        emailDomain: getOperatorEmailDomain(normalizedEmail),
        organizationId: requireNonEmpty(
          input.organizationId,
          "organization_id_required",
        ),
        intendedCapabilities: [...input.intendedCapabilities],
        ...(input.intendedRoleDefinitionId === undefined
          ? {}
          : { intendedRoleDefinitionId: input.intendedRoleDefinitionId }),
        tokenFingerprint: await digestOpaqueToken(invitationToken),
        correlationId: input.correlationId ?? crypto.randomUUID(),
        reason: requireReason(input.reason),
        ...(input.approvalReference === undefined
          ? {}
          : { approvalReference: input.approvalReference }),
        expiresAt,
        now: commandTime,
      });

      const accepted = requireAcceptedResult(result);
      return { ...accepted, invitationToken };
    },

    async requestFirstLoginVerification(input: { readonly email: string }) {
      let normalizedEmail: string;

      try {
        normalizedEmail = normalizeOperatorEmail(input.email);
      } catch {
        return genericVerificationRequestResult;
      }

      const commandTime = now();
      const challengeId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();
      const code = generateVerificationCode();
      const codeDigest = await digestVerificationCode({
        code,
        challengeId,
        secret: options.verificationHmacSecret,
      });
      const expiresAt = new Date(
        commandTime.getTime() + defaultVerificationLifetimeMs,
      );
      const prepared = await options.store.prepareVerificationChallenge({
        challengeId,
        normalizedEmail,
        codeDigest,
        maximumAttempts: defaultMaximumVerificationAttempts,
        correlationId,
        expiresAt,
        now: commandTime,
      });

      if (!prepared.prepared) {
        return genericVerificationRequestResult;
      }

      try {
        const receipt = await options.emailSender.sendFirstLoginVerification({
          to: prepared.email,
          code,
          expiresAt,
          correlationId: prepared.correlationId,
        });
        await options.store.recordVerificationDelivery({
          challengeId,
          providerMessageId: receipt.providerMessageId,
        });
      } catch {
        await options.store.abandonVerificationChallenge({
          challengeId,
          correlationId,
          now: now(),
        });
      }

      return genericVerificationRequestResult;
    },

    async verifyAndActivate(input: {
      readonly email: string;
      readonly code: string;
      readonly correlationId?: string;
    }) {
      let normalizedEmail: string;

      try {
        normalizedEmail = normalizeOperatorEmail(input.email);
      } catch {
        return invalidVerificationResult;
      }

      const context =
        await options.store.findVerificationAttemptContext(normalizedEmail);

      if (context === null) {
        return invalidVerificationResult;
      }

      const correlationId = input.correlationId ?? crypto.randomUUID();
      const commandTime = now();
      const verified = await verifyVerificationCode({
        code: input.code,
        challengeId: context.challengeId,
        secret: options.verificationHmacSecret,
        expectedDigest: context.codeDigest,
      });

      if (!verified) {
        await options.store.recordFailedVerification({
          challengeId: context.challengeId,
          expectedDigest: context.codeDigest,
          correlationId,
          now: commandTime,
        });
        return invalidVerificationResult;
      }

      const activated = await options.store.activateVerifiedOperator({
        challengeId: context.challengeId,
        expectedDigest: context.codeDigest,
        normalizedEmail,
        correlationId,
        now: commandTime,
      });

      return activated ? activationSucceededResult : invalidVerificationResult;
    },
  };
}

const genericVerificationRequestResult = Object.freeze({ accepted: true });
const invalidVerificationResult = Object.freeze({
  activated: false,
  reason: "invalid_or_expired_verification" as const,
});
const activationSucceededResult = Object.freeze({ activated: true });

function authorizeMembershipDomainChange(
  actor: AuthenticatedOperator,
  now: Date,
): void {
  assertPlatformCommandAuthorized({
    actor,
    requestedCapability: "platform:membership-domains:write",
    requireSuperAdministrator: true,
    requireRecentStepUp: true,
    now,
  });
}

function requireAcceptedResult(result: StoreCommandResult) {
  if (result.outcome === "rejected") {
    throw new OnboardingCommandRejectedError(result.reason);
  }

  return result;
}

function requireReason(reason: string): string {
  return requireNonEmpty(reason, "command_reason_required");
}

function requireNonEmpty(value: string, error: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new OnboardingCommandRejectedError(error);
  }

  return normalized;
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

async function digestOpaqueToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export { platformCapabilityWildcard };
export * from "./errors";
export * from "./operator-roles";
