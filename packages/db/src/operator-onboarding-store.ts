import type { OperatorOnboardingStore } from "@atharvan/auth";
import {
  evaluateOperatorActivation,
  evaluateVerificationIssuance,
  isOperatorEmailDomainAllowed,
} from "@atharvan/domain";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type {
  PgQueryResultHKT,
  PgTransaction,
} from "drizzle-orm/pg-core/session";
import type { ExtractTablesWithRelations } from "drizzle-orm/relations";

import * as schema from "./schema";
import {
  allowedEmailDomains,
  auditEvents,
  operatorInvitations,
  operators,
  operatorVerificationChallenges,
} from "./schema";

const bootstrapLockName = "atharvan:super-administrator-bootstrap";
const maximumVerificationResends = 5;

export function createPostgresOperatorOnboardingStore(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
): OperatorOnboardingStore {
  return {
    bootstrapSuperAdministrator(input) {
      return database.transaction(async (transaction) => {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${bootstrapLockName}))`,
        );

        const [existing] = await transaction
          .select({ id: operators.id, email: operators.email })
          .from(operators)
          .where(eq(operators.isSuperAdministrator, true))
          .limit(1)
          .for("update");

        if (existing !== undefined) {
          return existing.email === input.normalizedEmail
            ? { outcome: "already_exists", id: existing.id }
            : {
                outcome: "rejected",
                reason: "different_super_administrator_exists",
              };
        }

        await transaction.insert(operators).values({
          id: input.operatorId,
          email: input.normalizedEmail,
          emailDomain: input.emailDomain,
          status: "active",
          isSuperAdministrator: true,
          invitedAt: input.now,
          activatedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await transaction.insert(allowedEmailDomains).values({
          domain: input.emailDomain,
          includeSubdomains: false,
          isPublicDomainException: false,
          isActive: true,
          reason: input.reason,
          createdByOperatorId: input.operatorId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await transaction.insert(auditEvents).values({
          actorId: null,
          eventType: "platform.super_administrator.bootstrapped",
          targetType: "operator",
          targetId: input.operatorId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            emailDomain: input.emailDomain,
            authority: "platform:*",
            customerPrivateAuthority: false,
          },
          occurredAt: input.now,
        });

        return { outcome: "created", id: input.operatorId };
      });
    },

    addAllowedEmailDomain(input) {
      return database.transaction(async (transaction) => {
        const actor = await lockActiveSuperAdministrator(
          transaction,
          input.actorId,
        );

        if (!actor) {
          throw new Error("operator_command_forbidden");
        }

        const [existing] = await transaction
          .select({
            id: allowedEmailDomains.id,
            isActive: allowedEmailDomains.isActive,
            includeSubdomains: allowedEmailDomains.includeSubdomains,
            isPublicDomainException:
              allowedEmailDomains.isPublicDomainException,
          })
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.domain, input.normalizedDomain))
          .limit(1)
          .for("update");

        if (existing !== undefined) {
          if (
            existing.isActive &&
            existing.includeSubdomains === input.includeSubdomains &&
            existing.isPublicDomainException === input.isPublicDomainException
          ) {
            return { outcome: "already_exists", id: existing.id };
          }

          return {
            outcome: "rejected",
            reason: "domain_already_active",
          };
        }

        await transaction.insert(allowedEmailDomains).values({
          id: input.domainId,
          domain: input.normalizedDomain,
          includeSubdomains: input.includeSubdomains,
          isPublicDomainException: input.isPublicDomainException,
          reason: input.reason,
          createdByOperatorId: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        });
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.membership_domain.added",
          targetType: "allowed_email_domain",
          targetId: input.domainId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            domain: input.normalizedDomain,
            includeSubdomains: input.includeSubdomains,
            isPublicDomainException: input.isPublicDomainException,
          },
          occurredAt: input.now,
        });

        return { outcome: "created", id: input.domainId };
      });
    },

    disableAllowedEmailDomain(input) {
      return database.transaction(async (transaction) => {
        const actor = await lockActiveSuperAdministrator(
          transaction,
          input.actorId,
        );

        if (!actor) {
          throw new Error("operator_command_forbidden");
        }

        const activeDomains = await transaction
          .select({
            id: allowedEmailDomains.id,
            domain: allowedEmailDomains.domain,
          })
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.isActive, true))
          .orderBy(allowedEmailDomains.id)
          .for("update");
        const target = activeDomains.find(
          (entry) => entry.domain === input.normalizedDomain,
        );

        if (target === undefined) {
          return { outcome: "rejected", reason: "domain_not_active" };
        }

        if (activeDomains.length === 1 && !input.membershipLockdown) {
          return { outcome: "rejected", reason: "last_active_domain" };
        }

        await transaction
          .update(allowedEmailDomains)
          .set({
            isActive: false,
            disabledByOperatorId: input.actorId,
            disabledAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(allowedEmailDomains.id, target.id),
              eq(allowedEmailDomains.isActive, true),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.membership_domain.disabled",
          targetType: "allowed_email_domain",
          targetId: target.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            domain: input.normalizedDomain,
            membershipLockdown: input.membershipLockdown,
          },
          occurredAt: input.now,
        });

        return { outcome: "created", id: target.id };
      });
    },

    createInvitation(input) {
      return database.transaction(async (transaction) => {
        const actor = await lockActiveSuperAdministrator(
          transaction,
          input.actorId,
        );

        if (!actor) {
          throw new Error("operator_command_forbidden");
        }

        const domainRules = await transaction
          .select({
            domain: allowedEmailDomains.domain,
            includeSubdomains: allowedEmailDomains.includeSubdomains,
            isActive: allowedEmailDomains.isActive,
          })
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.isActive, true));

        if (!isOperatorEmailDomainAllowed(input.normalizedEmail, domainRules)) {
          return { outcome: "rejected", reason: "domain_not_allowed" };
        }

        await transaction
          .update(operatorInvitations)
          .set({ status: "expired" })
          .where(
            and(
              eq(operatorInvitations.email, input.normalizedEmail),
              eq(operatorInvitations.status, "pending"),
              lt(operatorInvitations.expiresAt, input.now),
            ),
          );

        let [operator] = await transaction
          .select({ id: operators.id, status: operators.status })
          .from(operators)
          .where(eq(operators.email, input.normalizedEmail))
          .limit(1)
          .for("update");

        if (
          operator !== undefined &&
          ["active", "suspended", "deactivated"].includes(operator.status)
        ) {
          return { outcome: "rejected", reason: "operator_already_active" };
        }

        if (operator === undefined) {
          await transaction.insert(operators).values({
            id: input.operatorId,
            email: input.normalizedEmail,
            emailDomain: input.emailDomain,
            status: "invited",
            invitedAt: input.now,
            createdAt: input.now,
            updatedAt: input.now,
          });
          operator = { id: input.operatorId, status: "invited" };
        } else if (operator.status === "verification_pending") {
          await transaction
            .update(operators)
            .set({ status: "invited", updatedAt: input.now })
            .where(eq(operators.id, operator.id));
        }

        const [pendingInvitation] = await transaction
          .select({ id: operatorInvitations.id })
          .from(operatorInvitations)
          .where(
            and(
              eq(operatorInvitations.operatorId, operator.id),
              eq(operatorInvitations.status, "pending"),
            ),
          )
          .limit(1)
          .for("update");

        if (pendingInvitation !== undefined) {
          return {
            outcome: "rejected",
            reason: "invitation_already_pending",
          };
        }

        await transaction.insert(operatorInvitations).values({
          id: input.invitationId,
          operatorId: operator.id,
          email: input.normalizedEmail,
          emailDomain: input.emailDomain,
          organizationId: input.organizationId,
          intendedCapabilities: [...input.intendedCapabilities],
          invitedByOperatorId: input.actorId,
          tokenFingerprint: input.tokenFingerprint,
          correlationId: input.correlationId,
          reason: input.reason,
          ...(input.approvalReference === undefined
            ? {}
            : { approvalReference: input.approvalReference }),
          expiresAt: input.expiresAt,
          createdAt: input.now,
        });
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.operator.invited",
          targetType: "operator_invitation",
          targetId: input.invitationId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            organizationId: input.organizationId,
            emailDomain: input.emailDomain,
            intendedCapabilities: input.intendedCapabilities,
            approvalReference: input.approvalReference ?? null,
          },
          occurredAt: input.now,
        });

        return { outcome: "created", id: input.invitationId };
      });
    },

    prepareVerificationChallenge(input) {
      return database.transaction(async (transaction) => {
        const [operator] = await transaction
          .select({
            id: operators.id,
            email: operators.email,
            status: operators.status,
          })
          .from(operators)
          .where(eq(operators.email, input.normalizedEmail))
          .limit(1)
          .for("update");

        if (operator === undefined) {
          return { prepared: false };
        }

        await transaction
          .update(operatorInvitations)
          .set({ status: "expired" })
          .where(
            and(
              eq(operatorInvitations.operatorId, operator.id),
              eq(operatorInvitations.status, "pending"),
              lt(operatorInvitations.expiresAt, input.now),
            ),
          );

        const [invitation] = await transaction
          .select({
            id: operatorInvitations.id,
            email: operatorInvitations.email,
            status: operatorInvitations.status,
            expiresAt: operatorInvitations.expiresAt,
          })
          .from(operatorInvitations)
          .where(
            and(
              eq(operatorInvitations.operatorId, operator.id),
              eq(operatorInvitations.status, "pending"),
              gt(operatorInvitations.expiresAt, input.now),
            ),
          )
          .orderBy(desc(operatorInvitations.createdAt))
          .limit(1)
          .for("update");
        const domainRules = await transaction
          .select({
            domain: allowedEmailDomains.domain,
            includeSubdomains: allowedEmailDomains.includeSubdomains,
            isActive: allowedEmailDomains.isActive,
          })
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.isActive, true));

        if (invitation === undefined) {
          return { prepared: false };
        }

        const policy = evaluateVerificationIssuance({
          submittedEmail: input.normalizedEmail,
          invitedEmail: invitation.email,
          operatorStatus: operator.status,
          invitationStatus: invitation.status,
          invitationExpiresAt: invitation.expiresAt,
          domainRules,
          now: input.now,
        });

        if (!policy.allowed) {
          return { prepared: false };
        }

        const [previousChallenge] = await transaction
          .select({
            resendSequence: operatorVerificationChallenges.resendSequence,
          })
          .from(operatorVerificationChallenges)
          .where(eq(operatorVerificationChallenges.invitationId, invitation.id))
          .orderBy(desc(operatorVerificationChallenges.resendSequence))
          .limit(1)
          .for("update");
        const resendSequence =
          previousChallenge === undefined
            ? 0
            : previousChallenge.resendSequence + 1;

        if (resendSequence >= maximumVerificationResends) {
          return { prepared: false };
        }

        await transaction
          .update(operatorVerificationChallenges)
          .set({ status: "superseded" })
          .where(
            and(
              eq(operatorVerificationChallenges.operatorId, operator.id),
              eq(operatorVerificationChallenges.status, "pending"),
            ),
          );
        await transaction.insert(operatorVerificationChallenges).values({
          id: input.challengeId,
          operatorId: operator.id,
          invitationId: invitation.id,
          codeDigest: input.codeDigest,
          maximumAttempts: input.maximumAttempts,
          resendSequence,
          correlationId: input.correlationId,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        });
        await transaction
          .update(operators)
          .set({ status: "verification_pending", updatedAt: input.now })
          .where(eq(operators.id, operator.id));
        await transaction.insert(auditEvents).values({
          actorId: null,
          eventType: "platform.operator.verification_issued",
          targetType: "operator_verification_challenge",
          targetId: input.challengeId,
          correlationId: input.correlationId,
          evidence: {
            operatorId: operator.id,
            invitationId: invitation.id,
            expiresAt: input.expiresAt.toISOString(),
            maximumAttempts: input.maximumAttempts,
          },
          occurredAt: input.now,
        });

        return {
          prepared: true,
          email: policy.normalizedEmail,
          correlationId: input.correlationId,
        };
      });
    },

    async recordVerificationDelivery(input) {
      await database
        .update(operatorVerificationChallenges)
        .set({ deliveryProviderMessageId: input.providerMessageId })
        .where(
          and(
            eq(operatorVerificationChallenges.id, input.challengeId),
            eq(operatorVerificationChallenges.status, "pending"),
          ),
        );
    },

    abandonVerificationChallenge(input) {
      return database.transaction(async (transaction) => {
        const [abandoned] = await transaction
          .update(operatorVerificationChallenges)
          .set({ status: "superseded" })
          .where(
            and(
              eq(operatorVerificationChallenges.id, input.challengeId),
              eq(operatorVerificationChallenges.status, "pending"),
            ),
          )
          .returning({ id: operatorVerificationChallenges.id });

        if (abandoned !== undefined) {
          await transaction.insert(auditEvents).values({
            actorId: null,
            eventType: "platform.operator.verification_delivery_failed",
            targetType: "operator_verification_challenge",
            targetId: input.challengeId,
            correlationId: input.correlationId,
            evidence: {},
            occurredAt: input.now,
          });
        }
      });
    },

    async findVerificationAttemptContext(normalizedEmail) {
      const [context] = await database
        .select({
          challengeId: operatorVerificationChallenges.id,
          codeDigest: operatorVerificationChallenges.codeDigest,
        })
        .from(operatorVerificationChallenges)
        .innerJoin(
          operators,
          eq(operators.id, operatorVerificationChallenges.operatorId),
        )
        .where(
          and(
            eq(operators.email, normalizedEmail),
            eq(operatorVerificationChallenges.status, "pending"),
          ),
        )
        .orderBy(desc(operatorVerificationChallenges.createdAt))
        .limit(1);

      return context ?? null;
    },

    recordFailedVerification(input) {
      return database.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(operatorVerificationChallenges)
          .set({
            attemptCount: sql`${operatorVerificationChallenges.attemptCount} + 1`,
            lastAttemptAt: input.now,
            status: sql`case when ${operatorVerificationChallenges.attemptCount} + 1 >= ${operatorVerificationChallenges.maximumAttempts} then 'locked'::verification_challenge_status else 'pending'::verification_challenge_status end`,
          })
          .where(
            and(
              eq(operatorVerificationChallenges.id, input.challengeId),
              eq(
                operatorVerificationChallenges.codeDigest,
                input.expectedDigest,
              ),
              eq(operatorVerificationChallenges.status, "pending"),
              lt(
                operatorVerificationChallenges.attemptCount,
                operatorVerificationChallenges.maximumAttempts,
              ),
            ),
          )
          .returning({
            id: operatorVerificationChallenges.id,
            attemptCount: operatorVerificationChallenges.attemptCount,
            status: operatorVerificationChallenges.status,
          });

        if (updated !== undefined) {
          await transaction.insert(auditEvents).values({
            actorId: null,
            eventType: "platform.operator.verification_failed",
            targetType: "operator_verification_challenge",
            targetId: updated.id,
            correlationId: input.correlationId,
            evidence: {
              attemptCount: updated.attemptCount,
              challengeStatus: updated.status,
            },
            occurredAt: input.now,
          });
        }
      });
    },

    activateVerifiedOperator(input) {
      return database.transaction(async (transaction) => {
        const [challengePointer] = await transaction
          .select({
            operatorId: operatorVerificationChallenges.operatorId,
            invitationId: operatorVerificationChallenges.invitationId,
          })
          .from(operatorVerificationChallenges)
          .where(eq(operatorVerificationChallenges.id, input.challengeId))
          .limit(1);

        if (challengePointer === undefined) {
          return false;
        }

        const [operator] = await transaction
          .select({
            id: operators.id,
            email: operators.email,
            status: operators.status,
          })
          .from(operators)
          .where(eq(operators.id, challengePointer.operatorId))
          .limit(1)
          .for("update");
        const [invitation] = await transaction
          .select({
            id: operatorInvitations.id,
            email: operatorInvitations.email,
            status: operatorInvitations.status,
            expiresAt: operatorInvitations.expiresAt,
          })
          .from(operatorInvitations)
          .where(eq(operatorInvitations.id, challengePointer.invitationId))
          .limit(1)
          .for("update");
        const [challenge] = await transaction
          .select({
            id: operatorVerificationChallenges.id,
            status: operatorVerificationChallenges.status,
            codeDigest: operatorVerificationChallenges.codeDigest,
            attemptCount: operatorVerificationChallenges.attemptCount,
            maximumAttempts: operatorVerificationChallenges.maximumAttempts,
            expiresAt: operatorVerificationChallenges.expiresAt,
          })
          .from(operatorVerificationChallenges)
          .where(eq(operatorVerificationChallenges.id, input.challengeId))
          .limit(1)
          .for("update");
        const domainRules = await transaction
          .select({
            domain: allowedEmailDomains.domain,
            includeSubdomains: allowedEmailDomains.includeSubdomains,
            isActive: allowedEmailDomains.isActive,
          })
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.isActive, true));

        if (
          operator === undefined ||
          invitation === undefined ||
          challenge === undefined ||
          challenge.codeDigest !== input.expectedDigest ||
          operator.email !== input.normalizedEmail
        ) {
          return false;
        }

        const policy = evaluateOperatorActivation({
          submittedEmail: input.normalizedEmail,
          invitedEmail: invitation.email,
          operatorStatus: operator.status,
          invitationStatus: invitation.status,
          invitationExpiresAt: invitation.expiresAt,
          challengeStatus: challenge.status,
          challengeExpiresAt: challenge.expiresAt,
          challengeAttemptCount: challenge.attemptCount,
          challengeMaximumAttempts: challenge.maximumAttempts,
          domainRules,
          now: input.now,
        });

        if (!policy.allowed) {
          return false;
        }

        const [consumed] = await transaction
          .update(operatorVerificationChallenges)
          .set({
            status: "consumed",
            consumedAt: input.now,
            lastAttemptAt: input.now,
          })
          .where(
            and(
              eq(operatorVerificationChallenges.id, input.challengeId),
              eq(operatorVerificationChallenges.status, "pending"),
              eq(
                operatorVerificationChallenges.codeDigest,
                input.expectedDigest,
              ),
            ),
          )
          .returning({ id: operatorVerificationChallenges.id });

        if (consumed === undefined) {
          return false;
        }

        await transaction
          .update(operatorInvitations)
          .set({ status: "accepted", acceptedAt: input.now })
          .where(
            and(
              eq(operatorInvitations.id, invitation.id),
              eq(operatorInvitations.status, "pending"),
            ),
          );
        await transaction
          .update(operators)
          .set({
            status: "active",
            activatedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(operators.id, operator.id),
              eq(operators.status, "verification_pending"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: operator.id,
          eventType: "platform.operator.activated",
          targetType: "operator",
          targetId: operator.id,
          correlationId: input.correlationId,
          evidence: {
            invitationId: invitation.id,
            challengeId: challenge.id,
            emailDomain: policy.emailDomain,
          },
          occurredAt: input.now,
        });

        return true;
      });
    },
  };
}

type DatabaseTransaction = PgTransaction<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

async function lockActiveSuperAdministrator(
  transaction: DatabaseTransaction,
  actorId: string,
): Promise<boolean> {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(
      and(
        eq(operators.id, actorId),
        eq(operators.status, "active"),
        eq(operators.isSuperAdministrator, true),
      ),
    )
    .limit(1)
    .for("update");

  return actor !== undefined;
}
