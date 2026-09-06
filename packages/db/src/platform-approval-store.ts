import {
  approvalCapability,
  approvalScopeIdentity,
  PlatformCommandRejectedError,
  type PlatformApprovalStore,
} from "@atharvan/commands";
import {
  capabilityGrantMatches,
  type PlatformApprovalScope,
  type PlatformConfigurationEnvironment,
  type PlatformApprovalStatus,
} from "@atharvan/domain";
import { and, desc, eq, gt, gte, lte, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import * as schema from "./schema";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";
import {
  platformApprovals,
  operators,
  session,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  auditEvents,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Approval decisions and their audit evidence commit together. */
export function createPostgresPlatformApprovalStore(
  database: Database,
): PlatformApprovalStore {
  return {
    list(input) {
      return database.transaction(async (tx) => {
        const actor = await activeActor(tx, input.actorId);
        const mayReview = await hasBaseCapability(
          tx,
          actor,
          "platform:security:read",
        );
        const mayDecide = await hasBaseCapability(
          tx,
          actor,
          "platform:security:write",
        );
        const rows = await tx
          .select({ approval: platformApprovals, email: operators.email })
          .from(platformApprovals)
          .innerJoin(operators, eq(operators.id, platformApprovals.requesterId))
          .where(
            and(
              eq(platformApprovals.environment, input.environment),
              mayReview
                ? undefined
                : eq(platformApprovals.requesterId, input.actorId),
            ),
          )
          .orderBy(
            desc(platformApprovals.createdAt),
            desc(platformApprovals.id),
          )
          .limit(101);
        const now = new Date();
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          eventType: "platform.approvals.inspected",
          targetType: "approval_registry",
          targetId: input.environment,
          reason: "Review scoped administrative approval requests.",
          correlationId: input.correlationId,
          evidence: {
            scope: mayReview ? "reviewer" : "self",
            count: Math.min(rows.length, 100),
          },
          occurredAt: now,
        });
        return {
          truncated: rows.length > 100,
          items: rows.slice(0, 100).map(({ approval: row, email }) => ({
            id: row.id,
            requesterId: row.requesterId,
            requesterEmail: email,
            scope: row.scope,
            status: visibleStatus(row, now),
            reason: row.reason,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            decidedBy: row.decidedBy,
            decisionReason: row.decisionReason,
            decidedAt: row.decidedAt?.toISOString() ?? null,
            consumedAt: row.consumedAt?.toISOString() ?? null,
            allowedDecisions: allowedDecisions(row, actor.id, mayDecide, now),
          })),
        };
      });
    },
    request(input) {
      return database.transaction(async (tx) => {
        const actor = await lockActorProof(
          tx,
          input.actorId,
          input.sessionId,
          input.now,
        );
        if (
          !(await hasBaseCapability(
            tx,
            actor,
            approvalCapability(input.scope),
          )) ||
          (input.scope.kind !== "workspace_ownership_transfer" &&
            !actor.isSuperAdministrator)
        )
          throw new Error("operator_command_forbidden");
        if (
          input.scope.kind === "platform_ownership_transfer" &&
          input.scope.currentOwnerOperatorId !== actor.id
        )
          reject("approval_owner_mismatch");
        const [created] = await tx
          .insert(platformApprovals)
          .values({
            environment: input.environment,
            requesterId: actor.id,
            scope: input.scope,
            scopeIdentity: approvalScopeIdentity(input.scope),
            reason: input.reason,
            createdAt: input.now,
            expiresAt: input.expiresAt,
            correlationId: input.correlationId,
          })
          .returning({ id: platformApprovals.id });
        if (!created) reject("approval_create_failed");
        await audit(
          tx,
          actor.id,
          created.id,
          "requested",
          input.reason,
          input.correlationId,
          input.now,
          { scope: input.scope, expiresAt: input.expiresAt.toISOString() },
        );
        const result = { outcome: "created", id: created.id } as const;
        await recordTransactionalCommandSuccess(
          tx,
          {
            ...input,
            name: "approval.request",
            targetType: "approval_intent",
            targetId:
              input.scope.kind === "operator_break_glass"
                ? input.scope.targetOperatorId
                : input.scope.kind === "platform_ownership_transfer"
                  ? input.scope.successorOperatorId
                  : input.scope.workspaceId,
          },
          result,
        );
        return result;
      });
    },
    decide(input) {
      return database.transaction(async (tx) => {
        const actor = await lockActorProof(
          tx,
          input.actorId,
          input.sessionId,
          input.now,
        );
        const [row] = await tx
          .select()
          .from(platformApprovals)
          .where(
            and(
              eq(platformApprovals.id, input.approvalId),
              eq(platformApprovals.environment, input.environment),
            ),
          )
          .for("update");
        if (!row) reject("approval_not_found");
        const finish = async (outcome: "updated" | "unchanged") => {
          const result = { outcome, id: row.id };
          await recordTransactionalCommandSuccess(
            tx,
            {
              ...input,
              name: "approval.decide",
              targetType: "platform_approval",
              targetId: row.id,
            },
            result,
          );
          return result;
        };
        if (input.decision === "revoked") {
          if (
            actor.id !== row.requesterId &&
            actor.id !== row.decidedBy &&
            !(await hasBaseCapability(tx, actor, "platform:security:write"))
          )
            throw new Error("operator_command_forbidden");
          if (row.status === "revoked") return finish("unchanged");
        } else {
          if (
            row.scope.kind === "platform_ownership_transfer" &&
            actor.id !== row.scope.successorOperatorId
          )
            reject("approval_successor_acceptance_required");
          if (
            actor.id === row.requesterId ||
            (row.scope.kind === "operator_break_glass" &&
              row.scope.targetOperatorId === actor.id)
          )
            reject("approval_independent_reviewer_required");
          if (!(await hasBaseCapability(tx, actor, "platform:security:write")))
            throw new Error("operator_command_forbidden");
          if (
            row.status === input.decision &&
            row.decidedBy === actor.id &&
            row.decisionReason === input.reason
          )
            return finish("unchanged");
        }
        if (
          row.expiresAt <= input.now ||
          (row.status !== "pending" &&
            !(input.decision === "revoked" && row.status === "approved"))
        )
          reject("approval_not_pending");
        if (input.decision !== "revoked")
          await activeActor(tx, row.requesterId);
        await tx
          .update(platformApprovals)
          .set(
            input.decision === "revoked"
              ? {
                  status: "revoked",
                  revokedAt: input.now,
                  revokedBy: actor.id,
                  revokedReason: input.reason,
                }
              : {
                  status: input.decision,
                  decidedBy: actor.id,
                  decidedAt: input.now,
                  decisionReason: input.reason,
                },
          )
          .where(eq(platformApprovals.id, row.id));
        await audit(
          tx,
          actor.id,
          row.id,
          input.decision,
          input.reason,
          input.correlationId,
          input.now,
          {},
        );
        return finish("updated");
      });
    },
  };
}

