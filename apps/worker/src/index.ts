import { Hono, type Context } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { OnboardingCommandRejectedError } from "@atharvan/auth";
import { parseRuntimeConfig } from "@atharvan/config";
import {
  delegablePlatformCapabilities,
  operatorHasCapability,
  unknownPlatformOverview,
  type AuthenticatedOperator,
  type MembershipDomainEntry,
  type OperatorDirectoryEntry,
} from "@atharvan/domain";

import { resolveProductionAuthenticationRuntime } from "./auth-runtime";

export interface RuntimeBindings {
  readonly ATHARVAN_ENVIRONMENT: "development" | "production" | "test";
  readonly ATHARVAN_PUBLIC_ORIGIN: string;
  readonly DATABASE_URL?: string;
  readonly BETTER_AUTH_SECRET?: string;
  readonly ATHARVAN_VERIFICATION_HMAC_SECRET?: string;
  readonly ATHARVAN_SUPER_ADMIN_EMAIL?: string;
  readonly ATHARVAN_EMAIL_FROM?: string;
  readonly RESEND_API_KEY?: string;
}

export interface AuthenticationRuntime {
  readonly emailDeliveryConfigured: boolean;
  handle(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<{
    readonly userId: string;
    readonly createdAt: Date;
  } | null>;
  resolveActiveOperator(
    authUserId: string,
  ): Promise<AuthenticatedOperator | null>;
  listOperators(): Promise<ReadonlyArray<OperatorDirectoryEntry>>;
  listMembershipDomains(): Promise<ReadonlyArray<MembershipDomainEntry>>;
  createOperatorInvitation(
    actor: AuthenticatedOperator,
    input: OperatorInvitationCommand,
  ): Promise<{
    readonly outcome: "created" | "already_exists";
    readonly id: string;
  }>;
  addMembershipDomain(
    actor: AuthenticatedOperator,
    input: MembershipDomainCommand,
  ): Promise<{
    readonly outcome: "created" | "already_exists";
    readonly id: string;
  }>;
  disableMembershipDomain(
    actor: AuthenticatedOperator,
    input: DisableMembershipDomainCommand,
  ): Promise<{
    readonly outcome: "created" | "already_exists";
    readonly id: string;
  }>;
}

export interface OperatorInvitationCommand {
  readonly email: string;
  readonly organizationId: string;
  readonly intendedCapabilities: ReadonlyArray<string>;
  readonly reason: string;
  readonly approvalReference?: string;
  readonly correlationId: string;
}

export interface MembershipDomainCommand {
  readonly domain: string;
  readonly includeSubdomains: boolean;
  readonly reason: string;
  readonly correlationId: string;
}

export interface DisableMembershipDomainCommand {
  readonly domain: string;
  readonly membershipLockdown: boolean;
  readonly reason: string;
  readonly correlationId: string;
}

type AppEnvironment = {
  Bindings: RuntimeBindings;
  Variables: { operator: AuthenticatedOperator };
};

export interface AppDependencies {
  resolveAuthenticationRuntime(
    context: Context<AppEnvironment>,
  ): Promise<AuthenticationRuntime>;
}

const defaultDependencies: AppDependencies = {
  resolveAuthenticationRuntime(context) {
    const requestOrigin = new URL(context.req.url).origin;

    return resolveProductionAuthenticationRuntime({
      bindings: context.env,
      requestOrigin,
      waitUntil: (operation) => context.executionCtx.waitUntil(operation),
    });
  },
};

export function createApp(
  dependencies: AppDependencies = defaultDependencies,
): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>();

  app.use("*", requestId());
  app.use("*", secureHeaders());

  app.get("/health/live", (context) => {
    return context.json({
      service: "atharvan-control-plane",
      status: "alive",
      requestId: context.get("requestId"),
    });
  });

  app.get("/health/ready", (context) => {
    const config = parseRuntimeConfig(context.env);

    return context.json(
      {
        service: "atharvan-control-plane",
        status: "ready",
        environment: config.ATHARVAN_ENVIRONMENT,
        requestId: context.get("requestId"),
      },
      200,
    );
  });

