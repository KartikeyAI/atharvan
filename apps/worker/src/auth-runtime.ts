import { drizzleAdapter } from "@better-auth/drizzle-adapter";

import {
  createAtharvanAuth,
  createOperatorOnboardingService,
  createOperatorRoleAdministrationService,
  OnboardingCommandRejectedError,
} from "@atharvan/auth";
import {
  createPlatformConfigurationAdministrationService,
  parseAuthenticationRuntimeConfig,
} from "@atharvan/config";
import {
  authDatabaseSchema,
  createNeonDatabase,
  createPostgresOperatorOnboardingStore,
  createPostgresOperatorRoleAdministrationStore,
  createPostgresOperatorSessionPolicyStore,
  createPostgresPlatformAdministrationReader,
  createPostgresPlatformConfigurationStore,
  createPostgresPlatformSecretStore,
  createPostgresModelCatalogueStore,
  createPostgresModelRoutingStore,
} from "@atharvan/db";
import {
  createResendTransactionalEmailSender,
  unconfiguredTransactionalEmailSender,
} from "@atharvan/email";
import {
  createCloudflareSecretsStoreProvider,
  createPlatformSecretLifecycleService,
  unconfiguredPlatformSecretMaterialProvider,
} from "@atharvan/secrets";
import {
  createModelCatalogueService,
  createModelRoutingService,
} from "@atharvan/models";

import type { AuthenticationRuntime, RuntimeBindings } from "./index";

const runtimeCache = new WeakMap<
  object,
  Map<string, Promise<AuthenticationRuntime>>
>();

export function resolveProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
  readonly waitUntil: (operation: Promise<unknown>) => void;
}): Promise<AuthenticationRuntime> {
  const cacheKey = input.bindings as object;
  let originCache = runtimeCache.get(cacheKey);

  if (originCache === undefined) {
    originCache = new Map();
    runtimeCache.set(cacheKey, originCache);
  }

  let runtime = originCache.get(input.requestOrigin);

  if (runtime === undefined) {
    runtime = createProductionAuthenticationRuntime(input);
    originCache.set(input.requestOrigin, runtime);
  }

  return runtime;
}