/** Called within the protected mutation transaction: failed effects roll consumption back. */
export async function consumePlatformApproval(
  tx: Transaction,
  input: {
    approvalId: string;
    actorId: string;
    environment: PlatformConfigurationEnvironment;
    scope: PlatformApprovalScope;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.approvalId,
    )
  )
    reject("approval_required");
  const [row] = await tx
    .select()
    .from(platformApprovals)
    .where(
      and(
        eq(platformApprovals.id, input.approvalId),
        eq(platformApprovals.environment, input.environment),
      ),
    )
    .for("update");
  if (
    !row ||
    row.requesterId !== input.actorId ||
    row.status !== "approved" ||
    row.expiresAt <= input.now ||
    row.createdAt > input.now ||
    !row.decidedBy ||
    row.decidedBy === input.actorId ||
    row.scopeIdentity !== approvalScopeIdentity(input.scope)
  )
    reject("approval_scope_or_state_invalid");
  const approver = await activeActor(tx, row.decidedBy);
  if (!(await hasBaseCapability(tx, approver, "platform:security:write")))
    reject("approval_reviewer_no_longer_authorized");
  if (
    input.scope.kind === "operator_break_glass" &&
    input.scope.targetOperatorId === approver.id
  )
    reject("approval_independent_reviewer_required");
  if (
    input.scope.kind === "platform_ownership_transfer" &&
    input.scope.successorOperatorId !== approver.id
  )
    reject("approval_successor_acceptance_required");
  await tx
    .update(platformApprovals)
    .set({
      status: "consumed",
      consumedAt: input.now,
      consumedCorrelationId: input.correlationId,
    })
    .where(eq(platformApprovals.id, row.id));
  await audit(
    tx,
    input.actorId,
    row.id,
    "consumed",
    "Consume the exact independently approved administrative intent.",
    input.correlationId,
    input.now,
    {},
  );
}