  app.all("/api/auth/*", async (context) => {
    const runtime = await dependencies.resolveAuthenticationRuntime(context);

    if (
      !runtime.emailDeliveryConfigured &&
      context.req.path === "/api/auth/email-otp/send-verification-otp"
    ) {
      return context.json(
        {
          code: "email_delivery_unavailable",
          message: "Operator verification email delivery is not configured.",
          requestId: context.get("requestId"),
        },
        503,
      );
    }

    return runtime.handle(context.req.raw);
  });

  app.use("/v1/platform/*", async (context, next) => {
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    const session = await runtime.getSession(context.req.raw.headers);

    if (session === null) {
      return context.json(
        {
          code: "authentication_required",
          message: "An active Atharvan operator session is required.",
          requestId: context.get("requestId"),
        },
        401,
      );
    }

    const operator = await runtime.resolveActiveOperator(session.userId);

    if (operator === null) {
      return context.json(
        {
          code: "operator_access_denied",
          message: "The operator account is not active.",
          requestId: context.get("requestId"),
        },
        403,
      );
    }

    const freshSessionProof =
      Date.now() - session.createdAt.getTime() <= 5 * 60 * 1_000
        ? session.createdAt
        : undefined;

    context.set("operator", {
      ...operator,
      ...(freshSessionProof === undefined
        ? {}
        : { stepUpVerifiedAt: freshSessionProof }),
    });
    await next();
  });

