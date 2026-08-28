import { createOperatorOnboardingService } from "@atharvan/auth";
import type { AuthenticatedOperator } from "@atharvan/domain";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { createPostgresOperatorOnboardingStore } from "./operator-onboarding-store";
import {
  auditEvents,
  operatorInvitations,
  operators,
  operatorVerificationChallenges,
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
    } finally {
      await pool.end();
    }
  }, 20_000);
});
