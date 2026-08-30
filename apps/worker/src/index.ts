import { Hono, type Context } from "hono";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { OnboardingCommandRejectedError } from "@atharvan/auth";
import {
  parseRuntimeConfig,
  PlatformConfigurationRejectedError,
} from "@atharvan/config";
import {
  operatorHasCapability,
  unknownPlatformOverview,
  type AuthenticatedOperator,
  type MembershipDomainEntry,
  type ModelCapability,
  type ModelCatalogueLifecycle,
  type ModelDataClassification,
  type ModelKind,
  type ModelProviderAdapterKind,
  type ModelProviderCatalogue,
  type ModelProviderReportedHealth,
  type ModelRoutingControlState,
  type ModelRoutingControlTargetKind,
  type ModelRoutingDecision,
  type ModelRoutingOperations,
  type OperatorDirectoryEntry,
  type OperatorRoleDefinitionEntry,
  type PlatformConfigurationRegistry,
  type PlatformConfigurationScope,
  type PlatformSecretReferenceEntry,
} from "@atharvan/domain";
import {
  ModelCatalogueCommandRejectedError,
  ModelRoutingCommandRejectedError,
} from "@atharvan/models";
import {
  PlatformSecretCommandRejectedError,
  PlatformSecretProviderError,
} from "@atharvan/secrets";

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
  readonly CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID?: string;
  readonly CLOUDFLARE_SECRETS_STORE_ID?: string;
  readonly CLOUDFLARE_SECRETS_STORE_API_TOKEN?: string;
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
  listOperatorRoleDefinitions(): Promise<
    ReadonlyArray<OperatorRoleDefinitionEntry>
  >;
  listPlatformConfiguration(): Promise<PlatformConfigurationRegistry>;
  readonly secretProviderConfigured: boolean;
  listPlatformSecretReferences(): Promise<
    ReadonlyArray<PlatformSecretReferenceEntry>
  >;
  listModelCatalogue(): Promise<ModelProviderCatalogue>;
  listModelRoutingOperations(): Promise<ModelRoutingOperations>;
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
  replaceOperatorRoles(
    actor: AuthenticatedOperator,
    input: ReplaceOperatorRolesCommand,
  ): Promise<{
    readonly outcome: "updated" | "unchanged";
    readonly operatorId: string;
  }>;
  setPlatformConfiguration(
    actor: AuthenticatedOperator,
    input: SetPlatformConfigurationCommand,
  ): Promise<{
    readonly outcome: "updated" | "unchanged";
    readonly key: string;
    readonly revisionNumber?: number;
  }>;
  createPlatformSecret(
    actor: AuthenticatedOperator,
    input: CreatePlatformSecretCommand,
  ): Promise<{ readonly outcome: "created"; readonly id: string }>;
  rotatePlatformSecret(
    actor: AuthenticatedOperator,
    input: RotatePlatformSecretCommand,
  ): Promise<{ readonly outcome: "updated"; readonly id: string }>;
  revokePlatformSecret(
    actor: AuthenticatedOperator,
    input: RevokePlatformSecretCommand,
  ): Promise<{ readonly outcome: "updated"; readonly id: string }>;
  setModelProvider(
    actor: AuthenticatedOperator,
    input: SetModelProviderCommand,
  ): Promise<{
    readonly outcome: "created" | "updated" | "unchanged";
    readonly id: string;
    readonly revisionNumber: number;
  }>;
  setModel(
    actor: AuthenticatedOperator,
    input: SetModelCommand,
  ): Promise<{
    readonly outcome: "created" | "updated" | "unchanged";
    readonly id: string;
    readonly revisionNumber: number;
  }>;
  recordModelProviderHealth(
    actor: AuthenticatedOperator,
    input: RecordModelProviderHealthCommand,
  ): Promise<{ readonly outcome: "created"; readonly id: string }>;
  setModelRoutingPolicy(
    actor: AuthenticatedOperator,
    input: SetModelRoutingPolicyCommand,
  ): Promise<{
    readonly outcome: "created" | "updated" | "unchanged";
    readonly id: string;
    readonly revisionNumber: number;
  }>;
  setModelRoutingControl(
    actor: AuthenticatedOperator,
    input: SetModelRoutingControlCommand,
  ): Promise<{
    readonly outcome: "created" | "updated" | "unchanged";
    readonly id: string;
    readonly revisionNumber: number;
  }>;
  previewModelRoute(
    input: PreviewModelRouteCommand,
  ): Promise<ModelRoutingDecision>;
}

