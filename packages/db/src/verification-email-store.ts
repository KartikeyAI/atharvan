import type {
  VerificationDeliveryStore,
  DeliveryEnvironment,
} from "@atharvan/email";
import { PlatformCommandRejectedError } from "@atharvan/commands";
import type {
  EmailDeliveryPage,
  EmailDeliveryHealth,
  ManageEmailDeliveryCommand,
  RestoreEmailRecipientCommand,
} from "@atharvan/domain";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import * as schema from "./schema";
import {
  auditEvents,
  operators,
  verification,
  verificationEmailDeliveries as queue,
  transactionalEmailRecipientSuppressions,
  transactionalEmailProviderEvents,
} from "./schema";
import { lockActorProof } from "./platform-approval-store";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** PostgreSQL is the durable queue; SKIP LOCKED and fencing tokens coordinate overlapping runners. */
export function createPostgresVerificationDeliveryStore(
  database: Database,
): VerificationDeliveryStore {
  return {
    async findChallenge(email, digest) {
      const [row] = await database
        .select({ id: verification.id, expiresAt: verification.expiresAt })
        .from(verification)
        .where(
          and(
            eq(verification.identifier, `sign-in-otp-${email}`),
            eq(sql`split_part(${verification.value}, ':', 1)`, digest),
            latestChallenge(),
            gt(verification.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .orderBy(desc(verification.createdAt))
        .limit(1);
      return row ?? null;
    },
    enqueue(input) {
      return database.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(verification)
          .where(
            and(
              eq(verification.id, input.verificationId),
              eq(verification.identifier, `sign-in-otp-${input.email}`),
              eq(sql`split_part(${verification.value}, ':', 1)`, input.digest),
              eq(verification.expiresAt, input.expiresAt),
              latestChallenge(),
            ),
          )
          .for("share");
        const now = await databaseNow(tx);
        if (
          !challenge ||
          challenge.expiresAt.getTime() - now.getTime() <= 15_000
        )
          return false;
        const [operator] = await tx
          .select({ id: operators.id })
          .from(operators)
          .where(
            and(
              eq(operators.email, input.email),
              inArray(operators.status, [
                "invited",
                "verification_pending",
                "active",
              ]),
            ),
          )
          .for("share");
        if (!operator) return false;
        const [created] = await tx
          .insert(queue)
          .values({
            id: input.id,
            environment: input.environment,
            operatorId: operator.id,
            verificationId: input.verificationId,
            encryptedPayload: input.encryptedPayload,
            expiresAt: input.expiresAt,
            correlationId: input.correlationId,
            recipientFingerprint: input.recipientFingerprint,
            templateVersion: input.templateVersion,
            templateLocale: input.templateLocale,
            createdAt: now,
            updatedAt: now,
            nextAttemptAt: now,
          })
          .onConflictDoNothing({
            target: [queue.environment, queue.verificationId],
          })
          .returning();
        if (!created) return false;
        await audit(tx, created, "queued", now);
        return true;
      });
    },
    claim(environment, id) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const [row] = await tx
          .select()
          .from(queue)
          .where(
            and(
              eq(queue.environment, environment),
              id ? eq(queue.id, id) : undefined,
              gt(queue.expiresAt, now),
              lte(queue.nextAttemptAt, now),
              sql`${queue.attempts} < 5`,
              or(
                eq(queue.state, "pending"),
                and(eq(queue.state, "leased"), lte(queue.leaseExpiresAt, now)),
              ),
            ),
          )
          .orderBy(asc(queue.nextAttemptAt), asc(queue.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row || !row.encryptedPayload) return null;
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + 60_000);
        const attempts = row.attempts + 1;
        await tx
          .update(queue)
          .set({
            state: "leased",
            leaseToken,
            attempts,
            leaseExpiresAt,
            updatedAt: now,
            reason: "delivery_started",
          })
          .where(eq(queue.id, row.id));
        await audit(
          tx,
          { ...row, attempts, reason: "delivery_started" },
          "leased",
          now,
        );
        return {
          ...row,
          encryptedPayload: row.encryptedPayload,
          leaseToken,
          leaseExpiresAt,
          attempts,
        };
      });
    },
    async isCurrent(input, email, digest) {
      const [row] = await database
        .select({ id: queue.id })
        .from(queue)
        .innerJoin(verification, eq(verification.id, queue.verificationId))
        .where(
          and(
            eq(queue.id, input.id),
            eq(queue.leaseToken, input.leaseToken),
            eq(queue.state, "leased"),
            gt(queue.leaseExpiresAt, sql`clock_timestamp()`),
            gt(verification.expiresAt, sql`clock_timestamp()`),
            eq(verification.identifier, `sign-in-otp-${email}`),
            latestChallenge(),
            eq(sql`split_part(${verification.value}, ':', 1)`, digest),
          ),
        );
      return row !== undefined;
    },
    settle(input, result) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        let state = result.state;
        let reason = result.reason;
        if (
          state === "pending" &&
          (!result.nextAttemptAt || result.nextAttemptAt >= input.expiresAt)
        ) {
          state = "expired";
          reason = "challenge_expired";
        }
        const [row] = await tx
          .update(queue)
          .set({
            state,
            reason,
            updatedAt: now,
            leaseToken: null,
            leaseExpiresAt: null,
            encryptedPayload:
              state === "pending" ? input.encryptedPayload : null,
            providerMessageId: result.providerMessageId ?? null,
            ...(state === "pending" && result.nextAttemptAt
              ? { nextAttemptAt: result.nextAttemptAt }
              : {}),
          })
          .where(
            and(
              eq(queue.id, input.id),
              eq(queue.environment, input.environment),
              eq(queue.state, "leased"),
              eq(queue.leaseToken, input.leaseToken),
              gt(queue.leaseExpiresAt, now),
            ),
          )
          .returning();
        if (!row) return false; // A newer lease owns recovery; a stale runner cannot overwrite it.
        await audit(tx, row, state, now);
        return true;
      });
    },
    expire(environment) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const rows = await tx
          .select()
          .from(queue)
          .where(
            and(
              eq(queue.environment, environment),
              isNotNull(queue.encryptedPayload),
              or(
                lte(queue.expiresAt, now),
                and(
                  sql`${queue.attempts} >= 5`,
                  or(
                    eq(queue.state, "pending"),
                    lte(queue.leaseExpiresAt, now),
                  ),
                ),
              ),
            ),
          )
          .orderBy(asc(queue.expiresAt))
          .limit(100)
          .for("update", { skipLocked: true });
        for (const row of rows) {
          const state = row.expiresAt <= now ? "expired" : "dead_letter";
          const reason =
            state === "expired" ? "challenge_expired" : "retry_exhausted";
          await tx
            .update(queue)
            .set({
              state,
              reason,
              encryptedPayload: null,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(queue.id, row.id));
          await audit(tx, { ...row, reason }, state, now);
        }
        return rows.length;
      });
    },
    async isRecipientSuppressed(environment, recipientFingerprint) {
      const [row] = await database
        .select({ id: transactionalEmailRecipientSuppressions.id })
        .from(transactionalEmailRecipientSuppressions)
        .where(
          and(
            eq(
              transactionalEmailRecipientSuppressions.environment,
              environment,
            ),
            eq(
              transactionalEmailRecipientSuppressions.recipientFingerprint,
              recipientFingerprint,
            ),
            isNull(transactionalEmailRecipientSuppressions.liftedAt),
          ),
        )
        .limit(1);
      return row !== undefined;
    },
  };
}

