import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { waitUntil } from "cloudflare:workers";

import { createPlatformAdapterRegistryService } from "@atharvan/adapters";
import {
  createAtharvanAuth,
  createOperatorBreakGlassAdministrationService,
  createOperatorOnboardingService,
  createOperatorLifecycleService,
  createOperatorRoleAdministrationService,
  OnboardingCommandRejectedError,
  requirePasskeyUserVerification,
} from "@atharvan/auth";
import {
  createPlatformCommandService,
  createPlatformApprovalService,
} from "@atharvan/commands";
import {
  createBillingSubscriptionService,
  createCommercialCatalogueService,
  createEntitlementService,
  createStripeBillingProvider,
  unconfiguredBillingProvider,
} from "@atharvan/commercial";
import {
  createPlatformConfigurationAdministrationService,
  parseAuthenticationRuntimeConfig,
} from "@atharvan/config";
import { createCustomerDirectoryService } from "@atharvan/customers";
import {
  authDatabaseSchema,
  createNeonDatabase,
  runWithNeonDatabase,
  createPostgresOperatorSessions,
  createPostgresOperatorLifecycleStore,
  createPostgresPlatformApprovalStore,
  createPostgresPlatformOverviewReader,
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
  createPostgresCommercialCatalogueStore,
  createPostgresEntitlementStore,
  createPostgresBillingSubscriptionStore,
  createPostgresArthCommandExchange,
  createPostgresOperationalAlertDeliveryStore,
  createPostgresPlatformHealthProbeStore,
  createPostgresOperationalRetentionStore,
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
import { createEmailDeliveryRuntime } from "./email-delivery-runtime";

/** The HTTP context owns this runtime. Never retain its Neon sockets across requests. */
export function resolveProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
}): Promise<AuthenticationRuntime> {
  return createProductionAuthenticationRuntime(input);
}

