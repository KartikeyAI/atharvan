import {
  createOperatorBreakGlassAdministrationService,
  createOperatorOnboardingService,
} from "@atharvan/auth";
import { createPlatformAdapterRegistryService } from "@atharvan/adapters";
import { createPlatformConfigurationAdministrationService } from "@atharvan/config";
import { createPlatformCommandService } from "@atharvan/commands";
import { createCustomerDirectoryService } from "@atharvan/customers";
import type { AuthenticatedOperator } from "@atharvan/domain";
import { createPlatformFeatureFlagService } from "@atharvan/flags";
import { createPlatformIntegrationRegistryService } from "@atharvan/integrations";
import {
  createModelCatalogueService,
  createModelRoutingService,
} from "@atharvan/models";
import { createPlatformSecretLifecycleService } from "@atharvan/secrets";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createPostgresOperatorOnboardingStore } from "./operator-onboarding-store";
import { createPostgresOperatorBreakGlassAdministrationStore } from "./operator-break-glass-store";
import { createPostgresPlatformCommandAuditStore } from "./platform-command-audit-store";
import { createPostgresCustomerDirectoryStore } from "./customer-directory-store";
import { createPostgresOperatorSessionPolicyStore } from "./operator-session-policy-store";
import { createPostgresModelCatalogueStore } from "./model-catalogue-store";
import { createPostgresModelRoutingStore } from "./model-routing-store";
import { createPostgresPlatformConfigurationStore } from "./platform-configuration-store";
import { createPostgresPlatformIntegrationRegistryStore } from "./platform-integration-store";
import { createPostgresPlatformFeatureFlagStore } from "./platform-feature-flag-store";
import { createPostgresPlatformAdapterRegistryStore } from "./platform-adapter-store";
import { createPostgresPlatformSecretStore } from "./platform-secret-store";
import {
  auditEvents,
  customerAccessRestrictionRevisions,
  customerInternalNotes,
  customerRiskMarkerRevisions,
  customerUserProjections,
  customerWorkspaceMembershipProjections,
  customerWorkspaceOwnershipTransfers,
  customerWorkspaceProjections,
  operatorInvitations,
  operatorBreakGlassGrants,
  operatorBreakGlassReviews,
  operators,
  operatorVerificationChallenges,
  platformSecretReferences,
  platformSecretVersions,
  platformCommands,
  user,
} from "./schema";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
const integrationTestsEnabled =
  process.env.ATHARVAN_RUN_DB_INTEGRATION_TESTS === "1" &&
  databaseUrl !== undefined;
const describeDatabase = integrationTestsEnabled ? describe : describe.skip;

