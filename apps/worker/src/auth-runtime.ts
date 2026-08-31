import { drizzleAdapter } from "@better-auth/drizzle-adapter";

import { createPlatformAdapterRegistryService } from "@atharvan/adapters";
import {
  createAtharvanAuth,
  createOperatorBreakGlassAdministrationService,
  createOperatorOnboardingService,
  createOperatorRoleAdministrationService,
  OnboardingCommandRejectedError,
} from "@atharvan/auth";
import { createPlatformCommandService } from "@atharvan/commands";
import {
  createPlatformConfigurationAdministrationService,
  parseAuthenticationRuntimeConfig,
} from "@atharvan/config";
import { createCustomerDirectoryService } from "@atharvan/customers";
import {
  authDatabaseSchema,
  createNeonDatabase,
  createPostgresCustomerDirectoryStore,
  createPostgresOperatorOnboardingStore,
  createPostgresOperatorBreakGlassAdministrationStore,
  createPostgresOperatorRoleAdministrationStore,
  createPostgresOperatorSessionPolicyStore,
  createPostgresPlatformAdministrationReader,
  createPostgresPlatformCommandAuditStore,
  createPostgresPlatformAdapterRegistryStore,
  createPostgresPlatformConfigurationStore,
  createPostgresPlatformIntegrationRegistryStore,
  createPostgresPlatformFeatureFlagStore,
  createPostgresPlatformSecretStore,
  createPostgresModelCatalogueStore,
  createPostgresModelRoutingStore,
} from "@atharvan/db";
import { createPlatformFeatureFlagService } from "@atharvan/flags";
import {
  createResendTransactionalEmailSender,
  unconfiguredTransactionalEmailSender,
} from "@atharvan/email";
import { createPlatformIntegrationRegistryService } from "@atharvan/integrations";
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
  const breakGlassAdministrationService =
    createOperatorBreakGlassAdministrationService({
      store: createPostgresOperatorBreakGlassAdministrationStore(
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
  const integrationRegistryService = createPlatformIntegrationRegistryService({
    store: createPostgresPlatformIntegrationRegistryStore(
      databaseHandle.database,
    ),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const adapterRegistryService = createPlatformAdapterRegistryService({
    store: createPostgresPlatformAdapterRegistryStore(databaseHandle.database),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const featureFlagService = createPlatformFeatureFlagService({
    store: createPostgresPlatformFeatureFlagStore(databaseHandle.database),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const commandService = createPlatformCommandService({
    store: createPostgresPlatformCommandAuditStore(databaseHandle.database),
    environment: config.ATHARVAN_ENVIRONMENT,
  });
  const customerDirectoryService = createCustomerDirectoryService({
    store: createPostgresCustomerDirectoryStore(databaseHandle.database),
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
    passkeyOrigin: config.ATHARVAN_PUBLIC_ORIGIN,
    passkeyRpID: new URL(config.ATHARVAN_PUBLIC_ORIGIN).hostname,
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
        : {
            userId: session.user.id,
            createdAt: session.session.createdAt,
            authenticationMethod:
              session.session.authenticationMethod === "passkey"
                ? "passkey"
                : "email_otp",
            strongAuthenticationAt:
              session.session.strongAuthenticationAt ?? null,
          };
    },
    resolveActiveOperator: (authUserId) =>
      policyStore.resolveActiveOperator(authUserId),
    listOperators: () => administrationReader.listOperators(),
    listMembershipDomains: () => administrationReader.listMembershipDomains(),
    listOperatorRoleDefinitions: () =>
      administrationReader.listOperatorRoleDefinitions(),
    listOperatorBreakGlassGrants: () =>
      administrationReader.listOperatorBreakGlassGrants(),
    listPlatformConfiguration: () =>
      configurationStore.listConfiguration(config.ATHARVAN_ENVIRONMENT),
    listPlatformSecretReferences: () => secretLifecycleService.listReferences(),
    listModelCatalogue: () => modelCatalogueService.listCatalogue(),
    listModelRoutingOperations: () => modelRoutingService.listOperations(),
    listPlatformIntegrations: () => integrationRegistryService.listRegistry(),
    listPlatformAdapters: () => adapterRegistryService.listRegistry(),
    listPlatformFeatureFlags: () => featureFlagService.listFlags(),
    getCustomerDirectoryStatus: (actor) =>
      customerDirectoryService.getStatus(actor),
    searchCustomerDirectory: (actor, command) =>
      customerDirectoryService.search({ actor, ...command }),
    inspectCustomerDirectory: (actor, command) =>
      customerDirectoryService.inspect({ actor, ...command }),
    reconcileCustomerDirectorySnapshot: (actor, command) =>
      customerDirectoryService.reconcileSnapshot({ actor, ...command }),
    listCustomerRestrictions: (actor, command) =>
      customerDirectoryService.listRestrictions({ actor, ...command }),
    setCustomerRestriction: (actor, command) =>
      customerDirectoryService.setRestriction({ actor, ...command }),
    recordCustomerRestrictionObservation: (actor, command) =>
      customerDirectoryService.recordRestrictionObservation({
        actor,
        ...command,
      }),
    createCustomerInternalNote: (actor, command) =>
      customerDirectoryService.createInternalNote({ actor, ...command }),
    setCustomerRiskMarker: (actor, command) =>
      customerDirectoryService.setRiskMarker({ actor, ...command }),
    requestCustomerOwnershipTransfer: (actor, command) =>
      customerDirectoryService.requestOwnershipTransfer({ actor, ...command }),
    recordCustomerOwnershipTransferObservation: (actor, command) =>
      customerDirectoryService.recordOwnershipTransferObservation({
        actor,
        ...command,
      }),
    beginPlatformCommand: (command) => commandService.begin(command),
    completePlatformCommand: (command) => commandService.complete(command),
    listPlatformAuditEvents: (actor, query) =>
      commandService.listAuditEvents(actor, query),
    exportPlatformAuditEvents: (actor, query) =>
      commandService.exportAuditEvents(actor, query),
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
    createOperatorBreakGlassGrant: (actor, command) =>
      breakGlassAdministrationService.createGrant({ actor, ...command }),
    revokeOperatorBreakGlassGrant: (actor, command) =>
      breakGlassAdministrationService.revokeGrant({ actor, ...command }),
    reviewOperatorBreakGlassGrant: (actor, command) =>
      breakGlassAdministrationService.reviewGrant({ actor, ...command }),
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
    setPlatformIntegration: (actor, command) =>
      integrationRegistryService.setIntegration({ actor, ...command }),
    recordPlatformIntegrationHealth: (actor, command) =>
      integrationRegistryService.recordHealthObservation({
        actor,
        ...command,
      }),
    setPlatformAdapterRelease: (actor, command) =>
      adapterRegistryService.setRelease({ actor, ...command }),
    setPlatformFeatureFlag: (actor, command) =>
      featureFlagService.setFlag({ actor, ...command }),
    evaluatePlatformFeatureFlag: (key, command) =>
      featureFlagService.evaluate(key, command),
  };
}
