import type {
  AlertDeliveryEnvironment,
  OperationalAlertDeliveryStore,
  RoutableOperationalAlert,
} from "@atharvan/email";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import type * as schema from "./schema";
import {
  auditEvents,
  operationalAlertDeliveries as deliveries,
  operationalAlertOccurrences as occurrences,
  transactionalEmailRecipientSuppressions,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** PostgreSQL owns occurrence deduplication, transition outbox state, and lease fencing. */
export function createPostgresOperationalAlertDeliveryStore(
  database: Database,
): OperationalAlertDeliveryStore {
  return {
    reconcile(environment, alerts, observedAt, deliveryIdentity) {
      validateSnapshot(environment, alerts, observedAt);
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`atharvan:alerts:${environment}`}, 0))`,
        );
        const now = await databaseNow(tx);
        if (Math.abs(now.getTime() - observedAt.getTime()) > 5 * 60_000)
          throw new Error("operational_alert_snapshot_stale");
        const openRows = await tx
          .select()
          .from(occurrences)
          .where(
            and(
              eq(occurrences.environment, environment),
              eq(occurrences.status, "open"),
            ),
          )
          .for("update");
        const existing = new Map(openRows.map((row) => [row.alertKey, row]));
        const current = new Set(alerts.map((alert) => alert.id));
        let opened = 0;
        let resolved = 0;

        for (const alert of alerts) {
          const row = existing.get(alert.id);
          if (row) {
            await tx
              .update(occurrences)
              .set({
                source: alert.source,
                code: alert.code,
                severity: alert.severity,
                affectedCount: alert.affectedCount,
                title: alert.title,
                description: alert.description,
                nextStep: alert.nextStep,
                lastSeenAt: now,
                updatedAt: now,
              })
              .where(eq(occurrences.id, row.id));
            continue;
          }
          const [created] = await tx
            .insert(occurrences)
            .values({
              environment,
              alertKey: alert.id,
              source: alert.source,
              code: alert.code,
              severity: alert.severity,
              affectedCount: alert.affectedCount,
              title: alert.title,
              description: alert.description,
              nextStep: alert.nextStep,
              firstSeenAt: now,
              lastSeenAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: occurrences.id });
          if (!created)
            throw new Error("operational_alert_occurrence_not_created");
          await tx.insert(deliveries).values({
            occurrenceId: created.id,
            environment,
            kind: "triggered",
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
            ...deliveryIdentity,
          });
          await recordAudit(tx, created.id, alert.id, "opened", now, {
            severity: alert.severity,
            source: alert.source,
          });
          opened++;
        }

        for (const row of openRows) {
          if (current.has(row.alertKey)) continue;
          await tx
            .update(occurrences)
            .set({ status: "resolved", resolvedAt: now, updatedAt: now })
            .where(
              and(eq(occurrences.id, row.id), eq(occurrences.status, "open")),
            );
          await tx.insert(deliveries).values({
            occurrenceId: row.id,
            environment,
            kind: "resolved",
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
            ...deliveryIdentity,
          });
          await recordAudit(tx, row.id, row.alertKey, "resolved", now, {
            severity: row.severity,
            source: row.source,
          });
          resolved++;
        }
        return { opened, resolved };
      });
    },
    claim(environment) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const exhausted = await tx
          .select({
            id: deliveries.id,
            occurrenceId: deliveries.occurrenceId,
            alertKey: occurrences.alertKey,
            kind: deliveries.kind,
            attempts: deliveries.attempts,
          })
          .from(deliveries)
          .innerJoin(occurrences, eq(occurrences.id, deliveries.occurrenceId))
          .where(
            and(
              eq(deliveries.environment, environment),
              eq(deliveries.state, "leased"),
              lte(deliveries.leaseExpiresAt, now),
              sql`${deliveries.attempts} >= 8`,
            ),
          )
          .orderBy(asc(deliveries.leaseExpiresAt), asc(deliveries.id))
          .limit(16)
          .for("update", { of: deliveries, skipLocked: true });
        for (const expired of exhausted) {
          await tx
            .update(deliveries)
            .set({
              state: "dead_letter",
              leaseToken: null,
              leaseExpiresAt: null,
              reason: "retry_exhausted",
              updatedAt: now,
            })
            .where(
              and(
                eq(deliveries.id, expired.id),
                eq(deliveries.state, "leased"),
              ),
            );
          await recordAudit(
            tx,
            expired.occurrenceId,
            expired.alertKey,
            `${expired.kind}_retry_exhausted`,
            now,
            { attempt: expired.attempts },
          );
        }
        const [row] = await tx
          .select({
            id: deliveries.id,
            occurrenceId: deliveries.occurrenceId,
            environment: deliveries.environment,
            kind: deliveries.kind,
            attempts: deliveries.attempts,
            firstSeenAt: occurrences.firstSeenAt,
            resolvedAt: occurrences.resolvedAt,
            alertKey: occurrences.alertKey,
            source: occurrences.source,
            code: occurrences.code,
            severity: occurrences.severity,
            affectedCount: occurrences.affectedCount,
            title: occurrences.title,
            description: occurrences.description,
            nextStep: occurrences.nextStep,
            recipientFingerprint: deliveries.recipientFingerprint,
            templateVersion: deliveries.templateVersion,
            templateLocale: deliveries.templateLocale,
          })
          .from(deliveries)
          .innerJoin(occurrences, eq(occurrences.id, deliveries.occurrenceId))
          .where(
            and(
              eq(deliveries.environment, environment),
              lte(deliveries.nextAttemptAt, now),
              sql`${deliveries.attempts} < 8`,
              or(
                eq(deliveries.state, "pending"),
                and(
                  eq(deliveries.state, "leased"),
                  lte(deliveries.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .orderBy(asc(deliveries.nextAttemptAt), asc(deliveries.id))
          .limit(1)
          .for("update", { of: deliveries, skipLocked: true });
        if (!row) return null;
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + 60_000);
        const attempts = row.attempts + 1;
        await tx
          .update(deliveries)
          .set({
            state: "leased",
            attempts,
            leaseToken,
            leaseExpiresAt,
            reason: "delivery_started",
            updatedAt: now,
          })
          .where(eq(deliveries.id, row.id));
        return {
          id: row.id,
          occurrenceId: row.occurrenceId,
          environment: row.environment,
          kind: row.kind,
          alert: {
            id: row.alertKey,
            source: row.source,
            code: row.code,
            severity: row.severity,
            affectedCount: row.affectedCount,
            title: row.title,
            description: row.description,
            nextStep: row.nextStep,
          },
          firstSeenAt: row.firstSeenAt,
          resolvedAt: row.resolvedAt,
          attempts,
          leaseToken,
          leaseExpiresAt,
          recipientFingerprint: row.recipientFingerprint,
          templateVersion: row.templateVersion as "v1" | "v2",
          templateLocale: row.templateLocale as "en" | "hi",
        };
      });
    },
    settle(lease, result) {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const [updated] = await tx
          .update(deliveries)
          .set({
            state: result.state,
            leaseToken: null,
            leaseExpiresAt: null,
            providerMessageId:
              result.state === "accepted" ? result.providerMessageId : null,
            reason:
              result.state === "accepted"
                ? "provider_accepted"
                : result.state === "pending"
                  ? "delivery_uncertain"
                  : result.reason,
            ...(result.state === "pending"
              ? { nextAttemptAt: result.nextAttemptAt }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(deliveries.id, lease.id),
              eq(deliveries.environment, lease.environment),
              eq(deliveries.state, "leased"),
              eq(deliveries.leaseToken, lease.leaseToken),
              sql`${deliveries.leaseExpiresAt} > ${now}`,
            ),
          )
          .returning({ id: deliveries.id });
        if (!updated) return false;
        if (result.state !== "pending") {
          await recordAudit(
            tx,
            lease.occurrenceId,
            lease.alert.id,
            result.state === "accepted"
              ? `${lease.kind}_delivered`
              : `${lease.kind}_dead_lettered`,
            now,
            { attempt: lease.attempts },
          );
        }
        return true;
      });
    },
    async health(environment) {
      const [row] = await database
        .select({
          pending: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'pending')::integer`,
          leased: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'leased')::integer`,
          deadLetters: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'dead_letter' AND ${deliveries.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          bounced: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'bounced' AND ${deliveries.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          complained: sql<number>`count(*) FILTER (WHERE ${deliveries.state} = 'complained' AND ${deliveries.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          oldestPendingAt: sql<
            string | null
          >`min(${deliveries.createdAt}) FILTER (WHERE ${deliveries.state} IN ('pending','leased'))::text`,
          observedAt: sql<string>`clock_timestamp()::text`,
        })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.environment, environment),
            or(
              inArray(deliveries.state, ["pending", "leased"]),
              and(
                inArray(deliveries.state, [
                  "dead_letter",
                  "bounced",
                  "complained",
                ]),
                gte(
                  deliveries.updatedAt,
                  sql`clock_timestamp() - interval '15 minutes'`,
                ),
              ),
            ),
          ),
        );
      if (!row)
        throw new Error("operational_alert_delivery_health_unavailable");
      return {
        pending: row.pending,
        leased: row.leased,
        deadLetters: row.deadLetters,
        bounced: row.bounced,
        complained: row.complained,
        oldestPendingAt: row.oldestPendingAt
          ? new Date(row.oldestPendingAt).toISOString()
          : null,
        observedAt: new Date(row.observedAt).toISOString(),
      };
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