describeDatabase("PostgreSQL operator onboarding store", () => {
  it("enforces allowlisting and permits only one concurrent code activation", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const database = drizzle({ client: pool, schema });
    const store = createPostgresOperatorOnboardingStore(database);
    const sessionPolicyStore =
      createPostgresOperatorSessionPolicyStore(database);
    const commandTime = new Date("2026-08-28T12:00:00.000Z");
    let deliveredCode: string | undefined;
    const emailSender = {
      sendFirstLoginVerification: vi.fn(async (message) => {
        deliveredCode = message.code;
        return {
          providerMessageId: "integration-message-1",
          acceptedAt: commandTime,
        };
      }),
    };
    const service = createOperatorOnboardingService({
      store,
      emailSender,
      verificationHmacSecret: "integration-verification-secret-32-bytes",
      now: () => commandTime,
    });

    try {
      const bootstrap = await service.bootstrapSuperAdministrator({
        email: "owner@atharvan-ci.example",
        reason: "PostgreSQL integration bootstrap",
        correlationId: "00000000-0000-4000-8000-000000000101",
      });
      const actor: AuthenticatedOperator = {
        operatorId: bootstrap.id,
        isSuperAdministrator: true,
        effectiveCapabilities: ["platform:*"],
        stepUpVerifiedAt: commandTime,
      };
      const configurationStore =
        createPostgresPlatformConfigurationStore(database);
      const configurationService =
        createPlatformConfigurationAdministrationService({
          store: configurationStore,
          environment: "development",
          now: () => commandTime,
        });

      const configurationChanges = await Promise.all([
        configurationService.setConfiguration({
          actor,
          key: "platform.release.channel",
          scope: "platform",
          value: "beta",
          reason: "Exercise the platform-level revision path.",
          correlationId: "00000000-0000-4000-8000-000000000107",
        }),
        configurationService.setConfiguration({
          actor,
          key: "platform.release.channel",
          scope: "environment",
          value: "stable",
          reason: "Exercise environment precedence under concurrency.",
          correlationId: "00000000-0000-4000-8000-000000000108",
        }),
      ]);
      expect(configurationChanges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ outcome: "updated" }),
          expect.objectContaining({ outcome: "updated" }),
        ]),
      );
      await expect(
        configurationService.setConfiguration({
          actor,
          key: "platform.release.channel",
          scope: "environment",
          value: "stable",
          reason: "Prove an identical value remains a no-op.",
          correlationId: "00000000-0000-4000-8000-000000000109",
        }),
      ).resolves.toEqual({
        outcome: "unchanged",
        key: "platform.release.channel",
      });
      await expect(
        configurationStore.listConfiguration("development"),
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            key: "platform.release.channel",
            platformOverride: expect.objectContaining({ value: "beta" }),
            environmentOverride: expect.objectContaining({ value: "stable" }),
            resolvedValue: "stable",
            resolvedFrom: "environment",
            recentRevisions: expect.arrayContaining([
              expect.objectContaining({ value: "beta" }),
              expect.objectContaining({ value: "stable" }),
            ]),
          }),
        ]),
      });

      const secretMaterialProvider = {
        configured: true,
        create: vi.fn(async () => ({ externalId: "provider-secret-id" })),
        rotate: vi.fn(async () => undefined),
        revoke: vi.fn(async () => undefined),
      };
      let secretIdSequence = 200;
      const secretService = createPlatformSecretLifecycleService({
        store: createPostgresPlatformSecretStore(database),
        provider: secretMaterialProvider,
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++secretIdSequence).padStart(12, "0")}`,
      });
      const createdSecret = await secretService.create({
        actor,
        key: "models.openai",
        purpose: "Platform model routing",
        value: "integration-provider-key-v1",
        reason: "Exercise metadata-only secret creation.",
        correlationId: "00000000-0000-4000-8000-000000000110",
      });
      await secretService.rotate({
        actor,
        referenceId: createdSecret.id,
        value: "integration-provider-key-v2",
        reason: "Exercise metadata-only secret rotation.",
        correlationId: "00000000-0000-4000-8000-000000000111",
      });
      let modelIdSequence = 400;
      const modelCatalogueService = createModelCatalogueService({
        store: createPostgresModelCatalogueStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++modelIdSequence).padStart(12, "0")}`,
      });
      const provider = await modelCatalogueService.setProvider({
        actor,
        key: "openai",
        displayName: "OpenAI",
        adapterKind: "openai",
        baseUrl: "https://api.openai.com/v1",
        credentialReferenceId: createdSecret.id,
        regions: ["global"],
        maximumDataClassification: "confidential",
        lifecycle: "active",
        reason: "Exercise the model provider revision path.",
        correlationId: "00000000-0000-4000-8000-000000000113",
      });
      const model = await modelCatalogueService.setModel({
        actor,
        providerId: provider.id,
        key: "integration-model",
        displayName: "Integration Model",
        kind: "generation",
        capabilities: ["reasoning", "tool_use"],
        contextWindowTokens: 128_000,
        maximumOutputTokens: 8_192,
        inputPriceMicrounitsPerMillion: 1_000_000,
        outputPriceMicrounitsPerMillion: 5_000_000,
        regions: ["global"],
        maximumDataClassification: "confidential",
        lifecycle: "active",
        reason: "Exercise the model metadata revision path.",
        correlationId: "00000000-0000-4000-8000-000000000114",
      });
      await modelCatalogueService.recordHealthObservation({
        actor,
        providerId: provider.id,
        status: "healthy",
        latencyMs: 125,
        httpStatusCode: 200,
        reason: "Exercise evidence-backed provider health.",
        correlationId: "00000000-0000-4000-8000-000000000115",
      });
      await expect(
        modelCatalogueService.listCatalogue(),
      ).resolves.toMatchObject({
        environment: "development",
        items: [
          expect.objectContaining({
            key: "openai",
            credentialReferenceKey: "models.openai",
            health: expect.objectContaining({ state: "healthy" }),
            models: [
              expect.objectContaining({
                key: "integration-model",
                inputPriceMicrounitsPerMillion: 1_000_000,
              }),
            ],
          }),
        ],
      });
      let routingIdSequence = 500;
      const modelRoutingService = createModelRoutingService({
        store: createPostgresModelRoutingStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++routingIdSequence).padStart(12, "0")}`,
      });
      await modelRoutingService.setControl({
        actor,
        targetKind: "provider",
        targetId: provider.id,
        state: "enabled",
        reason: "Explicitly enable the integration provider route.",
        correlationId: "00000000-0000-4000-8000-000000000116",
      });
      await modelRoutingService.setControl({
        actor,
        targetKind: "model",
        targetId: model.id,
        state: "enabled",
        reason: "Explicitly enable the integration model route.",
        correlationId: "00000000-0000-4000-8000-000000000117",
      });
      await modelRoutingService.setPolicy({
        actor,
        key: "code_generation",
        displayName: "Code generation",
        requiredCapabilities: ["reasoning", "tool_use"],
        maximumDataClassification: "confidential",
        allowedRegions: ["global"],
        targets: [
          {
            modelId: model.id,
            rolloutBasisPoints: 10_000,
            allowDegraded: false,
          },
        ],
        reason: "Exercise the immutable routing-policy revision path.",
        correlationId: "00000000-0000-4000-8000-000000000118",
      });
      await expect(
        modelRoutingService.previewRoute({
          policyKey: "code_generation",
          stableRoutingKey: "integration-route-request",
          dataClassification: "confidential",
          region: "global",
        }),
      ).resolves.toMatchObject({
        outcome: "selected",
        providerId: provider.id,
        modelId: model.id,
        evaluations: [{ accepted: true, reason: null }],
      });
      await modelRoutingService.setControl({
        actor,
        targetKind: "provider",
        targetId: provider.id,
        state: "disabled",
        reason: "Exercise the immediate provider kill-switch path.",
        correlationId: "00000000-0000-4000-8000-000000000119",
      });
      await expect(
        modelRoutingService.previewRoute({
          policyKey: "code_generation",
          stableRoutingKey: "integration-route-request",
          dataClassification: "confidential",
          region: "global",
        }),
      ).resolves.toMatchObject({
        outcome: "unavailable",
        reason: "no_eligible_target",
        evaluations: [{ accepted: false, reason: "provider_disabled" }],
      });
      let integrationIdSequence = 600;
      const integrationRegistryService =
        createPlatformIntegrationRegistryService({
          store: createPostgresPlatformIntegrationRegistryStore(database),
          environment: "development",
          now: () => commandTime,
          randomId: () =>
            `00000000-0000-4000-8000-${String(++integrationIdSequence).padStart(12, "0")}`,
        });
      const integration = await integrationRegistryService.setIntegration({
        actor,
        key: "github",
        displayName: "GitHub",
        protocol: "oauth2",
        connectionMode: "direct",
        capabilities: ["source_control"],
        adapterPackage: "@arth/github",
        adapterVersion: "1.0.0",
        documentationUrl: "https://docs.github.com/apps/oauth-apps",
        authorizationUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        clientId: "integration-public-client-id",
        clientSecretReferenceId: createdSecret.id,
        callbackUrls: ["https://dev.admin.arth.sh/api/oauth/github/callback"],
        requiredScopes: ["read:user"],
        optionalScopes: ["repo"],
        lifecycle: "active",
        operationalState: "enabled",
        reason: "Exercise the platform integration revision path.",
        correlationId: "00000000-0000-4000-8000-000000000120",
      });
      await integrationRegistryService.recordHealthObservation({
        actor,
        integrationId: integration.id,
        status: "healthy",
        latencyMs: 140,
        httpStatusCode: 200,
        reason: "Exercise evidence-backed integration health.",
        correlationId: "00000000-0000-4000-8000-000000000121",
      });
      await expect(
        integrationRegistryService.listRegistry(),
      ).resolves.toMatchObject({
        environment: "development",
        items: [
          expect.objectContaining({
            key: "github",
            clientId: "integration-public-client-id",
            clientSecretReferenceKey: "models.openai",
            effectiveOperationalState: "enabled",
            health: expect.objectContaining({ state: "healthy" }),
          }),
        ],
      });
      let adapterIdSequence = 700;
      const adapterRegistryService = createPlatformAdapterRegistryService({
        store: createPostgresPlatformAdapterRegistryStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++adapterIdSequence).padStart(12, "0")}`,
      });
      const adapterRelease = await adapterRegistryService.setRelease({
        actor,
        key: "django",
        version: "1.2.0",
        displayName: "Django",
        category: "framework",
        packageName: "@arth/django-adapter",
        packageDigestSha256: "a".repeat(64),
        documentationUrl: "https://docs.arth.sh/adapters/django",
        capabilities: [
          { name: "detect", maturity: "stable" },
          { name: "understand", maturity: "stable" },
          { name: "modify", maturity: "beta" },
          { name: "validate", maturity: "stable" },
          { name: "preview", maturity: "unsupported" },
          { name: "deploy", maturity: "unsupported" },
          { name: "operate", maturity: "unsupported" },
          { name: "migrate", maturity: "alpha" },
        ],
        declaredPermissions: ["repository:read", "repository:write"],
        configurationFields: [
          {
            key: "python_version",
            label: "Python version",
            type: "string",
            required: true,
          },
        ],
        commands: [
          {
            key: "detect",
            description: "Detect a Django repository.",
            risk: "read",
          },
        ],
        supportedEnvironments: ["development", "production"],
        compatibilityTags: ["django:5", "python:3.13"],
        requiredSecretPurposes: [],
        healthChecks: [
          {
            key: "doctor",
            command: "arth-adapter doctor",
            timeoutSeconds: 30,
          },
        ],
        releaseChannel: "stable",
        signatureStatus: "verified",
        securityReviewStatus: "approved",
        securityReviewReference: "SEC-2026-0042",
        lifecycle: "active",
        reason: "Exercise reviewed adapter release publication.",
        correlationId: "00000000-0000-4000-8000-000000000122",
      });
      expect(adapterRelease).toMatchObject({
        outcome: "created",
        revisionNumber: 1,
      });
      await expect(
        adapterRegistryService.setRelease({
          actor,
          key: "django",
          version: "1.2.0",
          displayName: "Django",
          category: "framework",
          packageName: "@arth/django-adapter",
          packageDigestSha256: "b".repeat(64),
          capabilities: [
            { name: "detect", maturity: "stable" },
            { name: "understand", maturity: "stable" },
            { name: "modify", maturity: "beta" },
            { name: "validate", maturity: "stable" },
            { name: "preview", maturity: "unsupported" },
            { name: "deploy", maturity: "unsupported" },
            { name: "operate", maturity: "unsupported" },
            { name: "migrate", maturity: "alpha" },
          ],
          declaredPermissions: [],
          configurationFields: [],
          commands: [],
          supportedEnvironments: ["development"],
          compatibilityTags: [],
          requiredSecretPurposes: [],
          healthChecks: [],
          releaseChannel: "stable",
          signatureStatus: "verified",
          securityReviewStatus: "approved",
          securityReviewReference: "SEC-2026-0042",
          lifecycle: "active",
          reason: "Prove published artifact identity is immutable.",
          correlationId: "00000000-0000-4000-8000-000000000123",
        }),
      ).rejects.toMatchObject({ reason: "adapter_release_artifact_immutable" });
      await expect(
        adapterRegistryService.listRegistry(),
      ).resolves.toMatchObject({
        environment: "development",
        items: [
          expect.objectContaining({
            key: "django",
            version: "1.2.0",
            packageDigestSha256: "a".repeat(64),
            signatureStatus: "verified",
            securityReviewStatus: "approved",
            lifecycle: "active",
            capabilities: expect.arrayContaining([
              { name: "detect", maturity: "stable" },
              { name: "migrate", maturity: "alpha" },
            ]),
          }),
        ],
      });
      let featureFlagIdSequence = 800;
      const featureFlagService = createPlatformFeatureFlagService({
        store: createPostgresPlatformFeatureFlagStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++featureFlagIdSequence).padStart(12, "0")}`,
      });
      const featureFlagCommand = {
        actor,
        key: "dashboard.new_navigation",
        displayName: "New dashboard navigation",
        purpose: "Stage the reviewed dashboard navigation rollout.",
        ownerOperatorId: actor.operatorId,
        lifecycle: "active" as const,
        defaultEnabled: false,
        emergencyDisabled: false,
        rules: [
          {
            id: "beta_rollout",
            description: "Enable beta workspaces in the global region.",
            enabled: true,
            planKeys: [],
            workspaceIds: [],
            userIds: [],
            regions: ["global"],
            cohorts: ["beta"],
            internalStaff: null,
            minimumAccountAgeDays: null,
            maximumAccountAgeDays: null,
            rolloutBasisPoints: 10_000,
          },
        ],
        reviewAt: "2026-09-15T00:00:00.000Z",
        expiresAt: "2026-10-01T00:00:00.000Z",
        reason: "Exercise deterministic feature flag targeting.",
      };
      await featureFlagService.setFlag({
        ...featureFlagCommand,
        correlationId: "00000000-0000-4000-8000-000000000124",
      });
      await expect(
        featureFlagService.evaluate("dashboard.new_navigation", {
          stableRoutingKey: "integration-workspace",
          region: "global",
          cohorts: ["beta"],
        }),
      ).resolves.toMatchObject({
        enabled: true,
        reason: "targeting_rule",
        matchedRuleId: "beta_rollout",
      });
      await featureFlagService.setFlag({
        ...featureFlagCommand,
        emergencyDisabled: true,
        reason: "Exercise immediate feature flag containment.",
        correlationId: "00000000-0000-4000-8000-000000000125",
      });
      await expect(
        featureFlagService.evaluate("dashboard.new_navigation", {
          stableRoutingKey: "integration-workspace",
          region: "global",
          cohorts: ["beta"],
        }),
      ).resolves.toMatchObject({
        enabled: false,
        reason: "emergency_disabled",
        matchedRuleId: null,
      });
      await expect(featureFlagService.listFlags()).resolves.toMatchObject({
        environment: "development",
        items: [
          expect.objectContaining({
            key: "dashboard.new_navigation",
            freshness: "current",
            current: expect.objectContaining({
              revisionNumber: 2,
              emergencyDisabled: true,
            }),
            recentRevisions: [
              expect.objectContaining({ revisionNumber: 2 }),
              expect.objectContaining({ revisionNumber: 1 }),
            ],
          }),
        ],
      });
      let commandIdSequence = 950;
      const commandService = createPlatformCommandService({
        store: createPostgresPlatformCommandAuditStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () =>
          `00000000-0000-4000-8000-${String(++commandIdSequence).padStart(12, "0")}`,
      });
      const commandInput = {
        actor,
        requiredCapability: "platform:configuration:write",
        name: "platform.configuration.set",
        version: 1,
        targetType: "platform_configuration",
        targetId: "platform.release.channel",
        safePayload: {
          scope: "environment",
          value: "stable",
        } as const,
        idempotencyKey: "integration-command-idempotency-1",
        correlationId: "00000000-0000-4000-8000-000000000126",
        reason: "Exercise the shared command envelope.",
      };
      const begun = await commandService.begin(commandInput);
      expect(begun).toMatchObject({ state: "started" });
      if (begun.state !== "started") throw new Error("command_not_started");
      await commandService.complete({
        commandId: begun.commandId,
        actor,
        targetType: commandInput.targetType,
        targetId: commandInput.targetId,
        correlationId: commandInput.correlationId,
        reason: commandInput.reason,
        outcome: "succeeded",
        responseStatus: 200,
        responseBody: { outcome: "updated", revisionNumber: 2 },
      });
      await expect(
        commandService.begin({
          ...commandInput,
          correlationId: "00000000-0000-4000-8000-000000000127",
        }),
      ).resolves.toMatchObject({
        state: "replayed",
        result: {
          outcome: "succeeded",
          responseStatus: 200,
          responseBody: { outcome: "updated", revisionNumber: 2 },
        },
      });
      await expect(
        commandService.listAuditEvents(actor, {
          commandName: "platform.configuration.set",
          outcome: "succeeded",
        }),
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            eventType: "platform.command.succeeded",
            command: expect.objectContaining({
              name: "platform.configuration.set",
              outcome: "succeeded",
            }),
          }),
        ]),
      });
      await expect(
        database
          .update(platformCommands)
          .set({ reason: "Attempt to rewrite immutable command history." })
          .where(eq(platformCommands.id, begun.commandId)),
      ).rejects.toThrow();
      await expect(
        database
          .select({ reason: platformCommands.reason })
          .from(platformCommands)
          .where(eq(platformCommands.id, begun.commandId)),
      ).resolves.toEqual([{ reason: commandInput.reason }]);
      const customerDirectoryService = createCustomerDirectoryService({
        store: createPostgresCustomerDirectoryStore(database),
        environment: "development",
        now: () => commandTime,
        randomId: () => "00000000-0000-4000-8000-000000000128",
      });
      const customerSnapshot = {
        actor,
        sourceRevision: "42",
        observedAt: commandTime.toISOString(),
        users: [
          {
            id: "arth-user-integration-1",
            email: "customer@artharvan-ci.example",
            displayName: "Customer Integration",
            lifecycle: "active" as const,
            verificationStatus: "verified" as const,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          {
            id: "arth-user-integration-2",
            email: "successor@artharvan-ci.example",
            displayName: "Successor Integration",
            lifecycle: "active" as const,
            verificationStatus: "verified" as const,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        workspaces: [
          {
            id: "arth-workspace-integration-1",
            organizationId: "arth-organization-integration-1",
            name: "Integration Workspace",
            slug: "integration-workspace",
            lifecycle: "active" as const,
            ownerUserId: "arth-user-integration-1",
            createdAt: "2026-08-02T00:00:00.000Z",
          },
        ],
        memberships: [
          {
            id: "arth-membership-integration-1",
            userId: "arth-user-integration-1",
            workspaceId: "arth-workspace-integration-1",
            role: "owner",
            lifecycle: "active" as const,
            grantedPermissions: ["workspace:read", "workspace:write"],
            deniedPermissions: ["workspace:delete"],
            effectivePermissions: ["workspace:read", "workspace:write"],
          },
          {
            id: "arth-membership-integration-2",
            userId: "arth-user-integration-2",
            workspaceId: "arth-workspace-integration-1",
            role: "administrator",
            lifecycle: "active" as const,
            grantedPermissions: ["workspace:read", "workspace:write"],
            deniedPermissions: [],
            effectivePermissions: ["workspace:read", "workspace:write"],
          },
        ],
        reason: "Reconcile the Arth integration projection.",
        correlationId: "00000000-0000-4000-8000-000000000128",
      };
      await expect(
        customerDirectoryService.reconcileSnapshot(customerSnapshot),
      ).resolves.toEqual({
        outcome: "updated",
        sourceRevision: "42",
        users: 2,
        workspaces: 1,
        memberships: 2,
      });
      const customerSearch = await customerDirectoryService.search({
        actor,
        query: "customer@artharvan-ci.example",
        scope: "all",
        reason: "Investigate the integration customer account.",
        correlationId: "00000000-0000-4000-8000-000000000129",
      });
      expect(customerSearch).toMatchObject({
        status: { freshness: "current", sourceRevision: "42" },
        users: [expect.objectContaining({ id: "arth-user-integration-1" })],
      });
      expect(customerSearch.queryFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      const workspaceInspection = await customerDirectoryService.inspect({
        actor,
        entityType: "workspace",
        entityId: "arth-workspace-integration-1",
        reason: "Inspect effective integration permissions.",
        correlationId: "00000000-0000-4000-8000-000000000130",
      });
      if (!workspaceInspection) {
        throw new Error("expected the reconciled workspace to be inspectable");
      }
      expect(workspaceInspection).toMatchObject({ entityType: "workspace" });
      expect(workspaceInspection.memberships).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            membership: expect.objectContaining({
              effectivePermissions: ["workspace:read", "workspace:write"],
            }),
            user: expect.objectContaining({ id: "arth-user-integration-1" }),
          }),
        ]),
      );
      const restricted = await customerDirectoryService.setRestriction({
        actor,
        targetType: "workspace",
        targetId: "arth-workspace-integration-1",
        capability: "new_executions",
        desiredState: "restricted",
        confirmation: "RESTRICT arth-workspace-integration-1",
        reason: "Contain new executions during the integration incident.",
        correlationId: "00000000-0000-4000-8000-000000000133",
      });
      expect(restricted).toMatchObject({
        outcome: "updated",
        revisionNumber: 1,
        desiredState: "restricted",
      });
      if (restricted.outcome !== "updated") {
        throw new Error("integration_restriction_not_created");
      }
      await expect(
        customerDirectoryService.listRestrictions({
          actor,
          targetType: "workspace",
          targetId: "arth-workspace-integration-1",
        }),
      ).resolves.toMatchObject({
        items: [
          {
            capability: "new_executions",
            desiredState: "restricted",
            reconciliationState: "pending",
          },
        ],
      });
      await customerDirectoryService.recordRestrictionObservation({
        actor,
        restrictionId: restricted.restrictionId,
        desiredRevisionNumber: restricted.revisionNumber,
        sourceRevision: "100",
        observedState: "restricted",
        message: "Arth deny policy is active.",
        observedAt: commandTime.toISOString(),
        correlationId: "00000000-0000-4000-8000-000000000134",
      });
      await expect(
        customerDirectoryService.listRestrictions({
          actor,
          targetType: "workspace",
          targetId: "arth-workspace-integration-1",
        }),
      ).resolves.toMatchObject({
        items: [{ reconciliationState: "applied" }],
      });
      await expect(
        customerDirectoryService.setRestriction({
          actor,
          targetType: "workspace",
          targetId: "arth-workspace-integration-1",
          capability: "new_executions",
          desiredState: "restored",
          confirmation: "RESTORE arth-workspace-integration-1",
          reason: "Restore executions after the incident is resolved.",
          correlationId: "00000000-0000-4000-8000-000000000135",
        }),
      ).resolves.toMatchObject({
        outcome: "updated",
        revisionNumber: 2,
        desiredState: "restored",
      });
      await expect(
        database
          .update(customerAccessRestrictionRevisions)
          .set({ reason: "Attempt to rewrite restriction history." })
          .where(
            eq(
              customerAccessRestrictionRevisions.restrictionId,
              restricted.restrictionId,
            ),
          ),
      ).rejects.toThrow();
      await expect(
        database
          .select({ reason: customerAccessRestrictionRevisions.reason })
          .from(customerAccessRestrictionRevisions)
          .where(
            eq(
              customerAccessRestrictionRevisions.restrictionId,
              restricted.restrictionId,
            ),
          ),
      ).resolves.toEqual(
        expect.arrayContaining([
          { reason: "Contain new executions during the integration incident." },
          { reason: "Restore executions after the incident is resolved." },
        ]),
      );
      const note = await customerDirectoryService.createInternalNote({
        actor,
        targetType: "workspace",
        targetId: "arth-workspace-integration-1",
        category: "support",
        body: "Owner departure was verified through the support process.",
        reason: "Record bounded ownership recovery context.",
        correlationId: "00000000-0000-4000-8000-000000000136",
      });
      const marker = await customerDirectoryService.setRiskMarker({
        actor,
        targetType: "workspace",
        targetId: "arth-workspace-integration-1",
        category: "identity",
        severity: "high",
        state: "active",
        summary: "Workspace owner is no longer available.",
        reason: "Track the verified ownership recovery risk.",
        correlationId: "00000000-0000-4000-8000-000000000137",
      });
      const transfer = await customerDirectoryService.requestOwnershipTransfer({
        actor,
        workspaceId: "arth-workspace-integration-1",
        successorUserId: "arth-user-integration-2",
        approvalReference: "APR-INTEGRATION-42",
        confirmation:
          "TRANSFER arth-workspace-integration-1 TO arth-user-integration-2",
        reason: "Recover ownership after verified owner departure.",
        correlationId: "00000000-0000-4000-8000-000000000138",
      });
      expect(transfer).toMatchObject({ outcome: "created", revisionNumber: 1 });
      await expect(
        customerDirectoryService.inspect({
          actor,
          entityType: "workspace",
          entityId: "arth-workspace-integration-1",
          reason: "Inspect the ownership recovery workflow.",
          correlationId: "00000000-0000-4000-8000-000000000139",
        }),
      ).resolves.toMatchObject({
        workspace: { ownerUserId: "arth-user-integration-1" },
        operations: {
          notes: [{ id: note.id }],
          riskMarkers: [{ id: marker.id, state: "active" }],
          ownershipTransfers: [
            { id: transfer.id, reconciliationState: "pending" },
          ],
        },
      });
      await customerDirectoryService.recordOwnershipTransferObservation({
        actor,
        transferId: transfer.id,
        sourceRevision: "200",
        observedState: "observed",
        observedOwnerUserId: "arth-user-integration-2",
        message: "Arth reports the approved successor as owner.",
        observedAt: commandTime.toISOString(),
        correlationId: "00000000-0000-4000-8000-000000000140",
      });
      await expect(
        customerDirectoryService.inspect({
          actor,
          entityType: "workspace",
          entityId: "arth-workspace-integration-1",
          reason: "Verify reconciled ownership recovery state.",
          correlationId: "00000000-0000-4000-8000-000000000141",
        }),
      ).resolves.toMatchObject({
        operations: {
          ownershipTransfers: [{ reconciliationState: "applied" }],
        },
      });
      await expect(
        database
          .update(customerInternalNotes)
          .set({ body: "Attempt to rewrite internal note history." })
          .where(eq(customerInternalNotes.id, note.id)),
      ).rejects.toThrow();
      await expect(
        database
          .select({ body: customerInternalNotes.body })
          .from(customerInternalNotes)
          .where(eq(customerInternalNotes.id, note.id)),
      ).resolves.toEqual([
        {
          body: "Owner departure was verified through the support process.",
        },
      ]);
      await expect(
        database
          .update(customerRiskMarkerRevisions)
          .set({ summary: "Attempt to rewrite risk history." })
          .where(eq(customerRiskMarkerRevisions.markerId, marker.id)),
      ).rejects.toThrow();
      await expect(
        database
          .select({ summary: customerRiskMarkerRevisions.summary })
          .from(customerRiskMarkerRevisions)
          .where(eq(customerRiskMarkerRevisions.markerId, marker.id)),
      ).resolves.toEqual([
        { summary: "Workspace owner is no longer available." },
      ]);
      await expect(
        database
          .update(customerWorkspaceOwnershipTransfers)
          .set({ reason: "Attempt to rewrite transfer history." })
          .where(eq(customerWorkspaceOwnershipTransfers.id, transfer.id)),
      ).rejects.toThrow();
      await expect(
        database
          .select({ reason: customerWorkspaceOwnershipTransfers.reason })
          .from(customerWorkspaceOwnershipTransfers)
          .where(eq(customerWorkspaceOwnershipTransfers.id, transfer.id)),
      ).resolves.toEqual([
        { reason: "Recover ownership after verified owner departure." },
      ]);
      await expect(
        customerDirectoryService.reconcileSnapshot({
          ...customerSnapshot,
          sourceRevision: "41",
          correlationId: "00000000-0000-4000-8000-000000000131",
        }),
      ).resolves.toEqual({ outcome: "unchanged", sourceRevision: "42" });
      await expect(
        customerDirectoryService.reconcileSnapshot({
          ...customerSnapshot,
          sourceRevision: "43",
          users: [],
          workspaces: [],
          memberships: [],
          correlationId: "00000000-0000-4000-8000-000000000132",
        }),
      ).resolves.toMatchObject({ outcome: "updated", sourceRevision: "43" });
      expect(await database.select().from(customerUserProjections)).toEqual([]);
      expect(
        await database.select().from(customerWorkspaceProjections),
      ).toEqual([]);
      expect(
        await database.select().from(customerWorkspaceMembershipProjections),
      ).toEqual([]);
      const [customerSearchAudit] = await database
        .select({ evidence: auditEvents.evidence })
        .from(auditEvents)
        .where(
          eq(auditEvents.eventType, "platform.customer_directory.searched"),
        );
      const serializedCustomerSearchAudit = JSON.stringify(
        customerSearchAudit?.evidence,
      );
      expect(serializedCustomerSearchAudit).toContain(
        customerSearch.queryFingerprint,
      );
      expect(serializedCustomerSearchAudit).not.toContain(
        "customer@artharvan-ci.example",
      );
      await secretService.revoke({
        actor,
        referenceId: createdSecret.id,
        reason: "Exercise irreversible secret revocation.",
        correlationId: "00000000-0000-4000-8000-000000000112",
      });
      const secretRows = await database.select().from(platformSecretReferences);
      const versionRows = await database.select().from(platformSecretVersions);
      const serializedSecretMetadata = JSON.stringify({
        secretRows,
        versionRows,
      });
      expect(serializedSecretMetadata).not.toContain(
        "integration-provider-key-v1",
      );
      expect(serializedSecretMetadata).not.toContain(
        "integration-provider-key-v2",
      );
      expect(secretRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "models.openai",
            status: "revoked",
            currentVersionNumber: 2,
          }),
        ]),
      );
      expect(versionRows.map((version) => version.status)).toEqual(
        expect.arrayContaining(["retired", "retired"]),
      );

      await expect(
        service.createInvitation({
          actor,
          email: "outsider@untrusted.example",
          organizationId: "arth",
          intendedCapabilities: ["platform:operators:read"],
          reason: "Must be rejected by domain policy",
        }),
      ).rejects.toThrow("domain_not_allowed");

      const invitation = await service.createInvitation({
        actor,
        email: "operator@atharvan-ci.example",
        organizationId: "arth",
        intendedCapabilities: ["platform:operators:read"],
        reason: "PostgreSQL integration operator",
        correlationId: "00000000-0000-4000-8000-000000000102",
      });

      await expect(
        service.requestFirstLoginVerification({
          email: "operator@atharvan-ci.example",
        }),
      ).resolves.toEqual({ accepted: true });
      expect(deliveredCode).toMatch(/^\d{6}$/);

      const attempts = await Promise.all([
        service.verifyAndActivate({
          email: "operator@atharvan-ci.example",
          code: deliveredCode!,
          correlationId: "00000000-0000-4000-8000-000000000103",
        }),
        service.verifyAndActivate({
          email: "operator@atharvan-ci.example",
          code: deliveredCode!,
          correlationId: "00000000-0000-4000-8000-000000000104",
        }),
      ]);

      expect(attempts.filter((result) => result.activated)).toHaveLength(1);

      const [operator] = await database
        .select({ status: operators.status })
        .from(operators)
        .where(eq(operators.email, "operator@atharvan-ci.example"));
      const [storedInvitation] = await database
        .select({
          status: operatorInvitations.status,
          tokenFingerprint: operatorInvitations.tokenFingerprint,
        })
        .from(operatorInvitations)
        .where(eq(operatorInvitations.id, invitation.id));
      const [challenge] = await database
        .select({ status: operatorVerificationChallenges.status })
        .from(operatorVerificationChallenges)
        .where(
          eq(
            operatorVerificationChallenges.operatorId,
            (
              await database
                .select({ id: operators.id })
                .from(operators)
                .where(eq(operators.email, "operator@atharvan-ci.example"))
            )[0]!.id,
          ),
        );
      const activationAudits = await database
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.eventType, "platform.operator.activated"));

      expect(operator?.status).toBe("active");
      expect(storedInvitation?.status).toBe("accepted");
      expect(storedInvitation?.tokenFingerprint).not.toBe(
        invitation.invitationToken,
      );
      expect(challenge?.status).toBe("consumed");
      expect(activationAudits).toHaveLength(1);

      await service.createInvitation({
        actor,
        email: "session-operator@atharvan-ci.example",
        organizationId: "arth",
        intendedCapabilities: ["platform:overview:read"],
        reason: "Better Auth session integration operator",
        correlationId: "00000000-0000-4000-8000-000000000105",
      });
      await database.insert(user).values({
        id: "auth-user-integration-1",
        name: "Session Operator",
        email: "session-operator@atharvan-ci.example",
        emailVerified: true,
        createdAt: commandTime,
        updatedAt: commandTime,
      });

      await expect(
        sessionPolicyStore.canIssueSignInOtp({
          normalizedEmail: "outsider@untrusted.example",
          now: commandTime,
        }),
      ).resolves.toBe(false);
      await expect(
        sessionPolicyStore.canIssueSignInOtp({
          normalizedEmail: "session-operator@atharvan-ci.example",
          now: commandTime,
        }),
      ).resolves.toBe(true);
      await expect(
        sessionPolicyStore.activateOperatorForAuthUser({
          authUserId: "auth-user-integration-1",
          correlationId: "00000000-0000-4000-8000-000000000106",
          now: commandTime,
        }),
      ).resolves.toMatchObject({
        isSuperAdministrator: false,
        effectiveCapabilities: ["platform:overview:read"],
      });
      await expect(
        sessionPolicyStore.resolveActiveOperator("auth-user-integration-1"),
      ).resolves.toMatchObject({
        effectiveCapabilities: ["platform:overview:read"],
      });

      const [sessionOperator] = await database
        .select({ id: operators.id })
        .from(operators)
        .where(eq(operators.authUserId, "auth-user-integration-1"));
      const breakGlassService = createOperatorBreakGlassAdministrationService({
        store: createPostgresOperatorBreakGlassAdministrationStore(database),
        now: () => commandTime,
      });
      const breakGlassGrant = await breakGlassService.createGrant({
        actor,
        targetOperatorId: sessionOperator!.id,
        capabilities: ["platform:models:write"],
        durationMinutes: 15,
        reason: "Exercise bounded incident elevation in PostgreSQL.",
        incidentReference: "INC-CI-15",
        approvalReference: "APR-CI-15",
        confirmation: `GRANT BREAK-GLASS TO ${sessionOperator!.id}`,
        correlationId: "00000000-0000-4000-8000-000000000115",
      });
      await expect(
        sessionPolicyStore.resolveActiveOperator("auth-user-integration-1"),
      ).resolves.toMatchObject({
        effectiveCapabilities: [
          "platform:models:write",
          "platform:overview:read",
        ],
        breakGlassGrantIds: [breakGlassGrant.id],
      });
      await breakGlassService.revokeGrant({
        actor,
        grantId: breakGlassGrant.id,
        reason: "The PostgreSQL elevation scenario is complete.",
        correlationId: "00000000-0000-4000-8000-000000000116",
      });
      await breakGlassService.reviewGrant({
        actor,
        grantId: breakGlassGrant.id,
        outcome: "approved",
        summary: "The grant matched the bounded integration-test scenario.",
        correlationId: "00000000-0000-4000-8000-000000000117",
      });
      await expect(
        sessionPolicyStore.resolveActiveOperator("auth-user-integration-1"),
      ).resolves.toMatchObject({
        effectiveCapabilities: ["platform:overview:read"],
      });
      expect(await database.select().from(operatorBreakGlassGrants)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: breakGlassGrant.id }),
        ]),
      );
      expect(await database.select().from(operatorBreakGlassReviews)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ grantId: breakGlassGrant.id }),
        ]),
      );

      await database
        .update(operators)
        .set({ status: "suspended", suspendedAt: commandTime })
        .where(eq(operators.authUserId, "auth-user-integration-1"));
      await expect(
        sessionPolicyStore.resolveActiveOperator("auth-user-integration-1"),
      ).resolves.toBeNull();
    } finally {
      await pool.end();
    }
  }, 20_000);
});