export interface SetModelRoutingPolicyCommand {
  readonly key: string;
  readonly displayName: string;
  readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly allowedRegions: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<{
    readonly modelId: string;
    readonly rolloutBasisPoints: number;
    readonly allowDegraded: boolean;
  }>;
  readonly reason: string;
  readonly correlationId: string;
}

export interface SetModelRoutingControlCommand {
  readonly targetKind: ModelRoutingControlTargetKind;
  readonly targetId: string;
  readonly state: ModelRoutingControlState;
  readonly maintenanceExpiresAt: string | null;
  readonly reason: string;
  readonly correlationId: string;
}

export interface PreviewModelRouteCommand {
  readonly policyKey: string;
  readonly stableRoutingKey: string;
  readonly requiredCapabilities: ReadonlyArray<ModelCapability>;
  readonly dataClassification: ModelDataClassification;
  readonly region: string;
}

export interface SetModelProviderCommand {
  readonly key: string;
  readonly displayName: string;
  readonly adapterKind: ModelProviderAdapterKind;
  readonly baseUrl: string | null;
  readonly credentialReferenceId?: string | null;
  readonly regions: ReadonlyArray<string>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly lifecycle: ModelCatalogueLifecycle;
  readonly reason: string;
  readonly correlationId: string;
}

export interface SetModelCommand {
  readonly providerId: string;
  readonly key: string;
  readonly displayName: string;
  readonly kind: ModelKind;
  readonly capabilities: ReadonlyArray<ModelCapability>;
  readonly contextWindowTokens: number;
  readonly maximumOutputTokens: number | null;
  readonly inputPriceMicrounitsPerMillion: number;
  readonly outputPriceMicrounitsPerMillion: number;
  readonly regions: ReadonlyArray<string>;
  readonly maximumDataClassification: ModelDataClassification;
  readonly lifecycle: ModelCatalogueLifecycle;
  readonly reason: string;
  readonly correlationId: string;
}

export interface RecordModelProviderHealthCommand {
  readonly providerId: string;
  readonly status: ModelProviderReportedHealth;
  readonly latencyMs: number | null;
  readonly httpStatusCode: number | null;
  readonly errorCode: string | null;
  readonly reason: string;
  readonly correlationId: string;
}

