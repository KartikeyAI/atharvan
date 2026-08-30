import { createOperatorOnboardingService } from "@atharvan/auth";
import { createPlatformConfigurationAdministrationService } from "@atharvan/config";
import type { AuthenticatedOperator } from "@atharvan/domain";
import { createPlatformSecretLifecycleService } from "@atharvan/secrets";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createPostgresOperatorOnboardingStore } from "./operator-onboarding-store";
import { createPostgresOperatorSessionPolicyStore } from "./operator-session-policy-store";
import { createPostgresPlatformConfigurationStore } from "./platform-configuration-store";
import { createPostgresPlatformSecretStore } from "./platform-secret-store";
import {
  auditEvents,
  operatorInvitations,
  operators,
  operatorVerificationChallenges,
  platformSecretReferences,
  platformSecretVersions,
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