function validateSnapshot(
  environment: AlertDeliveryEnvironment,
  alerts: ReadonlyArray<RoutableOperationalAlert>,
  observedAt: Date,
) {
  if (!Number.isFinite(observedAt.getTime()) || alerts.length > 128)
    throw new Error("operational_alert_snapshot_invalid");
  const ids = new Set<string>();
  for (const alert of alerts) {
    if (
      !alert.id.startsWith(`${environment}:`) ||
      alert.id.length > 240 ||
      ids.has(alert.id) ||
      alert.source.length > 64 ||
      alert.code.length > 64 ||
      alert.title.length > 200 ||
      alert.description.length > 1_000 ||
      alert.nextStep.length > 1_000 ||
      (alert.affectedCount !== null &&
        (!Number.isSafeInteger(alert.affectedCount) || alert.affectedCount < 0))
    )
      throw new Error("operational_alert_snapshot_invalid");
    ids.add(alert.id);
  }
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

async function recordAudit(
  tx: Transaction,
  occurrenceId: string,
  alertKey: string,
  transition: string,
  now: Date,
  evidence: Record<string, string | number>,
) {
  await tx.insert(auditEvents).values({
    actorId: null,
    eventType: `platform.operational_alert.${transition}`,
    targetType: "operational_alert_occurrence",
    targetId: occurrenceId,
    correlationId: crypto.randomUUID(),
    reason: "Record a durable operational alert transition.",
    evidence: { alertKey, ...evidence },
    occurredAt: now,
  });
}