async function createProductionAuthenticationRuntime(input: {
  readonly bindings: RuntimeBindings;
  readonly requestOrigin: string;
}): Promise<AuthenticationRuntime> {
  const config = parseAuthenticationRuntimeConfig(input.bindings);
  const databaseHandle = createNeonDatabase(config.DATABASE_URL);
  try {
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
    const operatorLifecycleService = createOperatorLifecycleService(
      createPostgresOperatorLifecycleStore(
        databaseHandle.database,
        config.ATHARVAN_ENVIRONMENT,
      ),
    );
    const breakGlassAdministrationService =
      createOperatorBreakGlassAdministrationService({
        store: createPostgresOperatorBreakGlassAdministrationStore(
          databaseHandle.database,
          config.ATHARVAN_ENVIRONMENT,
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
    const commercialCatalogueService = createCommercialCatalogueService({
      store: createPostgresCommercialCatalogueStore(databaseHandle.database),
      environment: config.ATHARVAN_ENVIRONMENT,
    });
    const entitlementService = createEntitlementService({
      store: createPostgresEntitlementStore(databaseHandle.database),
      environment: config.ATHARVAN_ENVIRONMENT,
    });
    const billingProvider = config.STRIPE_SECRET_KEY
      ? createStripeBillingProvider({ secretKey: config.STRIPE_SECRET_KEY })
      : unconfiguredBillingProvider;
    const billingSubscriptionService = createBillingSubscriptionService({
      store: createPostgresBillingSubscriptionStore(databaseHandle.database),
      provider: billingProvider,
      environment: config.ATHARVAN_ENVIRONMENT,
      publicOrigin: config.ATHARVAN_PUBLIC_ORIGIN,
    });
    const modelRoutingService = createModelRoutingService({
      store: createPostgresModelRoutingStore(databaseHandle.database),
      environment: config.ATHARVAN_ENVIRONMENT,
    });
    const integrationRegistryService = createPlatformIntegrationRegistryService(
      {
        store: createPostgresPlatformIntegrationRegistryStore(
          databaseHandle.database,
        ),
        environment: config.ATHARVAN_ENVIRONMENT,
      },
    );
    const adapterRegistryService = createPlatformAdapterRegistryService({
      store: createPostgresPlatformAdapterRegistryStore(
        databaseHandle.database,
      ),
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
    const approvalService = createPlatformApprovalService(
      createPostgresPlatformApprovalStore(databaseHandle.database),
      config.ATHARVAN_ENVIRONMENT,
    );
    const customerDirectoryService = createCustomerDirectoryService({
      store: createPostgresCustomerDirectoryStore(databaseHandle.database),
      environment: config.ATHARVAN_ENVIRONMENT,
    });
    const arthCommandExchange = createPostgresArthCommandExchange(
      databaseHandle.database,
      config.ATHARVAN_ENVIRONMENT,
    );
    const operationalAlertDelivery =
      createPostgresOperationalAlertDeliveryStore(databaseHandle.database);
    const platformHealthProbes = createPostgresPlatformHealthProbeStore(
      databaseHandle.database,
    );
    const operationalRetention = createPostgresOperationalRetentionStore(
      databaseHandle.database,
    );
    const resendApiKey = config.RESEND_API_KEY;
    const emailDelivery = createEmailDeliveryRuntime(
      databaseHandle.database,
      config,
    );
    const wakeDelivery = (id: string) =>
      waitUntil(
        runWithNeonDatabase(config.DATABASE_URL, async (database) => {
          await createEmailDeliveryRuntime(database, config).run(1, id);
        }).catch(() => {
          console.error(
            JSON.stringify({
              event: "email_delivery.wakeup_failed",
              deliveryId: id,
            }),
          );
        }),
      );
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

    try {
      await onboardingService.bootstrapSuperAdministrator({
        email: config.ATHARVAN_SUPER_ADMIN_EMAIL,
        reason: "Configured singleton Super Administrator bootstrap.",
      });
    } catch (error) {
      // Bootstrap cannot replace the owner recorded by a completed transfer.
      if (
        !(error instanceof OnboardingCommandRejectedError) ||
        error.reason !== "different_super_administrator_exists"
      )
        throw error;
    }

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
      async enqueueVerificationEmail(message) {
        let id: string | null;
        try {
          id = await emailDelivery.enqueue(message);
        } catch {
          throw new Error("verification_email_enqueue_failed");
        }
        if (id) wakeDelivery(id);
      },
    });

    return {
      arthWorkloadConfigured:
        config.ATHARVAN_ARTH_CURRENT_KEY_ID !== undefined &&
        config.ATHARVAN_ARTH_CURRENT_SHARED_SECRET !== undefined &&
        config.ATHARVAN_ARTH_AUDIENCE !== undefined,
      consumeArthWorkloadNonce: arthCommandExchange.consumeNonce,
      reconcileArthCustomerDirectorySnapshot: (command) =>
        customerDirectoryService.reconcileTrustedSnapshot(command),
      claimArthCommand: arthCommandExchange.claim,
      acknowledgeArthCommand: arthCommandExchange.acknowledge,
      readArthCommandDeliveryHealth: arthCommandExchange.readHealth,
      readOperationalAlertDeliveryHealth: () =>
        operationalAlertDelivery.health(config.ATHARVAN_ENVIRONMENT),
      readPlatformHealthProbeQueueHealth: () =>
        platformHealthProbes.health(config.ATHARVAN_ENVIRONMENT),
      readOperationalRetentionHealth: () =>
        operationalRetention.health(config.ATHARVAN_ENVIRONMENT),
      alertDeliveryConfigured:
        config.RESEND_API_KEY !== undefined &&
        config.ATHARVAN_ALERT_EMAIL_TO !== undefined,
      emailDeliveryConfigured,
      emailFeedbackConfigured: config.RESEND_WEBHOOK_SECRET !== undefined,
      listEmailDeliveries: emailDelivery.list,
      close: databaseHandle.close,
      readEmailDeliveryHealth: emailDelivery.health,
      async manageEmailDelivery(actor, command) {
        const result = await emailDelivery.manage(actor, command);
        if (command.action === "retry") wakeDelivery(command.deliveryId);
        return result;
      },
      restoreEmailRecipient: emailDelivery.restoreRecipient,
      listApprovals: (actor, correlationId) =>
        approvalService.list(actor, correlationId),
      requestApproval: (context, scope, reason) =>
        approvalService.request(context, scope, reason),
      decideApproval: (context, id, decision, reason) =>
        approvalService.decide(context, id, decision, reason),
      listOwnSessions: (identity) =>
        createPostgresOperatorSessions(
          databaseHandle.database,
          config.ATHARVAN_ENVIRONMENT,
        ).list(identity),
      revokeOwnSession: (input) =>
        createPostgresOperatorSessions(
          databaseHandle.database,
          config.ATHARVAN_ENVIRONMENT,
        ).revoke(input),
      secretProviderConfigured: secretMaterialProvider.configured,
      billingProviderConfigured: billingProvider.configured,
      async handle(request) {
        return requirePasskeyUserVerification(
          request,
          await auth.handler(request),
        );
      },
      async getSession(headers) {
        const session = await auth.api.getSession({
          headers,
          query: { disableCookieCache: true },
        });

        return session === null
          ? null
          : {
              userId: session.user.id,
              sessionId: session.session.id,
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
      readPlatformOverview: () =>
        createPostgresPlatformOverviewReader(databaseHandle.database).read(
          config.ATHARVAN_ENVIRONMENT,
        ),
      listOperators: () => administrationReader.listOperators(),
      listMembershipDomains: () => administrationReader.listMembershipDomains(),
      listOperatorRoleDefinitions: () =>
        administrationReader.listOperatorRoleDefinitions(),
      listOperatorBreakGlassGrants: () =>
        administrationReader.listOperatorBreakGlassGrants(),
      listPlatformConfiguration: () =>
        configurationStore.listConfiguration(config.ATHARVAN_ENVIRONMENT),
      listPlatformSecretReferences: () =>
        secretLifecycleService.listReferences(),
      listModelCatalogue: () => modelCatalogueService.listCatalogue(),
      listCommercialCatalogue: () => commercialCatalogueService.listCatalogue(),
      getPlanEntitlementSet: (planVersionId) =>
        entitlementService.getPlanEntitlementSet(planVersionId),
      getWorkspaceEntitlements: (workspaceId) =>
        entitlementService.getWorkspaceEntitlements(workspaceId),
      getWorkspaceBilling: (workspaceId) =>
        billingSubscriptionService.getWorkspaceBilling(workspaceId),
      startSubscriptionCheckout: (actor, command) =>
        billingSubscriptionService.startCheckout(actor, command),
      reconcileWorkspaceSubscription: (actor, command) =>
        billingSubscriptionService.requestReconciliation(actor, command),
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
        customerDirectoryService.requestOwnershipTransfer({
          actor,
          ...command,
        }),
      recordCustomerOwnershipTransferObservation: (actor, command) =>
        customerDirectoryService.recordOwnershipTransferObservation({
          actor,
          ...command,
        }),
      beginPlatformCommand: (command) => commandService.begin(command),
      completePlatformCommand: (command) => commandService.complete(command),
      listPlatformAuditEvents: (actor, query) =>
        commandService.listAuditEvents(actor, query),
      exportPlatformAuditEvents: (actor, query, correlationId) =>
        commandService.exportAuditEvents(actor, query, correlationId),
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
        const role =
          await administrationReader.findActiveOperatorRoleDefinition(
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
          commandId: command.commandId,
          commandEnvironment: config.ATHARVAN_ENVIRONMENT,
          email: command.email,
          organizationId: command.organizationId,
          intendedCapabilities: role.capabilities,
          intendedRoleDefinitionId: role.definitionId,
          expiresAt: new Date(
            Date.now() + invitationLifetimeHours * 60 * 60_000,
          ),
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
          commandId: command.commandId,
          commandEnvironment: config.ATHARVAN_ENVIRONMENT,
          domain: command.domain,
          includeSubdomains: command.includeSubdomains,
          isPublicDomainException: false,
          reason: command.reason,
          correlationId: command.correlationId,
        }),
      disableMembershipDomain: (actor, command) =>
        onboardingService.disableAllowedEmailDomain({
          actor,
          commandId: command.commandId,
          commandEnvironment: config.ATHARVAN_ENVIRONMENT,
          domain: command.domain,
          membershipLockdown: command.membershipLockdown,
          reason: command.reason,
          correlationId: command.correlationId,
        }),
      replaceOperatorRoles: (actor, command) =>
        roleAdministrationService.replaceOperatorRoles({
          actor,
          commandId: command.commandId,
          commandEnvironment: config.ATHARVAN_ENVIRONMENT,
          targetOperatorId: command.targetOperatorId,
          roleKeys: command.roleKeys,
          reason: command.reason,
          correlationId: command.correlationId,
        }),
      changeOperatorStatus: (actor, command) =>
        operatorLifecycleService.changeStatus(actor, command),
      transferPlatformOwnership: (actor, command) =>
        operatorLifecycleService.transferOwnership(actor, command),
      createOperatorBreakGlassGrant: (actor, command) =>
        breakGlassAdministrationService.createGrant({ actor, ...command }),
      revokeOperatorBreakGlassGrant: (actor, command) =>
        breakGlassAdministrationService.revokeGrant({ actor, ...command }),
      reviewOperatorBreakGlassGrant: (actor, command) =>
        breakGlassAdministrationService.reviewGrant({ actor, ...command }),
      setPlatformConfiguration: (actor, command) =>
        configurationAdministrationService.setConfiguration({
          actor,
          commandId: command.commandId,
          key: command.key,
          scope: command.scope,
          value: command.value,
          reason: command.reason,
          correlationId: command.correlationId,
        }),
      rollbackPlatformConfiguration: (actor, command) =>
        configurationAdministrationService.rollbackConfiguration({
          actor,
          commandId: command.commandId,
          key: command.key,
          scope: command.scope,
          targetRevisionNumber: command.targetRevisionNumber,
          confirmation: command.confirmation,
          reason: command.reason,
          correlationId: command.correlationId,
        }),
      createPlatformSecret: (actor, command) =>
        secretLifecycleService.create({ actor, ...command }),
      retryPlatformSecretProvisioning: (actor, command) =>
        secretLifecycleService.retryProvisioning({ actor, ...command }),
      rotatePlatformSecret: (actor, command) =>
        secretLifecycleService.rotate({ actor, ...command }),
      revokePlatformSecret: (actor, command) =>
        secretLifecycleService.revoke({ actor, ...command }),
      setModelProvider: (actor, command) =>
        modelCatalogueService.setProvider({ actor, ...command }),
      setModel: (actor, command) =>
        modelCatalogueService.setModel({ actor, ...command }),
      setCommercialProduct: (actor, command) =>
        commercialCatalogueService.setProduct(actor, command),
      setCommercialPlanVersion: (actor, command) =>
        commercialCatalogueService.setPlanVersion(actor, command),
      sealPlanEntitlementSet: (actor, command) =>
        entitlementService.sealPlanEntitlementSet(actor, command),
      assignWorkspacePlan: (actor, command) =>
        entitlementService.assignWorkspacePlan(actor, command),
      setEnterpriseEntitlementGrant: (actor, command) =>
        entitlementService.setEnterpriseGrant(actor, command),
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
  } catch (error) {
    await databaseHandle.close().catch(() => undefined);
    throw error;
  }
}
