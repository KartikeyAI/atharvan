import type {
  ArthCommandDeliveryHealth,
  ArthCommandAcknowledgement,
  LeasedArthCommand,
  PlatformConfigurationEnvironment,
} from "@atharvan/domain";
import { and, asc, desc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  arthCommandOutbox,
  arthWorkloadRequestNonces,
  auditEvents,
  customerAccessRestrictionObservations,
  customerAccessRestrictionRevisions,
  customerWorkspaceOwnershipTransferObservations,
  modelOperationalControlRevisions,
  platformAdapterReleaseRevisions,
  platformIntegrationRevisions,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const leaseMilliseconds = 60_000;
const nonceLifetimeMilliseconds = 5 * 60_000;
const maximumAttempts = 10;

export class ArthCommandExchangeError extends Error {
  constructor(readonly reason: string) {
    super("arth_command_exchange_rejected");
  }
}

export function createPostgresArthCommandExchange(
  database: Database,
  environment: PlatformConfigurationEnvironment,
) {
  return {
    async readHealth(): Promise<ArthCommandDeliveryHealth> {
      const result = await database.execute<{
        observedAt: string;
        pending: number;
        leased: number;
        rejected: number;
        deadLetters: number;
        oldestOutstandingAt: string | null;
      }>(sql`SELECT
        clock_timestamp()::text AS "observedAt",
        count(*) FILTER (WHERE state = 'pending')::integer AS pending,
        count(*) FILTER (WHERE state = 'leased')::integer AS leased,
        count(*) FILTER (
          WHERE state = 'rejected' AND updated_at >= clock_timestamp() - interval '15 minutes'
        )::integer AS rejected,
        count(*) FILTER (
          WHERE state = 'dead_letter' AND updated_at >= clock_timestamp() - interval '15 minutes'
        )::integer AS "deadLetters",
        min(created_at) FILTER (WHERE state IN ('pending', 'leased'))::text AS "oldestOutstandingAt"
        FROM ${arthCommandOutbox}
        WHERE environment = ${environment}`);
      if (
        typeof result !== "object" ||
        result === null ||
        !("rows" in result) ||
        !Array.isArray(result.rows)
      ) {
        throw new Error("arth_command_health_unavailable");
      }
      const row = result.rows[0] as
        | {
            observedAt: string;
            pending: number;
            leased: number;
            rejected: number;
            deadLetters: number;
            oldestOutstandingAt: string | null;
          }
        | undefined;
      if (row === undefined) throw new Error("arth_command_health_unavailable");
      const counts = [row.pending, row.leased, row.rejected, row.deadLetters];
      if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("arth_command_health_invalid");
      }
      const observedAt = new Date(row.observedAt).toISOString();
      const oldestOutstandingAt = row.oldestOutstandingAt
        ? new Date(row.oldestOutstandingAt).toISOString()
        : null;
      return {
        observedAt,
        pending: row.pending,
        leased: row.leased,
        rejected: row.rejected,
        deadLetters: row.deadLetters,
        oldestOutstandingAt,
      };
    },

    async consumeNonce(input: {
      readonly keyId: string;
      readonly nonce: string;
      readonly requestTimestamp: Date;
    }) {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        await transaction
          .delete(arthWorkloadRequestNonces)
          .where(lte(arthWorkloadRequestNonces.expiresAt, now));
        const [created] = await transaction
          .insert(arthWorkloadRequestNonces)
          .values({
            environment,
            keyId: input.keyId,
            nonce: input.nonce,
            requestTimestamp: input.requestTimestamp,
            expiresAt: new Date(now.getTime() + nonceLifetimeMilliseconds),
            receivedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: arthWorkloadRequestNonces.id });
        if (!created) reject("workload_request_replayed");
      });
    },

    claim(keyId: string): Promise<LeasedArthCommand | null> {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        await transaction
          .update(arthCommandOutbox)
          .set({
            state: "dead_letter",
            leaseToken: null,
            leaseExpiresAt: null,
            claimedByKeyId: null,
            lastErrorCode: sql`CASE WHEN ${arthCommandOutbox.expiresAt} <= ${now} THEN 'command_expired' ELSE 'retry_exhausted' END`,
            updatedAt: now,
          })
          .where(
            and(
              eq(arthCommandOutbox.environment, environment),
              or(
                lte(arthCommandOutbox.expiresAt, now),
                and(
                  sql`${arthCommandOutbox.attempts} >= ${maximumAttempts}`,
                  or(
                    eq(arthCommandOutbox.state, "pending"),
                    and(
                      eq(arthCommandOutbox.state, "leased"),
                      lte(arthCommandOutbox.leaseExpiresAt, now),
                    ),
                  ),
                ),
              ),
              or(
                eq(arthCommandOutbox.state, "pending"),
                eq(arthCommandOutbox.state, "leased"),
              ),
            ),
          );

        const [row] = await transaction
          .select()
          .from(arthCommandOutbox)
          .where(
            and(
              eq(arthCommandOutbox.environment, environment),
              gt(arthCommandOutbox.expiresAt, now),
              sql`${arthCommandOutbox.attempts} < ${maximumAttempts}`,
              or(
                and(
                  eq(arthCommandOutbox.state, "pending"),
                  lte(arthCommandOutbox.availableAt, now),
                ),
                and(
                  eq(arthCommandOutbox.state, "leased"),
                  lte(arthCommandOutbox.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .orderBy(
            asc(arthCommandOutbox.availableAt),
            asc(arthCommandOutbox.id),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return null;

        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds);
        const attempt = row.attempts + 1;
        await transaction
          .update(arthCommandOutbox)
          .set({
            state: "leased",
            attempts: attempt,
            leaseToken,
            leaseExpiresAt,
            claimedByKeyId: keyId,
            lastErrorCode: null,
            updatedAt: now,
          })
          .where(eq(arthCommandOutbox.id, row.id));
        await transaction.insert(auditEvents).values({
          actorId: null,
          commandId: row.commandId,
          eventType: "platform.arth_command.leased",
          targetType: row.kind,
          targetId: row.aggregateId,
          correlationId: crypto.randomUUID(),
          reason: "Arth claimed an outstanding platform command.",
          evidence: { deliveryId: row.id, attempt, workloadKeyId: keyId },
          occurredAt: now,
        });
        return {
          commandId: row.id,
          environment: row.environment,
          payload: row.payload,
          payloadSha256: row.payloadSha256,
          leaseToken,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          attempt,
        };
      });
    },

    acknowledge(input: {
      readonly keyId: string;
      readonly acknowledgementFingerprint: string;
      readonly acknowledgement: ArthCommandAcknowledgement;
    }) {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        const [row] = await transaction
          .select()
          .from(arthCommandOutbox)
          .where(
            and(
              eq(arthCommandOutbox.id, input.acknowledgement.commandId),
              eq(arthCommandOutbox.environment, environment),
            ),
          )
          .limit(1)
          .for("update");
        if (!row) reject("arth_command_not_found");
        if (row.state === "applied" || row.state === "rejected") {
          if (
            row.acknowledgementFingerprint === input.acknowledgementFingerprint
          ) {
            return { outcome: "already_completed" as const, state: row.state };
          }
          reject("arth_command_acknowledgement_conflict");
        }
        if (
          row.state !== "leased" ||
          row.leaseToken !== input.acknowledgement.leaseToken ||
          row.claimedByKeyId !== input.keyId ||
          !row.leaseExpiresAt ||
          row.leaseExpiresAt <= now
        ) {
          reject("arth_command_lease_invalid");
        }

        if (input.acknowledgement.outcome === "retryable_failure") {
          const exhausted =
            row.attempts >= maximumAttempts || row.expiresAt <= now;
          const backoffSeconds = Math.min(300, 2 ** row.attempts);
          await transaction
            .update(arthCommandOutbox)
            .set({
              state: exhausted ? "dead_letter" : "pending",
              availableAt: new Date(now.getTime() + backoffSeconds * 1_000),
              leaseToken: null,
              leaseExpiresAt: null,
              claimedByKeyId: null,
              lastErrorCode: exhausted
                ? "retry_exhausted"
                : "arth_retryable_failure",
              updatedAt: now,
            })
            .where(eq(arthCommandOutbox.id, row.id));
          await recordExchangeAudit(transaction, row, input.keyId, now, {
            eventType: exhausted
              ? "platform.arth_command.dead_lettered"
              : "platform.arth_command.retry_scheduled",
            outcome: input.acknowledgement.outcome,
          });
          return {
            outcome: exhausted
              ? ("dead_letter" as const)
              : ("retry_scheduled" as const),
            state: exhausted ? ("dead_letter" as const) : ("pending" as const),
          };
        }

        const sourceRevision = BigInt(input.acknowledgement.sourceRevision);
        await persistObservation(transaction, row, input.keyId, {
          sourceRevision,
          observedAt: new Date(input.acknowledgement.observedAt),
          message: input.acknowledgement.message ?? null,
          outcome: input.acknowledgement.outcome,
          synchronizedAt: now,
        });
        const state = input.acknowledgement.outcome;
        await transaction
          .update(arthCommandOutbox)
          .set({
            state,
            leaseToken: null,
            leaseExpiresAt: null,
            claimedByKeyId: null,
            acknowledgementFingerprint: input.acknowledgementFingerprint,
            acknowledgedSourceRevision: sourceRevision,
            observedAt: new Date(input.acknowledgement.observedAt),
            completedAt: now,
            lastErrorCode:
              state === "rejected" ? "arth_command_rejected" : null,
            updatedAt: now,
          })
          .where(eq(arthCommandOutbox.id, row.id));
        await recordExchangeAudit(transaction, row, input.keyId, now, {
          eventType: `platform.arth_command.${state}`,
          outcome: state,
          sourceRevision: input.acknowledgement.sourceRevision,
        });
        return { outcome: "completed" as const, state };
      });
    },
  };
}