  app.get("/v1/platform/overview", (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:overview:read")
    ) {
      return context.json(
        {
          code: "operator_capability_required",
          message: "The operator lacks the required platform capability.",
          requestId: context.get("requestId"),
        },
        403,
      );
    }

    return context.json(unknownPlatformOverview);
  });

  app.get("/v1/platform/operators", async (context) => {
    const operator = context.get("operator");

    if (!operatorHasCapability(operator, "platform:operators:read")) {
      return capabilityRequired(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json({ items: await runtime.listOperators() });
  });

  app.post("/v1/platform/operators/invitations", async (context) => {
    const operator = context.get("operator");

    if (!operatorHasCapability(operator, "platform:operators:invite")) {
      return capabilityRequired(context);
    }

    const input = await readJson(context, parseOperatorInvitation);

    if (input === null) {
      return invalidRequest(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.createOperatorInvitation(operator, {
        email: input.email,
        organizationId: input.organizationId,
        intendedCapabilities: input.intendedCapabilities,
        reason: input.reason,
        ...(input.approvalReference === undefined
          ? {}
          : { approvalReference: input.approvalReference }),
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.get("/v1/platform/membership-domains", async (context) => {
    const operator = context.get("operator");

    if (!operatorHasCapability(operator, "platform:membership-domains:read")) {
      return capabilityRequired(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json({ items: await runtime.listMembershipDomains() });
  });

  app.post("/v1/platform/membership-domains", async (context) => {
    const input = await readJson(context, parseMembershipDomain);

    if (input === null) {
      return invalidRequest(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.addMembershipDomain(context.get("operator"), {
        ...input,
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.post(
    "/v1/platform/membership-domains/:domain/disable",
    async (context) => {
      const input = await readJson(context, parseDisableMembershipDomain);

      if (input === null) {
        return invalidRequest(context);
      }

      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.disableMembershipDomain(context.get("operator"), {
          ...input,
          domain: context.req.param("domain"),
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.notFound((context) => {
    return context.json(
      {
        code: "not_found",
        message: "The requested Atharvan route does not exist.",
        requestId: context.get("requestId"),
      },
      404,
    );
  });

  app.onError((error, context) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "request.failed",
        requestId: context.get("requestId"),
        errorName: error.name,
      }),
    );

    return context.json(
      {
        code: "internal_error",
        message: "Atharvan could not complete the request.",
        requestId: context.get("requestId"),
      },
      500,
    );
  });

  return app;
}

async function readJson<Result>(
  context: Context<AppEnvironment>,
  parse: (value: unknown) => Result | null,
): Promise<Result | null> {
  try {
    const body: unknown = await context.req.json();
    return parse(body);
  } catch {
    return null;
  }
}

function parseOperatorInvitation(
  value: unknown,
): Omit<OperatorInvitationCommand, "correlationId"> | null {
  if (!isRecord(value)) return null;
  const email = readTrimmedString(value.email, 254);
  const organizationId = readTrimmedString(value.organizationId, 100);
  const reason = readReason(value.reason);
  const capabilities = value.intendedCapabilities;
  const approvalReference =
    value.approvalReference === undefined
      ? undefined
      : readTrimmedString(value.approvalReference, 200);

  if (
    email === null ||
    !email.includes("@") ||
    organizationId === null ||
    reason === null ||
    approvalReference === null ||
    !Array.isArray(capabilities) ||
    capabilities.length === 0 ||
    capabilities.length > delegablePlatformCapabilities.length ||
    capabilities.some(
      (capability) =>
        typeof capability !== "string" ||
        !delegablePlatformCapabilities.includes(
          capability as (typeof delegablePlatformCapabilities)[number],
        ),
    ) ||
    new Set(capabilities).size !== capabilities.length
  ) {
    return null;
  }

  return {
    email,
    organizationId,
    intendedCapabilities: capabilities as ReadonlyArray<string>,
    reason,
    ...(approvalReference === undefined ? {} : { approvalReference }),
  };
}

function parseMembershipDomain(
  value: unknown,
): Omit<MembershipDomainCommand, "correlationId"> | null {
  if (!isRecord(value)) return null;
  const domain = readTrimmedString(value.domain, 253);
  const reason = readReason(value.reason);
  const includeSubdomains = value.includeSubdomains ?? false;

  return domain !== null &&
    domain.length >= 3 &&
    reason !== null &&
    typeof includeSubdomains === "boolean"
    ? { domain, includeSubdomains, reason }
    : null;
}

function parseDisableMembershipDomain(
  value: unknown,
): Omit<DisableMembershipDomainCommand, "domain" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const membershipLockdown = value.membershipLockdown ?? false;

  return reason !== null && typeof membershipLockdown === "boolean"
    ? { membershipLockdown, reason }
    : null;
}

function readReason(value: unknown): string | null {
  const reason = readTrimmedString(value, 500);
  return reason !== null && reason.length >= 8 ? reason : null;
}

function readTrimmedString(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(context: Context<AppEnvironment>) {
  return context.json(
    {
      code: "invalid_request",
      message: "The request body is invalid.",
      requestId: context.get("requestId"),
    },
    400,
  );
}

function capabilityRequired(context: Context<AppEnvironment>) {
  return context.json(
    {
      code: "operator_capability_required",
      message: "The operator lacks the required platform capability.",
      requestId: context.get("requestId"),
    },
    403,
  );
}

async function executeCommand(
  context: Context<AppEnvironment>,
  command: () => Promise<{
    readonly outcome: "created" | "already_exists";
    readonly id: string;
  }>,
) {
  try {
    const result = await command();
    return context.json(result, result.outcome === "created" ? 201 : 200);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";

    if (reason === "recent_step_up_required") {
      return context.json(
        {
          code: reason,
          message: "Sign in again before changing organization domains.",
          requestId: context.get("requestId"),
        },
        403,
      );
    }

    if (reason === "operator_command_forbidden") {
      return capabilityRequired(context);
    }

    if (error instanceof OnboardingCommandRejectedError) {
      return context.json(
        {
          code: "command_rejected",
          reason: error.reason,
          message: "The requested administrative change was not accepted.",
          requestId: context.get("requestId"),
        },
        409,
      );
    }

    if (
      reason.startsWith("invalid_") ||
      reason.endsWith("_required") ||
      reason === "verification_secret_too_short"
    ) {
      return invalidRequest(context);
    }

    throw error;
  }
}

export const app = createApp();

export default app;