async function activeActor(tx: Transaction, id: string) {
  const [actor] = await tx
    .select()
    .from(operators)
    .where(and(eq(operators.id, id), eq(operators.status, "active")))
    .for("share");
  if (!actor) throw new Error("operator_command_forbidden");
  return actor;
}
export async function lockActorProof(
  tx: Transaction,
  id: string,
  sessionId: string,
  now: Date,
) {
  const actor = await activeActor(tx, id);
  if (!actor.authUserId) throw new Error("operator_command_forbidden");
  const [proof] = await tx
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.userId, actor.authUserId),
        eq(session.authenticationMethod, "passkey"),
        gt(session.expiresAt, now),
        lte(session.strongAuthenticationAt, now),
        gte(session.strongAuthenticationAt, new Date(now.getTime() - 300_000)),
      ),
    )
    .for("share");
  if (!proof) throw new Error("recent_step_up_required");
  return actor;
}
export async function hasBaseCapability(
  tx: Transaction,
  actor: typeof operators.$inferSelect,
  capability: string,
) {
  if (actor.isSuperAdministrator) return true;
  // Emergency elevation cannot approve itself or delegate its own temporary authority.
  const roles = await tx
    .select({ capabilities: operatorRoleDefinitions.capabilities })
    .from(operatorRoleAssignments)
    .innerJoin(
      operatorRoleDefinitions,
      eq(operatorRoleAssignments.roleDefinitionId, operatorRoleDefinitions.id),
    )
    .where(
      and(
        eq(operatorRoleAssignments.operatorId, actor.id),
        isNull(operatorRoleAssignments.revokedAt),
      ),
    )
    .for("share");
  return roles.some((role) =>
    role.capabilities.some((grant) =>
      capabilityGrantMatches(grant, capability),
    ),
  );
}
function visibleStatus(
  row: typeof platformApprovals.$inferSelect,
  now: Date,
): PlatformApprovalStatus {
  return (row.status === "pending" || row.status === "approved") &&
    row.expiresAt <= now
    ? "expired"
    : row.status;
}
function allowedDecisions(
  row: typeof platformApprovals.$inferSelect,
  actorId: string,
  mayDecide: boolean,
  now: Date,
): ("approved" | "rejected" | "revoked")[] {
  if (
    row.expiresAt <= now ||
    (row.status !== "pending" && row.status !== "approved")
  )
    return [];
  const result: ("approved" | "rejected" | "revoked")[] = [];
  if (
    row.status === "pending" &&
    mayDecide &&
    row.requesterId !== actorId &&
    !(
      row.scope.kind === "operator_break_glass" &&
      row.scope.targetOperatorId === actorId
    ) &&
    (row.scope.kind !== "platform_ownership_transfer" ||
      row.scope.successorOperatorId === actorId)
  )
    result.push("approved", "rejected");
  if (mayDecide || row.requesterId === actorId || row.decidedBy === actorId)
    result.push("revoked");
  return result;
}
async function audit(
  tx: Transaction,
  actorId: string,
  targetId: string,
  action: string,
  reason: string,
  correlationId: string,
  occurredAt: Date,
  evidence: object,
) {
  await tx.insert(auditEvents).values({
    actorId,
    targetType: "platform_approval",
    targetId,
    eventType: `platform.approval.${action}`,
    reason,
    correlationId,
    occurredAt,
    evidence,
  });
}
function reject(reason: string): never {
  throw new PlatformCommandRejectedError(reason);
}