/** Security views expose bounded operational metadata, never the recoverable OTP payload. */
export function createPostgresEmailDeliveryAdministration(
  database: Database,
  environment: DeliveryEnvironment,
) {
  return {
    async health(): Promise<EmailDeliveryHealth> {
      const [row] = await database
        .select({
          pending: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'pending')::integer`,
          leased: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'leased')::integer`,
          deadLetters: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'dead_letter' AND ${queue.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          expired: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'expired' AND ${queue.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          bounced: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'bounced' AND ${queue.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          complained: sql<number>`count(*) FILTER (WHERE ${queue.state} = 'complained' AND ${queue.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          activeSuppressions: sql<number>`(SELECT count(*)::integer FROM ${transactionalEmailRecipientSuppressions} AS recipient_suppression WHERE recipient_suppression.environment = ${environment} AND recipient_suppression.lifted_at IS NULL)`,
          oldestPendingAt: sql<
            string | null
          >`(min(${queue.createdAt}) FILTER (WHERE ${queue.state} = 'pending'))::text`,
          observedAt: sql<string>`clock_timestamp()::text`,
        })
        .from(queue)
        .where(
          and(
            eq(queue.environment, environment),
            or(
              inArray(queue.state, ["pending", "leased"]),
              and(
                inArray(queue.state, [
                  "dead_letter",
                  "expired",
                  "bounced",
                  "complained",
                ]),
                gte(
                  queue.updatedAt,
                  sql`clock_timestamp() - interval '15 minutes'`,
                ),
              ),
            ),
          ),
        );
      if (!row) throw new Error("email_delivery_health_unavailable");
      return {
        ...row,
        oldestPendingAt: row.oldestPendingAt
          ? new Date(row.oldestPendingAt).toISOString()
          : null,
        observedAt: new Date(row.observedAt).toISOString(),
      };
    },
    list(
      actorId: string,
      correlationId: string,
    ): Promise<
      Omit<
        EmailDeliveryPage,
        "providerConfigured" | "feedbackConfigured" | "canManage"
      >
    > {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const rows = await tx
          .select({
            id: queue.id,
            operatorId: queue.operatorId,
            state: queue.state,
            attempts: queue.attempts,
            createdAt: queue.createdAt,
            expiresAt: queue.expiresAt,
            nextAttemptAt: queue.nextAttemptAt,
            updatedAt: queue.updatedAt,
            reason: queue.reason,
            correlationId: queue.correlationId,
            templateVersion: queue.templateVersion,
            templateLocale: queue.templateLocale,
          })
          .from(queue)
          .where(eq(queue.environment, environment))
          .orderBy(desc(queue.createdAt), desc(queue.id))
          .limit(101);
        const suppressions = await tx
          .select({
            id: transactionalEmailRecipientSuppressions.id,
            reason: transactionalEmailRecipientSuppressions.reason,
            createdAt: transactionalEmailRecipientSuppressions.createdAt,
            verificationDeliveryId:
              transactionalEmailProviderEvents.verificationDeliveryId,
            operationalAlertDeliveryId:
              transactionalEmailProviderEvents.operationalAlertDeliveryId,
          })
          .from(transactionalEmailRecipientSuppressions)
          .innerJoin(
            transactionalEmailProviderEvents,
            eq(
              transactionalEmailProviderEvents.id,
              transactionalEmailRecipientSuppressions.sourceEventId,
            ),
          )
          .where(
            and(
              eq(
                transactionalEmailRecipientSuppressions.environment,
                environment,
              ),
              isNull(transactionalEmailRecipientSuppressions.liftedAt),
            ),
          )
          .orderBy(
            desc(transactionalEmailRecipientSuppressions.createdAt),
            desc(transactionalEmailRecipientSuppressions.id),
          )
          .limit(101);
        await tx.insert(auditEvents).values({
          actorId,
          eventType: "platform.email_delivery.inspected",
          targetType: "email_delivery_registry",
          targetId: environment,
          correlationId,
          reason: "Inspect verification delivery metadata.",
          evidence: {
            deliveryCount: Math.min(100, rows.length),
            activeSuppressionCount: Math.min(100, suppressions.length),
          },
          occurredAt: now,
        });
        return {
          items: rows.slice(0, 100).map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            nextAttemptAt: row.nextAttemptAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          })),
          activeSuppressions: suppressions.slice(0, 100).map((suppression) => {
            const source = suppression.verificationDeliveryId
              ? {
                  kind: "verification" as const,
                  deliveryId: suppression.verificationDeliveryId,
                }
              : suppression.operationalAlertDeliveryId
                ? {
                    kind: "operational_alert" as const,
                    deliveryId: suppression.operationalAlertDeliveryId,
                  }
                : null;
            if (!source) throw new Error("email_suppression_source_missing");
            return {
              id: suppression.id,
              reason: suppression.reason,
              createdAt: suppression.createdAt.toISOString(),
              source,
            };
          }),
          truncated: rows.length > 100,
          suppressionsTruncated: suppressions.length > 100,
          observedAt: now.toISOString(),
        };
      });
    },
    manage(actorId: string, input: ManageEmailDeliveryCommand) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const actor = await lockActorProof(tx, actorId, input.sessionId, now);
        if (!actor.isSuperAdministrator)
          throw new Error("operator_command_forbidden");
        const [row] = await tx
          .select()
          .from(queue)
          .where(
            and(
              eq(queue.id, input.deliveryId),
              eq(queue.environment, environment),
            ),
          )
          .for("update");
        if (
          !row ||
          row.state !== "pending" ||
          row.expiresAt <= now ||
          row.attempts >= 5
        )
          throw new PlatformCommandRejectedError("delivery_not_pending");
        await tx
          .update(queue)
          .set(
            input.action === "cancel"
              ? {
                  state: "cancelled",
                  encryptedPayload: null,
                  updatedAt: now,
                  reason: "operator_cancelled",
                }
              : {
                  nextAttemptAt: now,
                  updatedAt: now,
                  reason: "operator_retry_requested",
                },
          )
          .where(eq(queue.id, row.id));
        await tx.insert(auditEvents).values({
          actorId,
          eventType: `platform.email_delivery.${input.action}_requested`,
          targetType: "email_delivery",
          targetId: row.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { attempts: row.attempts, deadlineUnchanged: true },
          occurredAt: now,
        });
        const result = { outcome: "updated", id: row.id } as const;
        await recordTransactionalCommandSuccess(
          tx,
          {
            ...input,
            actorId,
            environment,
            now,
            name: "email.delivery.manage",
            targetType: "email_delivery",
            targetId: row.id,
          },
          result,
        );
        return result;
      });
    },
    restoreRecipient(actorId: string, input: RestoreEmailRecipientCommand) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const actor = await lockActorProof(tx, actorId, input.sessionId, now);
        if (!actor.isSuperAdministrator)
          throw new Error("operator_command_forbidden");
        const [suppression] = await tx
          .select({
            id: transactionalEmailRecipientSuppressions.id,
            sourceEventId:
              transactionalEmailRecipientSuppressions.sourceEventId,
          })
          .from(transactionalEmailRecipientSuppressions)
          .where(
            and(
              eq(
                transactionalEmailRecipientSuppressions.id,
                input.suppressionId,
              ),
              eq(
                transactionalEmailRecipientSuppressions.environment,
                environment,
              ),
              isNull(transactionalEmailRecipientSuppressions.liftedAt),
            ),
          )
          .for("update");
        if (!suppression)
          throw new PlatformCommandRejectedError(
            "recipient_suppression_not_active",
          );
        const [updated] = await tx
          .update(transactionalEmailRecipientSuppressions)
          .set({
            liftedAt: now,
            liftedByOperatorId: actorId,
            liftReason: input.reason,
            liftCorrelationId: input.correlationId,
          })
          .where(
            and(
              eq(transactionalEmailRecipientSuppressions.id, suppression.id),
              isNull(transactionalEmailRecipientSuppressions.liftedAt),
            ),
          )
          .returning({ id: transactionalEmailRecipientSuppressions.id });
        if (!updated)
          throw new PlatformCommandRejectedError(
            "recipient_suppression_not_active",
          );
        await tx.insert(auditEvents).values({
          actorId,
          eventType: "platform.email_recipient.restored",
          targetType: "transactional_email_recipient_suppression",
          targetId: suppression.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            sourceEventId: suppression.sourceEventId,
            futureMessagesOnly: true,
          },
          occurredAt: now,
        });
        const result = { outcome: "updated", id: suppression.id } as const;
        await recordTransactionalCommandSuccess(
          tx,
          {
            ...input,
            actorId,
            environment,
            now,
            name: "email.recipient.restore",
            targetType: "transactional_email_recipient_suppression",
            targetId: suppression.id,
          },
          result,
        );
        return result;
      });
    },
  };
}

async function databaseNow(tx: Transaction): Promise<Date> {
  const [row] = await tx
    .select({ now: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock_source`);
  const now = new Date(row?.now ?? "");
  if (!Number.isFinite(now.getTime()))
    throw new Error("database_clock_unavailable");
  return now;
}

/** Better Auth consumes the newest identifier row. Tied timestamps fail closed. */
function latestChallenge() {
  return sql`NOT EXISTS (SELECT 1 FROM auth.verification AS newer WHERE newer.identifier = ${verification.identifier}
    AND newer.id <> ${verification.id} AND newer.created_at >= ${verification.createdAt})`;
}
async function audit(
  tx: Transaction,
  row: {
    id: string;
    operatorId: string;
    correlationId: string;
    attempts: number;
    reason: string;
  },
  state: string,
  now: Date,
) {
  await tx.insert(auditEvents).values({
    eventType: `platform.email_delivery.${state}`,
    targetType: "email_delivery",
    targetId: row.id,
    correlationId: row.correlationId,
    reason: "Process a durable verification email delivery.",
    evidence: {
      operatorId: row.operatorId,
      attempt: row.attempts,
      reason: row.reason,
    },
    occurredAt: now,
  });
}
