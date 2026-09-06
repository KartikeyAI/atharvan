import {
  OnboardingCommandRejectedError,
  type OperatorLifecycleStore,
} from "@atharvan/auth";
import {
  isOperatorEmailDomainAllowed,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";
import { and, eq, gt, gte, lte, isNull, inArray, sql } from "drizzle-orm";
import { consumePlatformApproval } from "./platform-approval-store";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import * as schema from "./schema";
import {
  operators,
  session,
  allowedEmailDomains,
  operatorInvitations,
  operatorVerificationChallenges,
  operatorBreakGlassGrants,
  auditEvents,
  passkey,
} from "./schema";

/** A single transaction invalidates access and records evidence, or changes nothing. */
export function createPostgresOperatorLifecycleStore(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
  environment: PlatformConfigurationEnvironment,
): OperatorLifecycleStore {
  return {
    transferOwnership(input) {
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('atharvan:super-administrator-bootstrap'))`,
        );
        const [actor] = await tx
          .select()
          .from(operators)
          .where(
            and(
              eq(operators.id, input.actorId),
              eq(operators.isSuperAdministrator, true),
              eq(operators.status, "active"),
            ),
          )
          .for("update");
        if (!actor?.authUserId || actor.id === input.successorOperatorId)
          throw new Error("operator_command_forbidden");
        const [proof] = await tx
          .select({ id: session.id })
          .from(session)
          .where(
            and(
              eq(session.id, input.sessionId),
              eq(session.userId, actor.authUserId),
              eq(session.authenticationMethod, "passkey"),
              gt(session.expiresAt, input.now),
              gte(
                session.strongAuthenticationAt,
                new Date(input.now.getTime() - 300_000),
              ),
              lte(session.strongAuthenticationAt, input.now),
            ),
          )
          .for("update");
        if (!proof) throw new Error("recent_step_up_required");
        const [successor] = await tx
          .select()
          .from(operators)
          .where(
            and(
              eq(operators.id, input.successorOperatorId),
              eq(operators.status, "active"),
            ),
          )
          .for("update");
        if (!successor?.authUserId || successor.isSuperAdministrator)
          reject("ownership_successor_ineligible");
        if (input.confirmation !== `TRANSFER PLATFORM TO ${successor.email}`)
          reject("operator_confirmation_mismatch");
        const domains = await tx
          .select()
          .from(allowedEmailDomains)
          .where(eq(allowedEmailDomains.isActive, true))
          .for("share");
        if (!isOperatorEmailDomainAllowed(successor.email, domains))
          reject("domain_not_allowed");
        const [credential] = await tx
          .select({ id: passkey.id })
          .from(passkey)
          .where(eq(passkey.userId, successor.authUserId))
          .limit(1)
          .for("share");
        if (!credential) reject("operator_passkey_required");
        await consumePlatformApproval(tx, {
          actorId: actor.id,
          environment,
          approvalId: input.approvalId,
          scope: {
            kind: "platform_ownership_transfer",
            currentOwnerOperatorId: actor.id,
            successorOperatorId: successor.id,
          },
          correlationId: input.correlationId,
          now: input.now,
        });
        // The partial unique index forbids two owners; a deferred trigger forbids losing the last owner.
        await tx
          .update(operators)
          .set({ isSuperAdministrator: false, updatedAt: input.now })
          .where(eq(operators.id, actor.id));
        await tx
          .update(operators)
          .set({ isSuperAdministrator: true, updatedAt: input.now })
          .where(eq(operators.id, successor.id));
        const revoked = await tx
          .delete(session)
          .where(
            inArray(session.userId, [actor.authUserId, successor.authUserId]),
          )
          .returning({ id: session.id });
        const revokedGrants = await tx
          .update(operatorBreakGlassGrants)
          .set({
            revokedAt: input.now,
            revokedByOperatorId: actor.id,
            revokedReason: input.reason,
            revokedCorrelationId: input.correlationId,
          })
          .where(
            and(
              inArray(operatorBreakGlassGrants.operatorId, [
                actor.id,
                successor.id,
              ]),
              isNull(operatorBreakGlassGrants.revokedAt),
              gt(operatorBreakGlassGrants.expiresAt, input.now),
            ),
          )
          .returning({ id: operatorBreakGlassGrants.id });
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          eventType: "platform.super_administrator.transferred",
          targetType: "operator",
          targetId: successor.id,
          reason: input.reason,
          correlationId: input.correlationId,
          occurredAt: input.now,
          evidence: {
            previousOwnerId: actor.id,
            successorId: successor.id,
            approvalId: input.approvalId,
            revokedSessionCount: revoked.length,
            revokedBreakGlassGrantIds: revokedGrants.map((grant) => grant.id),
            customerPrivateAuthority: false,
          },
        });
        const result = {
          outcome: "updated",
          operatorId: successor.id,
        } as const;
        await recordTransactionalCommandSuccess(
          tx,
          {
            ...input,
            environment,
            name: "operator.ownership.transfer",
            targetType: "operator",
            targetId: successor.id,
          },
          result,
        );
        return result;
      });
    },
    changeStatus(input) {
      return database.transaction(async (tx) => {
        const [actor] = await tx
          .select()
          .from(operators)
          .where(
            and(
              eq(operators.id, input.actorId),
              eq(operators.status, "active"),
              eq(operators.isSuperAdministrator, true),
            ),
          )
          .for("update");
        if (!actor?.authUserId) throw new Error("operator_command_forbidden");
        const [proof] = await tx
          .select({ id: session.id })
          .from(session)
          .where(
            and(
              eq(session.id, input.sessionId),
              eq(session.userId, actor.authUserId),
              eq(session.authenticationMethod, "passkey"),
              gt(session.expiresAt, input.now),
              lte(session.strongAuthenticationAt, input.now),
              gte(
                session.strongAuthenticationAt,
                new Date(input.now.getTime() - 300_000),
              ),
            ),
          )
          .for("update");
        if (!proof) throw new Error("recent_step_up_required");
        const [target] = await tx
          .select()
          .from(operators)
          .where(eq(operators.id, input.targetOperatorId))
          .for("update");
        if (!target) reject("operator_not_found");
        if (target.isSuperAdministrator || target.id === actor.id)
          reject("operator_owner_protected");
        if (target.status !== input.expectedStatus)
          reject("operator_status_conflict");
        if (
          input.confirmation !== `${input.action.toUpperCase()} ${target.email}`
        )
          reject("operator_confirmation_mismatch");
        if (target.status === "deactivated")
          reject("operator_deactivated_terminal");
        if (
          (input.action === "suspend" && target.status !== "active") ||
          (input.action === "restore" && target.status !== "suspended")
        )
          reject("operator_transition_invalid");

        if (input.action === "restore") {
          const domains = await tx
            .select()
            .from(allowedEmailDomains)
            .where(eq(allowedEmailDomains.isActive, true))
            .for("share");
          if (!isOperatorEmailDomainAllowed(target.email, domains))
            reject("domain_not_allowed");
          if (!target.authUserId || !target.activatedAt)
            reject("operator_activation_required");
          const [credential] = await tx
            .select({ id: passkey.id })
            .from(passkey)
            .where(eq(passkey.userId, target.authUserId))
            .limit(1)
            .for("share");
          if (!credential) reject("operator_passkey_required");
        }
        const status =
          input.action === "restore"
            ? "active"
            : input.action === "suspend"
              ? "suspended"
              : "deactivated";
        await tx
          .update(operators)
          .set({
            status,
            suspendedAt: status === "suspended" ? input.now : null,
            deactivatedAt: status === "deactivated" ? input.now : null,
            updatedAt: input.now,
          })
          .where(eq(operators.id, target.id));
        // Restore also removes old sessions: reactivation must never revive a stolen cookie.
        const removed = target.authUserId
          ? await tx
              .delete(session)
              .where(eq(session.userId, target.authUserId))
              .returning({ id: session.id })
          : [];
        await tx
          .update(operatorInvitations)
          .set({ status: "revoked", revokedAt: input.now })
          .where(
            and(
              eq(operatorInvitations.operatorId, target.id),
              eq(operatorInvitations.status, "pending"),
            ),
          );
        await tx
          .update(operatorVerificationChallenges)
          .set({ status: "superseded" })
          .where(
            and(
              eq(operatorVerificationChallenges.operatorId, target.id),
              eq(operatorVerificationChallenges.status, "pending"),
            ),
          );
        const grants = await tx
          .update(operatorBreakGlassGrants)
          .set({
            revokedAt: input.now,
            revokedByOperatorId: actor.id,
            revokedReason: input.reason,
            revokedCorrelationId: input.correlationId,
          })
          .where(
            and(
              eq(operatorBreakGlassGrants.operatorId, target.id),
              isNull(operatorBreakGlassGrants.revokedAt),
              gt(operatorBreakGlassGrants.expiresAt, input.now),
            ),
          )
          .returning({ id: operatorBreakGlassGrants.id });
        await tx.insert(auditEvents).values({
          actorId: actor.id,
          eventType: `platform.operator.${input.action}`,
          targetType: "operator",
          targetId: target.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            previousStatus: target.status,
            resultingStatus: status,
            revokedSessionCount: removed.length,
            revokedBreakGlassGrantIds: grants.map((grant) => grant.id),
          },
          occurredAt: input.now,
        });
        const result = {
          outcome: "updated",
          operatorId: target.id,
          status,
          revokedSessionCount: removed.length,
        } as const;
        await recordTransactionalCommandSuccess(
          tx,
          {
            ...input,
            environment,
            name: "operator.status.change",
            targetType: "operator",
            targetId: target.id,
          },
          result,
        );
        return result;
      });
    },
  };
}

function reject(reason: string): never {
  throw new OnboardingCommandRejectedError(reason);
}
