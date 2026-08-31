import type { OperatorBreakGlassAdministrationStore } from "@atharvan/auth";
import { capabilityGrantMatches } from "@atharvan/domain";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operatorBreakGlassGrants,
  operatorBreakGlassReviews,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPostgresOperatorBreakGlassAdministrationStore(
  database: Database,
): OperatorBreakGlassAdministrationStore {
  return {
    createGrant(input) {
      return database.transaction(async (transaction) => {
        await assertActiveSuperAdministrator(transaction, input.actorId);
        const [target] = await transaction
          .select({
            id: operators.id,
            isSuperAdministrator: operators.isSuperAdministrator,
            status: operators.status,
          })
          .from(operators)
          .where(eq(operators.id, input.targetOperatorId))
          .limit(1)
          .for("update");

        if (target === undefined || target.status !== "active") {
          return { outcome: "rejected", reason: "operator_not_found" };
        }
        if (target.isSuperAdministrator) {
          return {
            outcome: "rejected",
            reason: "super_administrator_elevation_forbidden",
          };
        }

        const [activeGrant] = await transaction
          .select({ id: operatorBreakGlassGrants.id })
          .from(operatorBreakGlassGrants)
          .where(
            and(
              eq(operatorBreakGlassGrants.operatorId, target.id),
              isNull(operatorBreakGlassGrants.revokedAt),
              gt(operatorBreakGlassGrants.expiresAt, input.now),
            ),
          )
          .orderBy(desc(operatorBreakGlassGrants.grantedAt))
          .limit(1);

        if (activeGrant !== undefined) {
          return {
            outcome: "rejected",
            reason: "active_break_glass_grant_exists",
          };
        }

        await transaction.insert(operatorBreakGlassGrants).values({
          id: input.id,
          operatorId: target.id,
          capabilities: [...input.capabilities],
          reason: input.reason,
          incidentReference: input.incidentReference,
          approvalReference: input.approvalReference,
          grantedByOperatorId: input.actorId,
          correlationId: input.correlationId,
          grantedAt: input.now,
          expiresAt: input.expiresAt,
        });
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.operator.break_glass.granted",
          targetType: "operator_break_glass_grant",
          targetId: input.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            targetOperatorId: target.id,
            capabilities: [...input.capabilities],
            incidentReference: input.incidentReference,
            approvalReference: input.approvalReference,
            expiresAt: input.expiresAt.toISOString(),
          },
          occurredAt: input.now,
        });

        return { outcome: "created", id: input.id };
      });
    },

    revokeGrant(input) {
      return database.transaction(async (transaction) => {
        await assertActiveSuperAdministrator(transaction, input.actorId);
        const [grant] = await transaction
          .select({
            id: operatorBreakGlassGrants.id,
            revokedAt: operatorBreakGlassGrants.revokedAt,
            expiresAt: operatorBreakGlassGrants.expiresAt,
          })
          .from(operatorBreakGlassGrants)
          .where(eq(operatorBreakGlassGrants.id, input.grantId))
          .limit(1)
          .for("update");

        if (grant === undefined) {
          return {
            outcome: "rejected",
            reason: "break_glass_grant_not_found",
          };
        }
        if (grant.revokedAt !== null || grant.expiresAt <= input.now) {
          return {
            outcome: "rejected",
            reason: "break_glass_grant_not_active",
          };
        }

        await transaction
          .update(operatorBreakGlassGrants)
          .set({
            revokedByOperatorId: input.actorId,
            revokedReason: input.reason,
            revokedCorrelationId: input.correlationId,
            revokedAt: input.now,
          })
          .where(eq(operatorBreakGlassGrants.id, grant.id));
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.operator.break_glass.revoked",
          targetType: "operator_break_glass_grant",
          targetId: grant.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { revokedAt: input.now.toISOString() },
          occurredAt: input.now,
        });

        return { outcome: "updated", id: grant.id };
      });
    },

    reviewGrant(input) {
      return database.transaction(async (transaction) => {
        await assertBreakGlassReviewer(transaction, input.actorId);
        const [grant] = await transaction
          .select({
            id: operatorBreakGlassGrants.id,
            operatorId: operatorBreakGlassGrants.operatorId,
            expiresAt: operatorBreakGlassGrants.expiresAt,
            revokedAt: operatorBreakGlassGrants.revokedAt,
          })
          .from(operatorBreakGlassGrants)
          .where(eq(operatorBreakGlassGrants.id, input.grantId))
          .limit(1)
          .for("update");

        if (grant === undefined) {
          return {
            outcome: "rejected",
            reason: "break_glass_grant_not_found",
          };
        }
        if (grant.operatorId === input.actorId) {
          return {
            outcome: "rejected",
            reason: "break_glass_self_review_forbidden",
          };
        }
        if (grant.revokedAt === null && grant.expiresAt > input.now) {
          return {
            outcome: "rejected",
            reason: "break_glass_review_requires_terminal_grant",
          };
        }

        const [review] = await transaction
          .select({ id: operatorBreakGlassReviews.id })
          .from(operatorBreakGlassReviews)
          .where(eq(operatorBreakGlassReviews.grantId, grant.id))
          .limit(1);
        if (review !== undefined) {
          return {
            outcome: "rejected",
            reason: "break_glass_grant_already_reviewed",
          };
        }

        await transaction.insert(operatorBreakGlassReviews).values({
          id: input.id,
          grantId: grant.id,
          reviewerOperatorId: input.actorId,
          outcome: input.outcome,
          summary: input.summary,
          correlationId: input.correlationId,
          reviewedAt: input.now,
        });
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.operator.break_glass.reviewed",
          targetType: "operator_break_glass_grant",
          targetId: grant.id,
          correlationId: input.correlationId,
          reason: input.summary,
          evidence: { outcome: input.outcome, reviewId: input.id },
          occurredAt: input.now,
        });

        return { outcome: "created", id: input.id };
      });
    },
  };
}

async function assertActiveSuperAdministrator(
  transaction: Transaction,
  operatorId: string,
) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(
      and(
        eq(operators.id, operatorId),
        eq(operators.status, "active"),
        eq(operators.isSuperAdministrator, true),
      ),
    )
    .limit(1)
    .for("update");
  if (actor === undefined) throw new Error("operator_command_forbidden");
}

async function assertBreakGlassReviewer(
  transaction: Transaction,
  operatorId: string,
) {
  const [actor] = await transaction
    .select({
      id: operators.id,
      isSuperAdministrator: operators.isSuperAdministrator,
    })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.status, "active")))
    .limit(1)
    .for("update");
  if (actor === undefined) throw new Error("operator_command_forbidden");
  if (actor.isSuperAdministrator) return;

  const assignments = await transaction
    .select({ capabilities: operatorRoleDefinitions.capabilities })
    .from(operatorRoleAssignments)
    .innerJoin(
      operatorRoleDefinitions,
      eq(operatorRoleDefinitions.id, operatorRoleAssignments.roleDefinitionId),
    )
    .where(
      and(
        eq(operatorRoleAssignments.operatorId, operatorId),
        isNull(operatorRoleAssignments.revokedAt),
      ),
    );
  if (
    !assignments.some((assignment) =>
      assignment.capabilities.some((grant) =>
        capabilityGrantMatches(grant, "platform:operators:break-glass:review"),
      ),
    )
  ) {
    throw new Error("operator_command_forbidden");
  }
}