export interface CreatePlatformSecretCommand {
  readonly key: string;
  readonly purpose: string;
  readonly value: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface RotatePlatformSecretCommand {
  readonly referenceId: string;
  readonly value: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface RevokePlatformSecretCommand {
  readonly referenceId: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface OperatorInvitationCommand {
  readonly email: string;
  readonly organizationId: string;
  readonly roleKey: string;
  readonly reason: string;
  readonly approvalReference?: string;
  readonly correlationId: string;
}

export interface ReplaceOperatorRolesCommand {
  readonly targetOperatorId: string;
  readonly roleKeys: ReadonlyArray<string>;
  readonly reason: string;
  readonly correlationId: string;
}

export interface SetPlatformConfigurationCommand {
  readonly key: string;
  readonly scope: PlatformConfigurationScope;
  readonly value: unknown;
  readonly reason: string;
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
        roleKey: input.roleKey,
        reason: input.reason,
        ...(input.approvalReference === undefined
          ? {}
          : { approvalReference: input.approvalReference }),
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.get("/v1/platform/operator-roles", async (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:operators:read")
    ) {
      return capabilityRequired(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json({
      items: await runtime.listOperatorRoleDefinitions(),
    });
  });

  app.get("/v1/platform/configuration", async (context) => {
    if (
      !operatorHasCapability(
        context.get("operator"),
        "platform:configuration:read",
      )
    ) {
      return capabilityRequired(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json(await runtime.listPlatformConfiguration());
  });

  app.put("/v1/platform/configuration/:key", async (context) => {
    const input = await readJson(context, parseSetPlatformConfiguration);
    if (input === null) return invalidRequest(context);

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.setPlatformConfiguration(context.get("operator"), {
        ...input,
        key: context.req.param("key"),
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.get("/v1/platform/secret-references", async (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:secrets:read")
    ) {
      return capabilityRequired(context);
    }
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json({
      providerConfigured: runtime.secretProviderConfigured,
      items: await runtime.listPlatformSecretReferences(),
    });
  });

  app.post("/v1/platform/secret-references", async (context) => {
    const input = await readJson(context, parseCreatePlatformSecret);
    if (input === null) return invalidRequest(context);
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.createPlatformSecret(context.get("operator"), {
        ...input,
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.post(
    "/v1/platform/secret-references/:referenceId/rotate",
    async (context) => {
      const input = await readJson(context, parseRotatePlatformSecret);
      if (input === null) return invalidRequest(context);
      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.rotatePlatformSecret(context.get("operator"), {
          ...input,
          referenceId: context.req.param("referenceId"),
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.get("/v1/platform/model-routing", async (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:models:read")
    ) {
      return capabilityRequired(context);
    }
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json(await runtime.listModelRoutingOperations());
  });

  app.put("/v1/platform/model-routing/policies/:key", async (context) => {
    const input = await readJson(context, parseSetModelRoutingPolicy);
    if (input === null) return invalidRequest(context);
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.setModelRoutingPolicy(context.get("operator"), {
        ...input,
        key: context.req.param("key"),
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.put(
    "/v1/platform/model-routing/controls/:targetKind/:targetId",
    async (context) => {
      const targetKind = context.req.param("targetKind");
      const input = await readJson(context, parseSetModelRoutingControl);
      if (
        input === null ||
        (targetKind !== "provider" && targetKind !== "model")
      ) {
        return invalidRequest(context);
      }
      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.setModelRoutingControl(context.get("operator"), {
          ...input,
          targetKind,
          targetId: context.req.param("targetId"),
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.post("/v1/platform/model-routing/preview", async (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:models:read")
    ) {
      return capabilityRequired(context);
    }
    const input = await readJson(context, parsePreviewModelRoute);
    if (input === null) return invalidRequest(context);
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json(await runtime.previewModelRoute(input));
  });

  app.get("/v1/platform/model-catalogue", async (context) => {
    if (
      !operatorHasCapability(context.get("operator"), "platform:models:read")
    ) {
      return capabilityRequired(context);
    }
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return context.json(await runtime.listModelCatalogue());
  });

  app.put("/v1/platform/model-providers/:key", async (context) => {
    const input = await readJson(context, parseSetModelProvider);
    if (input === null) return invalidRequest(context);
    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.setModelProvider(context.get("operator"), {
        ...input,
        key: context.req.param("key"),
        correlationId: context.get("requestId"),
      }),
    );
  });

  app.put(
    "/v1/platform/model-providers/:providerId/models/:key",
    async (context) => {
      const input = await readJson(context, parseSetModel);
      if (input === null) return invalidRequest(context);
      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.setModel(context.get("operator"), {
          ...input,
          providerId: context.req.param("providerId"),
          key: context.req.param("key"),
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.post(
    "/v1/platform/model-providers/:providerId/health-observations",
    async (context) => {
      const input = await readJson(context, parseModelProviderHealth);
      if (input === null) return invalidRequest(context);
      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.recordModelProviderHealth(context.get("operator"), {
          ...input,
          providerId: context.req.param("providerId"),
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.post(
    "/v1/platform/secret-references/:referenceId/revoke",
    async (context) => {
      const input = await readJson(context, parseRevokePlatformSecret);
      if (input === null) return invalidRequest(context);
      const runtime = await dependencies.resolveAuthenticationRuntime(context);
      return executeCommand(context, () =>
        runtime.revokePlatformSecret(context.get("operator"), {
          referenceId: context.req.param("referenceId"),
          reason: input.reason,
          correlationId: context.get("requestId"),
        }),
      );
    },
  );

  app.put("/v1/platform/operators/:operatorId/roles", async (context) => {
    const input = await readJson(context, parseReplaceOperatorRoles);

    if (input === null) {
      return invalidRequest(context);
    }

    const runtime = await dependencies.resolveAuthenticationRuntime(context);
    return executeCommand(context, () =>
      runtime.replaceOperatorRoles(context.get("operator"), {
        ...input,
        targetOperatorId: context.req.param("operatorId"),
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
  const roleKey = readTrimmedString(value.roleKey, 64);
  const reason = readReason(value.reason);
  const approvalReference =
    value.approvalReference === undefined
      ? undefined
      : readTrimmedString(value.approvalReference, 200);

  if (
    email === null ||
    !email.includes("@") ||
    organizationId === null ||
    roleKey === null ||
    reason === null ||
    approvalReference === null
  ) {
    return null;
  }

  return {
    email,
    organizationId,
    roleKey,
    reason,
    ...(approvalReference === undefined ? {} : { approvalReference }),
  };
}

function parseReplaceOperatorRoles(
  value: unknown,
): Omit<
  ReplaceOperatorRolesCommand,
  "targetOperatorId" | "correlationId"
> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const roleKeys = value.roleKeys;

  if (
    reason === null ||
    !Array.isArray(roleKeys) ||
    roleKeys.length === 0 ||
    roleKeys.length > 10 ||
    roleKeys.some(
      (roleKey) =>
        typeof roleKey !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(roleKey),
    ) ||
    new Set(roleKeys).size !== roleKeys.length
  ) {
    return null;
  }

  return { roleKeys: roleKeys as ReadonlyArray<string>, reason };
}

function parseSetPlatformConfiguration(
  value: unknown,
): Omit<SetPlatformConfigurationCommand, "key" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const scope = value.scope;

  return reason !== null &&
    (scope === "platform" || scope === "environment") &&
    "value" in value
    ? { scope, value: value.value, reason }
    : null;
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

function parseCreatePlatformSecret(
  value: unknown,
): Omit<CreatePlatformSecretCommand, "correlationId"> | null {
  if (!isRecord(value)) return null;
  const key = readTrimmedString(value.key, 96);
  const purpose = readTrimmedString(value.purpose, 300);
  const reason = readReason(value.reason);
  const secretValue = readSecretMaterial(value.value);
  return key !== null &&
    purpose !== null &&
    purpose.length >= 8 &&
    reason !== null &&
    secretValue !== null
    ? { key, purpose, reason, value: secretValue }
    : null;
}

function parseRotatePlatformSecret(
  value: unknown,
): Omit<RotatePlatformSecretCommand, "referenceId" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const secretValue = readSecretMaterial(value.value);
  return reason !== null && secretValue !== null
    ? { reason, value: secretValue }
    : null;
}

function parseRevokePlatformSecret(
  value: unknown,
): { readonly reason: string } | null {
  if (!isRecord(value) || value.confirmation !== "REVOKE") return null;
  const reason = readReason(value.reason);
  return reason === null ? null : { reason };
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

function parseSetModelProvider(
  value: unknown,
): Omit<SetModelProviderCommand, "key" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const displayName = readTrimmedString(value.displayName, 120);
  const hasBaseUrl = value.baseUrl !== null && value.baseUrl !== undefined;
  const baseUrl = !hasBaseUrl ? null : readTrimmedString(value.baseUrl, 500);
  const hasCredentialReference = "credentialReferenceId" in value;
  const credentialReferenceId =
    !hasCredentialReference || value.credentialReferenceId === null
      ? null
      : readTrimmedString(value.credentialReferenceId, 36);
  const reason = readReason(value.reason);
  const regions = readStringArray(value.regions, 32, 32);
  const adapterKind = value.adapterKind;
  const maximumDataClassification = value.maximumDataClassification;
  const lifecycle = value.lifecycle;
  return displayName !== null &&
    (!hasBaseUrl || baseUrl !== null) &&
    (!hasCredentialReference ||
      value.credentialReferenceId === null ||
      credentialReferenceId !== null) &&
    reason !== null &&
    regions !== null &&
    isModelProviderAdapterKind(adapterKind) &&
    isModelDataClassification(maximumDataClassification) &&
    isModelCatalogueLifecycle(lifecycle)
    ? {
        displayName,
        adapterKind,
        baseUrl,
        ...(hasCredentialReference ? { credentialReferenceId } : {}),
        regions,
        maximumDataClassification,
        lifecycle,
        reason,
      }
    : null;
}

function parseSetModel(
  value: unknown,
): Omit<SetModelCommand, "providerId" | "key" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const displayName = readTrimmedString(value.displayName, 120);
  const capabilities = readStringArray(value.capabilities, 7, 32);
  const regions = readStringArray(value.regions, 32, 32);
  const reason = readReason(value.reason);
  const kind = value.kind;
  const maximumDataClassification = value.maximumDataClassification;
  const lifecycle = value.lifecycle;
  const maximumOutputTokens =
    value.maximumOutputTokens === null ? null : value.maximumOutputTokens;
  return displayName !== null &&
    capabilities !== null &&
    capabilities.every(isModelCapability) &&
    regions !== null &&
    reason !== null &&
    isModelKind(kind) &&
    isModelDataClassification(maximumDataClassification) &&
    isModelCatalogueLifecycle(lifecycle) &&
    typeof value.contextWindowTokens === "number" &&
    (maximumOutputTokens === null || typeof maximumOutputTokens === "number") &&
    typeof value.inputPriceMicrounitsPerMillion === "number" &&
    typeof value.outputPriceMicrounitsPerMillion === "number"
    ? {
        displayName,
        kind,
        capabilities: capabilities as ReadonlyArray<ModelCapability>,
        contextWindowTokens: value.contextWindowTokens,
        maximumOutputTokens,
        inputPriceMicrounitsPerMillion: value.inputPriceMicrounitsPerMillion,
        outputPriceMicrounitsPerMillion: value.outputPriceMicrounitsPerMillion,
        regions,
        maximumDataClassification,
        lifecycle,
        reason,
      }
    : null;
}

function parseModelProviderHealth(
  value: unknown,
): Omit<
  RecordModelProviderHealthCommand,
  "providerId" | "correlationId"
> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const latencyMs = value.latencyMs === null ? null : value.latencyMs;
  const httpStatusCode =
    value.httpStatusCode === null ? null : value.httpStatusCode;
  const errorCode =
    value.errorCode === null || value.errorCode === undefined
      ? null
      : readTrimmedString(value.errorCode, 96);
  return reason !== null &&
    (value.status === "healthy" ||
      value.status === "degraded" ||
      value.status === "unavailable") &&
    (latencyMs === null || typeof latencyMs === "number") &&
    (httpStatusCode === null || typeof httpStatusCode === "number") &&
    (errorCode !== null ||
      value.errorCode === null ||
      value.errorCode === undefined)
    ? {
        status: value.status,
        latencyMs,
        httpStatusCode,
        errorCode,
        reason,
      }
    : null;
}

function parseSetModelRoutingPolicy(
  value: unknown,
): Omit<SetModelRoutingPolicyCommand, "key" | "correlationId"> | null {
  if (!isRecord(value)) return null;
  const displayName = readTrimmedString(value.displayName, 120);
  const requiredCapabilities = readStringArray(
    value.requiredCapabilities,
    7,
    32,
  );
  const allowedRegions = readStringArray(value.allowedRegions, 32, 32);
  const maximumDataClassification = value.maximumDataClassification;
  const reason = readReason(value.reason);
  const targets = value.targets;
  if (
    displayName === null ||
    requiredCapabilities === null ||
    !requiredCapabilities.every(isModelCapability) ||
    allowedRegions === null ||
    !isModelDataClassification(maximumDataClassification) ||
    reason === null ||
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.length > 16
  ) {
    return null;
  }
  const parsedTargets = targets.map((target) => {
    if (!isRecord(target)) return null;
    const modelId = readTrimmedString(target.modelId, 36);
    return modelId !== null &&
      typeof target.rolloutBasisPoints === "number" &&
      (target.allowDegraded === undefined ||
        typeof target.allowDegraded === "boolean")
      ? {
          modelId,
          rolloutBasisPoints: target.rolloutBasisPoints,
          allowDegraded: target.allowDegraded ?? false,
        }
      : null;
  });
  return parsedTargets.some((target) => target === null)
    ? null
    : {
        displayName,
        requiredCapabilities:
          requiredCapabilities as ReadonlyArray<ModelCapability>,
        maximumDataClassification,
        allowedRegions,
        targets: parsedTargets as SetModelRoutingPolicyCommand["targets"],
        reason,
      };
}

function parseSetModelRoutingControl(
  value: unknown,
): Omit<
  SetModelRoutingControlCommand,
  "targetKind" | "targetId" | "correlationId"
> | null {
  if (!isRecord(value)) return null;
  const reason = readReason(value.reason);
  const state = value.state;
  const maintenanceExpiresAt =
    value.maintenanceExpiresAt === null ||
    value.maintenanceExpiresAt === undefined
      ? null
      : readTrimmedString(value.maintenanceExpiresAt, 40);
  return reason !== null &&
    (state === "enabled" || state === "maintenance" || state === "disabled") &&
    (maintenanceExpiresAt !== null ||
      value.maintenanceExpiresAt === null ||
      value.maintenanceExpiresAt === undefined)
    ? { state, maintenanceExpiresAt, reason }
    : null;
}

function parsePreviewModelRoute(
  value: unknown,
): PreviewModelRouteCommand | null {
  if (!isRecord(value)) return null;
  const policyKey = readTrimmedString(value.policyKey, 64);
  const stableRoutingKey = readTrimmedString(value.stableRoutingKey, 256);
  const region = readTrimmedString(value.region, 32);
  const dataClassification = value.dataClassification;
  const requiredCapabilities =
    value.requiredCapabilities === undefined
      ? []
      : readStringArray(value.requiredCapabilities, 7, 32);
  return policyKey !== null &&
    stableRoutingKey !== null &&
    region !== null &&
    requiredCapabilities !== null &&
    requiredCapabilities.every(isModelCapability) &&
    isModelDataClassification(dataClassification)
    ? {
        policyKey,
        stableRoutingKey,
        requiredCapabilities:
          requiredCapabilities as ReadonlyArray<ModelCapability>,
        dataClassification,
        region,
      }
    : null;
}

function readStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
): ReadonlyArray<string> | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximumItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.trim().length > maximumItemLength,
    )
  ) {
    return null;
  }
  return value as ReadonlyArray<string>;
}

function isModelProviderAdapterKind(
  value: unknown,
): value is ModelProviderAdapterKind {
  return (
    value === "openai" ||
    value === "anthropic" ||
    value === "google" ||
    value === "azure_openai" ||
    value === "openai_compatible" ||
    value === "self_hosted"
  );
}

function isModelDataClassification(
  value: unknown,
): value is ModelDataClassification {
  return (
    value === "public" ||
    value === "internal" ||
    value === "confidential" ||
    value === "restricted"
  );
}

function isModelCatalogueLifecycle(
  value: unknown,
): value is ModelCatalogueLifecycle {
  return value === "draft" || value === "active" || value === "deprecated";
}

function isModelKind(value: unknown): value is ModelKind {
  return value === "generation" || value === "embedding";
}

function isModelCapability(value: string): value is ModelCapability {
  return (
    value === "text_generation" ||
    value === "code_generation" ||
    value === "reasoning" ||
    value === "vision" ||
    value === "tool_use" ||
    value === "structured_output" ||
    value === "embeddings"
  );
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

function readSecretMaterial(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return new TextEncoder().encode(value).byteLength <= 1024 ? value : null;
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
    readonly outcome: "created" | "already_exists" | "updated" | "unchanged";
    readonly id?: string;
    readonly operatorId?: string;
    readonly key?: string;
    readonly revisionNumber?: number;
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
          message: "Sign in again before making this sensitive change.",
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

    if (error instanceof PlatformConfigurationRejectedError) {
      return context.json(
        {
          code: "configuration_change_rejected",
          reason: error.reason,
          message: "The requested configuration change was not accepted.",
          requestId: context.get("requestId"),
        },
        409,
      );
    }

    if (error instanceof PlatformSecretProviderError) {
      return context.json(
        {
          code: "secret_provider_unavailable",
          reason: error.reason,
          message:
            error.reason === "unconfigured"
              ? "The platform secret provider is not configured."
              : "The platform secret provider did not complete the request.",
          requestId: context.get("requestId"),
        },
        error.reason === "unconfigured" ? 503 : 502,
      );
    }

    if (error instanceof PlatformSecretCommandRejectedError) {
      return context.json(
        {
          code: "secret_change_rejected",
          reason: error.reason,
          message: "The requested secret lifecycle change was not accepted.",
          requestId: context.get("requestId"),
        },
        409,
      );
    }

    if (error instanceof ModelCatalogueCommandRejectedError) {
      return context.json(
        {
          code: "model_catalogue_change_rejected",
          reason: error.reason,
          message: "The requested model catalogue change was not accepted.",
          requestId: context.get("requestId"),
        },
        409,
      );
    }

    if (error instanceof ModelRoutingCommandRejectedError) {
      return context.json(
        {
          code: "model_routing_change_rejected",
          reason: error.reason,
          message: "The requested model routing change was not accepted.",
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
