import type { OperatorSessionPolicyStore } from "@atharvan/auth";
import {
  isOperatorEmailDomainAllowed,
  platformCapabilityWildcard,
  type AuthenticatedOperator,
} from "@atharvan/domain";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  allowedEmailDomains,
  auditEvents,
  operatorBreakGlassGrants,
  operatorInvitations,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
  operatorVerificationChallenges,
  user,
} from "./schema";

export function createPostgresOperatorSessionPolicyStore(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
  options: {
    readonly now?: () => Date;
  } = {},
): OperatorSessionPolicyStore {
  const now = options.now ?? (() => new Date());

  return {
    canIssueSignInOtp(input) {
      return database.transaction(async (transaction) => {
        const [operator] = await transaction
          .select({
            id: operators.id,
            email: operators.email,
            status: operators.status,
            isSuperAdministrator: operators.isSuperAdministrator,
          })
          .from(operators)
          .where(eq(operators.email, input.normalizedEmail))
          .limit(1);

        if (operator === undefined) {
          return false;
        }

        const domainAllowed = await isEmailAllowedByActiveDomain(
          transaction,
          operator.email,
        );

        if (!domainAllowed) {
          return false;
        }

        if (operator.status === "active") {
          return true;
        }

        if (!isPreActivationStatus(operator.status)) {
          return false;
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
          .select({ id: operatorInvitations.id })
          .from(operatorInvitations)
          .where(
            and(
              eq(operatorInvitations.operatorId, operator.id),
              eq(operatorInvitations.email, input.normalizedEmail),
              eq(operatorInvitations.status, "pending"),
              gt(operatorInvitations.expiresAt, input.now),
            ),
          )
          .limit(1);

        return invitation !== undefined;
      });
    },

    activateOperatorForAuthUser(input) {
      return database.transaction(async (transaction) => {
        const [authUser] = await transaction
          .select({ id: user.id, email: user.email })
          .from(user)
          .where(eq(user.id, input.authUserId))
          .limit(1);

        if (authUser === undefined) {
          return null;
        }

        const [operator] = await transaction
          .select({
            id: operators.id,
            email: operators.email,
            status: operators.status,
            authUserId: operators.authUserId,
            isSuperAdministrator: operators.isSuperAdministrator,
          })
          .from(operators)
          .where(eq(operators.email, authUser.email))
          .limit(1)
          .for("update");

        if (
          operator === undefined ||
          (operator.authUserId !== null &&
            operator.authUserId !== input.authUserId) ||
          !(await isEmailAllowedByActiveDomain(transaction, operator.email))
        ) {
          return null;
        }

        if (operator.status === "active") {
          if (operator.authUserId === null) {
            await transaction
              .update(operators)
              .set({ authUserId: input.authUserId, updatedAt: input.now })
              .where(
                and(
                  eq(operators.id, operator.id),
                  eq(operators.status, "active"),
                ),
              );
            await transaction.insert(auditEvents).values({
              actorId: operator.id,
              eventType: "platform.operator.identity_linked",
              targetType: "operator",
              targetId: operator.id,
              correlationId: input.correlationId,
              evidence: {
                authUserId: input.authUserId,
              },
              occurredAt: input.now,
            });
          }

          return resolveOperatorAuthority(
            transaction,
            {
              operatorId: operator.id,
              isSuperAdministrator: operator.isSuperAdministrator,
            },
            input.now,
          );
        }

        if (!isPreActivationStatus(operator.status)) {
          return null;
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
            intendedCapabilities: operatorInvitations.intendedCapabilities,
            intendedRoleDefinitionId:
              operatorInvitations.intendedRoleDefinitionId,
            invitedByOperatorId: operatorInvitations.invitedByOperatorId,
            reason: operatorInvitations.reason,
            correlationId: operatorInvitations.correlationId,
          })
          .from(operatorInvitations)
          .where(
            and(
              eq(operatorInvitations.operatorId, operator.id),
              eq(operatorInvitations.email, operator.email),
              eq(operatorInvitations.status, "pending"),
              gt(operatorInvitations.expiresAt, input.now),
            ),
          )
          .orderBy(desc(operatorInvitations.createdAt))
          .limit(1)
          .for("update");

        if (invitation === undefined) {
          return null;
        }

        const [accepted] = await transaction
          .update(operatorInvitations)
          .set({ status: "accepted", acceptedAt: input.now })
          .where(
            and(
              eq(operatorInvitations.id, invitation.id),
              eq(operatorInvitations.status, "pending"),
            ),
          )
          .returning({ id: operatorInvitations.id });

        if (accepted === undefined) {
          return null;
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
        const [activated] = await transaction
          .update(operators)
          .set({
            authUserId: input.authUserId,
            status: "active",
            activatedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(operators.id, operator.id),
              eq(operators.status, operator.status),
            ),
          )
          .returning({ id: operators.id });

        if (activated === undefined) {
          return null;
        }

        await transaction.insert(auditEvents).values({
          actorId: operator.id,
          eventType: "platform.operator.activated",
          targetType: "operator",
          targetId: operator.id,
          correlationId: input.correlationId,
          evidence: {
            invitationId: invitation.id,
            authUserId: input.authUserId,
            verificationAuthority: "better-auth:email-otp",
          },
          occurredAt: input.now,
        });

        if (invitation.intendedRoleDefinitionId !== null) {
          await transaction
            .insert(operatorRoleAssignments)
            .values({
              operatorId: operator.id,
              roleDefinitionId: invitation.intendedRoleDefinitionId,
              assignedByOperatorId: invitation.invitedByOperatorId,
              reason: invitation.reason,
              correlationId: invitation.correlationId,
              assignedAt: input.now,
            })
            .onConflictDoNothing();
        }

        return resolveOperatorAuthority(
          transaction,
          {
            operatorId: operator.id,
            isSuperAdministrator: false,
          },
          input.now,
        );
      });
    },

    async resolveActiveOperator(authUserId) {
      const [operator] = await database
        .select({
          id: operators.id,
          isSuperAdministrator: operators.isSuperAdministrator,
        })
        .from(operators)
        .where(
          and(
            eq(operators.authUserId, authUserId),
            eq(operators.status, "active"),
          ),
        )
        .limit(1);

      if (operator === undefined) {
        return null;
      }

      return resolveOperatorAuthority(
        database,
        {
          operatorId: operator.id,
          isSuperAdministrator: operator.isSuperAdministrator,
        },
        now(),
      );
    },
  };
}

type SessionPolicyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

async function isEmailAllowedByActiveDomain(
  database: SessionPolicyDatabase,
  email: string,
): Promise<boolean> {
  const domainRules = await database
    .select({
      domain: allowedEmailDomains.domain,
      includeSubdomains: allowedEmailDomains.includeSubdomains,
      isActive: allowedEmailDomains.isActive,
    })
    .from(allowedEmailDomains)
    .where(eq(allowedEmailDomains.isActive, true));

  return isOperatorEmailDomainAllowed(email, domainRules);
}

async function resolveOperatorAuthority(
  database: SessionPolicyDatabase,
  operator: {
    readonly operatorId: string;
    readonly isSuperAdministrator: boolean;
  },
  evaluatedAt: Date,
): Promise<AuthenticatedOperator> {
  if (operator.isSuperAdministrator) {
    return {
      operatorId: operator.operatorId,
      isSuperAdministrator: true,
      effectiveCapabilities: [platformCapabilityWildcard],
    };
  }

  const [[acceptedInvitation], roleCapabilities, activeBreakGlassGrants] =
    await Promise.all([
      database
        .select({
          intendedCapabilities: operatorInvitations.intendedCapabilities,
        })
        .from(operatorInvitations)
        .where(
          and(
            eq(operatorInvitations.operatorId, operator.operatorId),
            eq(operatorInvitations.status, "accepted"),
          ),
        )
        .orderBy(desc(operatorInvitations.acceptedAt))
        .limit(1),
      database
        .select({ capabilities: operatorRoleDefinitions.capabilities })
        .from(operatorRoleAssignments)
        .innerJoin(
          operatorRoleDefinitions,
          eq(
            operatorRoleDefinitions.id,
            operatorRoleAssignments.roleDefinitionId,
          ),
        )
        .where(
          and(
            eq(operatorRoleAssignments.operatorId, operator.operatorId),
            isNull(operatorRoleAssignments.revokedAt),
          ),
        ),
      database
        .select({
          id: operatorBreakGlassGrants.id,
          capabilities: operatorBreakGlassGrants.capabilities,
        })
        .from(operatorBreakGlassGrants)
        .where(
          and(
            eq(operatorBreakGlassGrants.operatorId, operator.operatorId),
            isNull(operatorBreakGlassGrants.revokedAt),
            gt(operatorBreakGlassGrants.expiresAt, evaluatedAt),
          ),
        ),
    ]);
  const persistentCapabilities =
    roleCapabilities.length > 0
      ? roleCapabilities.flatMap((role) => role.capabilities)
      : (acceptedInvitation?.intendedCapabilities ?? []);
  const effectiveCapabilities = [
    ...new Set([
      ...persistentCapabilities,
      ...activeBreakGlassGrants.flatMap((grant) => grant.capabilities),
    ]),
  ].sort();

  return {
    operatorId: operator.operatorId,
    isSuperAdministrator: false,
    effectiveCapabilities,
    ...(activeBreakGlassGrants.length === 0
      ? {}
      : {
          breakGlassGrantIds: activeBreakGlassGrants.map((grant) => grant.id),
        }),
  };
}

function isPreActivationStatus(status: string): boolean {
  return status === "invited" || status === "verification_pending";
}