async function persistObservation(
  transaction: Transaction,
  row: typeof arthCommandOutbox.$inferSelect,
  keyId: string,
  input: {
    readonly sourceRevision: bigint;
    readonly observedAt: Date;
    readonly synchronizedAt: Date;
    readonly outcome: "applied" | "rejected";
    readonly message: string | null;
  },
) {
  if (row.kind === "customer_restriction") {
    const payload = row.payload;
    if (payload.kind !== "customer_restriction")
      reject("arth_command_payload_invalid");
    const [revision] = await transaction
      .select({ desiredState: customerAccessRestrictionRevisions.desiredState })
      .from(customerAccessRestrictionRevisions)
      .where(
        and(
          eq(
            customerAccessRestrictionRevisions.restrictionId,
            payload.restrictionId,
          ),
          eq(
            customerAccessRestrictionRevisions.revisionNumber,
            payload.revisionNumber,
          ),
        ),
      )
      .limit(1);
    if (!revision || revision.desiredState !== payload.desiredState)
      reject("arth_command_aggregate_changed");
    const [latest] = await transaction
      .select({
        sourceRevision: customerAccessRestrictionObservations.sourceRevision,
      })
      .from(customerAccessRestrictionObservations)
      .where(
        eq(
          customerAccessRestrictionObservations.restrictionId,
          payload.restrictionId,
        ),
      )
      .orderBy(desc(customerAccessRestrictionObservations.sourceRevision))
      .limit(1);
    if (latest && input.sourceRevision <= latest.sourceRevision)
      reject("arth_source_revision_stale");
    await transaction.insert(customerAccessRestrictionObservations).values({
      restrictionId: payload.restrictionId,
      desiredRevisionNumber: payload.revisionNumber,
      sourceRevision: input.sourceRevision,
      observedState:
        input.outcome === "applied" ? payload.desiredState : "failed",
      message:
        input.outcome === "rejected"
          ? (input.message ?? "Arth rejected the requested restriction state.")
          : input.message,
      observedAt: input.observedAt,
      synchronizedAt: input.synchronizedAt,
      actorId: null,
      sourceWorkloadKeyId: keyId,
      correlationId: crypto.randomUUID(),
    });
    return;
  }

  if (row.kind === "model_routing_control") {
    const payload = row.payload;
    if (payload.kind !== "model_routing_control")
      reject("arth_command_payload_invalid");
    const [revision] = await transaction
      .select({
        state: modelOperationalControlRevisions.state,
        maintenanceExpiresAt:
          modelOperationalControlRevisions.maintenanceExpiresAt,
      })
      .from(modelOperationalControlRevisions)
      .where(
        and(
          eq(modelOperationalControlRevisions.controlId, payload.controlId),
          eq(
            modelOperationalControlRevisions.revisionNumber,
            payload.revisionNumber,
          ),
        ),
      )
      .limit(1);
    if (
      !revision ||
      revision.state !== payload.state ||
      revision.maintenanceExpiresAt?.toISOString() !==
        (payload.maintenanceExpiresAt ?? undefined)
    )
      reject("arth_command_aggregate_changed");
    return;
  }

  if (row.kind === "platform_integration_control") {
    const payload = row.payload;
    if (payload.kind !== "platform_integration_control")
      reject("arth_command_payload_invalid");
    const [revision] = await transaction
      .select({
        lifecycle: platformIntegrationRevisions.lifecycle,
        operationalState: platformIntegrationRevisions.operationalState,
        maintenanceExpiresAt: platformIntegrationRevisions.maintenanceExpiresAt,
      })
      .from(platformIntegrationRevisions)
      .where(
        and(
          eq(platformIntegrationRevisions.integrationId, payload.integrationId),
          eq(
            platformIntegrationRevisions.revisionNumber,
            payload.revisionNumber,
          ),
        ),
      )
      .limit(1);
    if (
      !revision ||
      revision.lifecycle !== payload.lifecycle ||
      revision.operationalState !== payload.operationalState ||
      revision.maintenanceExpiresAt?.toISOString() !==
        (payload.maintenanceExpiresAt ?? undefined)
    )
      reject("arth_command_aggregate_changed");
    return;
  }

  if (row.kind === "platform_adapter_release_control") {
    const payload = row.payload;
    if (payload.kind !== "platform_adapter_release_control")
      reject("arth_command_payload_invalid");
    const [revision] = await transaction
      .select({
        lifecycle: platformAdapterReleaseRevisions.lifecycle,
        releaseChannel: platformAdapterReleaseRevisions.releaseChannel,
        signatureStatus: platformAdapterReleaseRevisions.signatureStatus,
        securityReviewStatus:
          platformAdapterReleaseRevisions.securityReviewStatus,
      })
      .from(platformAdapterReleaseRevisions)
      .where(
        and(
          eq(platformAdapterReleaseRevisions.releaseId, payload.releaseId),
          eq(
            platformAdapterReleaseRevisions.revisionNumber,
            payload.revisionNumber,
          ),
        ),
      )
      .limit(1);
    if (
      !revision ||
      revision.lifecycle !== payload.lifecycle ||
      revision.releaseChannel !== payload.releaseChannel ||
      revision.signatureStatus !== payload.signatureStatus ||
      revision.securityReviewStatus !== payload.securityReviewStatus
    )
      reject("arth_command_aggregate_changed");
    return;
  }

  const payload = row.payload;
  if (payload.kind !== "workspace_ownership_transfer")
    reject("arth_command_payload_invalid");
  const [latest] = await transaction
    .select({
      sourceRevision:
        customerWorkspaceOwnershipTransferObservations.sourceRevision,
    })
    .from(customerWorkspaceOwnershipTransferObservations)
    .where(
      eq(
        customerWorkspaceOwnershipTransferObservations.transferId,
        payload.transferId,
      ),
    )
    .orderBy(
      desc(customerWorkspaceOwnershipTransferObservations.sourceRevision),
    )
    .limit(1);
  if (latest && input.sourceRevision <= latest.sourceRevision)
    reject("arth_source_revision_stale");
  await transaction
    .insert(customerWorkspaceOwnershipTransferObservations)
    .values({
      transferId: payload.transferId,
      sourceRevision: input.sourceRevision,
      observedState: input.outcome === "applied" ? "observed" : "failed",
      observedOwnerUserSourceId:
        input.outcome === "applied" ? payload.successorUserId : null,
      message:
        input.outcome === "rejected"
          ? (input.message ?? "Arth rejected the requested ownership transfer.")
          : input.message,
      observedAt: input.observedAt,
      synchronizedAt: input.synchronizedAt,
      actorId: null,
      sourceWorkloadKeyId: keyId,
      correlationId: crypto.randomUUID(),
    });
}

async function recordExchangeAudit(
  transaction: Transaction,
  row: typeof arthCommandOutbox.$inferSelect,
  keyId: string,
  now: Date,
  evidence: { readonly eventType: string } & Record<string, string>,
) {
  await transaction.insert(auditEvents).values({
    actorId: null,
    commandId: row.commandId,
    eventType: evidence.eventType,
    targetType: row.kind,
    targetId: row.aggregateId,
    correlationId: crypto.randomUUID(),
    reason: "Record the result reported by the authenticated Arth workload.",
    evidence: { ...evidence, deliveryId: row.id, workloadKeyId: keyId },
    occurredAt: now,
  });
}

async function databaseNow(transaction: Transaction) {
  const [row] = await transaction
    .select({ now: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock_source`);
  const now = new Date(row?.now ?? "");
  if (!Number.isFinite(now.getTime()))
    throw new Error("database_clock_unavailable");
  return now;
}

function reject(reason: string): never {
  throw new ArthCommandExchangeError(reason);
}