async function createProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
  readonly waitUntil: (operation: Promise<unknown>) => void;
}): Promise<AuthenticationRuntime> {
  const config = parseAuthenticationRuntimeConfig(input.bindings);
  const databaseHandle = createNeonDatabase(config.DATABASE_URL);
  const onboardingStore = createPostgresOperatorOnboardingStore(
    databaseHandle.database,
  );
  const policyStore = createPostgresOperatorSessionPolicyStore(
    databaseHandle.database,
  );
  const administrationReader = createPostgresPlatformAdministrationReader(
    databaseHandle.database,
  );
  const roleAdministrationService = createOperatorRoleAdministrationService({
    store: createPostgresOperatorRoleAdministrationStore(
      databaseHandle.database,
    ),
  });
  const configurationStore = createPostgresPlatformConfigurationStore(
    databaseHandle.database,
  );
  const configurationAdministrationService =
    createPlatformConfigurationAdministrationService({
      store: configurationStore,
      environment: config.ATHARVAN_ENVIRONMENT,
    });
  const secretStore = createPostgresPlatformSecretStore(
    databaseHandle.database,
  );
  const secretMaterialProvider =
    config.CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID !== undefined &&
    config.CLOUDFLARE_SECRETS_STORE_ID !== undefined &&
    config.CLOUDFLARE_SECRETS_STORE_API_TOKEN !== undefined
      ? createCloudflareSecretsStoreProvider({
          accountId: config.CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID,
          storeId: config.CLOUDFLARE_SECRETS_STORE_ID,
          apiToken: config.CLOUDFLARE_SECRETS_STORE_API_TOKEN,
        })
      : unconfiguredPlatformSecretMaterialProvider;
  const secretLifecycleService = createPlatformSecretLifecycleService({
    store: secretStore,
    provider: secretMaterialProvider,
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const modelCatalogueService = createModelCatalogueService({
    store: createPostgresModelCatalogueStore(databaseHandle.database),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const modelRoutingService = createModelRoutingService({
    store: createPostgresModelRoutingStore(databaseHandle.database),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const resendApiKey = config.RESEND_API_KEY;
  const emailDeliveryConfigured = resendApiKey !== undefined;
  const emailSender = resendApiKey
    ? createResendTransactionalEmailSender({
        apiKey: resendApiKey,
        from: config.ATHARVAN_EMAIL_FROM,
      })
    : unconfiguredTransactionalEmailSender;

  const onboardingService = createOperatorOnboardingService({
    store: onboardingStore,
    emailSender,
    verificationHmacSecret: config.ATHARVAN_VERIFICATION_HMAC_SECRET,
  });

  await onboardingService.bootstrapSuperAdministrator({
    email: config.ATHARVAN_SUPER_ADMIN_EMAIL,
    reason: "Configured singleton Super Administrator bootstrap.",
  });

  const auth = createAtharvanAuth({
    database: drizzleAdapter(databaseHandle.database, {
      provider: "pg",
      schema: authDatabaseSchema,
      transaction: true,
    }),
    policyStore,
    emailSender,
    secret: config.BETTER_AUTH_SECRET,
    verificationHmacSecret: config.ATHARVAN_VERIFICATION_HMAC_SECRET,
    baseURL: input.requestOrigin,
    trustedOrigins: [config.ATHARVAN_PUBLIC_ORIGIN, input.requestOrigin],
    defer(operation) {
      input.waitUntil(
        operation.catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              event: "operator.verification_email.failed",
              errorName:
                error instanceof Error ? error.name : "UnknownDeliveryError",
            }),
          );
        }),
      );
    },
  });

  return {
    emailDeliveryConfigured,
    secretProviderConfigured: secretMaterialProvider.configured,
    handle: (request) => auth.handler(request),
    async getSession(headers) {
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true },
      });

      return session === null
        ? null
        : { userId: session.user.id, createdAt: session.session.createdAt };
    },
    resolveActiveOperator: (authUserId) =>
      policyStore.resolveActiveOperator(authUserId),
    listOperators: () => administrationReader.listOperators(),
    listMembershipDomains: () => administrationReader.listMembershipDomains(),
    listOperatorRoleDefinitions: () =>
      administrationReader.listOperatorRoleDefinitions(),
    listPlatformConfiguration: () =>
      configurationStore.listConfiguration(config.ATHARVAN_ENVIRONMENT),
    listPlatformSecretReferences: () => secretLifecycleService.listReferences(),
    listModelCatalogue: () => modelCatalogueService.listCatalogue(),
    listModelRoutingOperations: () => modelRoutingService.listOperations(),
    async createOperatorInvitation(actor, command) {
      const registry = await configurationStore.listConfiguration(
        config.ATHARVAN_ENVIRONMENT,
      );
      const signupMode = registry.items.find(
        (item) => item.key === "platform.signup.mode",
      );
      if (signupMode?.resolvedValue === "disabled") {
        throw new OnboardingCommandRejectedError("operator_signup_disabled");
      }
      const role = await administrationReader.findActiveOperatorRoleDefinition(
        command.roleKey,
      );

      if (role === null) {
        throw new OnboardingCommandRejectedError("role_not_found");
      }

      const invitationLifetime = registry.items.find(
        (item) => item.key === "operator.invitation.lifetime_hours",
      )?.resolvedValue;
      const invitationLifetimeHours =
        typeof invitationLifetime === "number" ? invitationLifetime : 24;

      const result = await onboardingService.createInvitation({
        actor,
        email: command.email,
        organizationId: command.organizationId,
        intendedCapabilities: role.capabilities,
        intendedRoleDefinitionId: role.definitionId,
        expiresAt: new Date(Date.now() + invitationLifetimeHours * 60 * 60_000),
        reason: command.reason,
        ...(command.approvalReference === undefined
          ? {}
          : { approvalReference: command.approvalReference }),
        correlationId: command.correlationId,
      });

      return { outcome: result.outcome, id: result.id };
    },
    addMembershipDomain: (actor, command) =>
      onboardingService.addAllowedEmailDomain({
        actor,
        domain: command.domain,
        includeSubdomains: command.includeSubdomains,
        isPublicDomainException: false,
        reason: command.reason,
        correlationId: command.correlationId,
      }),
    disableMembershipDomain: (actor, command) =>
      onboardingService.disableAllowedEmailDomain({
        actor,
        domain: command.domain,
        membershipLockdown: command.membershipLockdown,
        reason: command.reason,
        correlationId: command.correlationId,
      }),
    replaceOperatorRoles: (actor, command) =>
      roleAdministrationService.replaceOperatorRoles({
        actor,
        targetOperatorId: command.targetOperatorId,
        roleKeys: command.roleKeys,
        reason: command.reason,
        correlationId: command.correlationId,
      }),
    setPlatformConfiguration: (actor, command) =>
      configurationAdministrationService.setConfiguration({
        actor,
        key: command.key,
        scope: command.scope,
        value: command.value,
        reason: command.reason,
        correlationId: command.correlationId,
      }),
    createPlatformSecret: (actor, command) =>
      secretLifecycleService.create({ actor, ...command }),
    rotatePlatformSecret: (actor, command) =>
      secretLifecycleService.rotate({ actor, ...command }),
    revokePlatformSecret: (actor, command) =>
      secretLifecycleService.revoke({ actor, ...command }),
    setModelProvider: (actor, command) =>
      modelCatalogueService.setProvider({ actor, ...command }),
    setModel: (actor, command) =>
      modelCatalogueService.setModel({ actor, ...command }),
    recordModelProviderHealth: (actor, command) =>
      modelCatalogueService.recordHealthObservation({ actor, ...command }),
    setModelRoutingPolicy: (actor, command) =>
      modelRoutingService.setPolicy({ actor, ...command }),
    setModelRoutingControl: (actor, command) =>
      modelRoutingService.setControl({ actor, ...command }),
    previewModelRoute: (command) => modelRoutingService.previewRoute(command),
  };
}
