import {
  operationalRetentionPolicies,
  type OperationalRetentionCounts,
  type OperationalRetentionHealth,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  arthWorkloadRequestNonces,
  auditEvents,
  modelProviderHealthObservations,
  operationalAlertDeliveries,
  operationalAlertOccurrences,
  operationalRetentionRuns,
  platformHealthProbeJobs,
  platformIntegrationHealthObservations,
  transactionalEmailProviderEvents,
  transactionalEmailRecipientSuppressions,
  verificationEmailDeliveries,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const batchSize = 1_000;
const dayMs = 24 * 60 * 60_000;

export interface LeasedOperationalRetentionRun {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly scheduledFor: Date;
  readonly leaseToken: string;
  readonly attempts: number;
}

/** Hourly, fenced, bounded retention for disposable operational records. */
export function createPostgresOperationalRetentionStore(database: Database) {
  return {
    async health(
      environment: PlatformConfigurationEnvironment,
    ): Promise<OperationalRetentionHealth> {
      const [clock] = await database
        .select({ now: sql<string>`clock_timestamp()::text` })
        .from(sql`(select 1) as clock_source`);
      const now = parseDatabaseDate(clock?.now);
      const [latest] = await database
        .select()
        .from(operationalRetentionRuns)
        .where(eq(operationalRetentionRuns.environment, environment))
        .orderBy(
          desc(operationalRetentionRuns.scheduledFor),
          desc(operationalRetentionRuns.id),
        )
        .limit(1);
      const [latestCompleted] = await database
        .select({
          completedAt: operationalRetentionRuns.completedAt,
          counts: operationalRetentionRuns.counts,
          batchLimitReached: operationalRetentionRuns.batchLimitReached,
        })
        .from(operationalRetentionRuns)
        .where(
          and(
            eq(operationalRetentionRuns.environment, environment),
            eq(operationalRetentionRuns.state, "completed"),
          ),
        )
        .orderBy(
          desc(operationalRetentionRuns.scheduledFor),
          desc(operationalRetentionRuns.id),
        )
        .limit(1);
      return {
        observedAt: now.toISOString(),
        state: latest?.state ?? "unknown",
        scheduledFor: latest?.scheduledFor.toISOString() ?? null,
        completedAt: latestCompleted?.completedAt?.toISOString() ?? null,
        counts: latestCompleted?.counts ?? null,
        batchLimitReached: latestCompleted?.batchLimitReached ?? false,
        policies: operationalRetentionPolicies,
      };
    },

    claim(
      environment: PlatformConfigurationEnvironment,
    ): Promise<LeasedOperationalRetentionRun | null> {
      return database.transaction(async (transaction) => {
        const { now, scheduledFor } = await databaseClock(transaction);
        await transaction
          .insert(operationalRetentionRuns)
          .values({
            environment,
            scheduledFor,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              operationalRetentionRuns.environment,
              operationalRetentionRuns.scheduledFor,
            ],
          });
        await transaction
          .update(operationalRetentionRuns)
          .set({
            state: "failed",
            leaseToken: null,
            leaseExpiresAt: null,
            errorCode: "lease_recovery_exhausted",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(operationalRetentionRuns.environment, environment),
              eq(operationalRetentionRuns.state, "running"),
              lte(operationalRetentionRuns.leaseExpiresAt, now),
              sql`${operationalRetentionRuns.attempts} >= 5`,
            ),
          );
        const [row] = await transaction
          .select()
          .from(operationalRetentionRuns)
          .where(
            and(
              eq(operationalRetentionRuns.environment, environment),
              sql`${operationalRetentionRuns.attempts} < 5`,
              lte(operationalRetentionRuns.nextAttemptAt, now),
              or(
                eq(operationalRetentionRuns.state, "pending"),
                and(
                  eq(operationalRetentionRuns.state, "running"),
                  lte(operationalRetentionRuns.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .orderBy(
            asc(operationalRetentionRuns.scheduledFor),
            asc(operationalRetentionRuns.id),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return null;
        const leaseToken = crypto.randomUUID();
        const attempts = row.attempts + 1;
        await transaction
          .update(operationalRetentionRuns)
          .set({
            state: "running",
            attempts,
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            updatedAt: now,
          })
          .where(eq(operationalRetentionRuns.id, row.id));
        return {
          id: row.id,
          environment,
          scheduledFor: row.scheduledFor,
          leaseToken,
          attempts,
        };
      });
    },

    apply(run: LeasedOperationalRetentionRun): Promise<
      | {
          readonly outcome: "completed";
          readonly counts: OperationalRetentionCounts;
        }
      | { readonly outcome: "lease_lost" }
    > {
      return database.transaction(async (transaction) => {
        const { now } = await databaseClock(transaction);
        const [owned] = await transaction
          .select({ id: operationalRetentionRuns.id })
          .from(operationalRetentionRuns)
          .where(
            and(
              eq(operationalRetentionRuns.id, run.id),
              eq(operationalRetentionRuns.environment, run.environment),
              eq(operationalRetentionRuns.state, "running"),
              eq(operationalRetentionRuns.leaseToken, run.leaseToken),
              sql`${operationalRetentionRuns.leaseExpiresAt} > ${now}`,
            ),
          )
          .for("update");
        if (!owned) return { outcome: "lease_lost" };
        const counts = await applyRetention(transaction, run.environment, now);
        const batchLimitReached = Object.values(counts).some(
          (count) => count === batchSize,
        );
        await transaction
          .update(operationalRetentionRuns)
          .set({
            state: "completed",
            leaseToken: null,
            leaseExpiresAt: null,
            counts,
            batchLimitReached,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(operationalRetentionRuns.id, run.id));
        await transaction.insert(auditEvents).values({
          eventType: "platform.operational_retention.completed",
          targetType: "operational_retention_run",
          targetId: run.id,
          correlationId: run.id,
          reason: "Apply the bounded operational evidence retention policy.",
          evidence: { counts, batchLimitReached, policyVersion: 1 },
          occurredAt: now,
        });
        return { outcome: "completed", counts };
      });
    },

    recordFailure(run: LeasedOperationalRetentionRun): Promise<void> {
      return database.transaction(async (transaction) => {
        const { now } = await databaseClock(transaction);
        const terminal = run.attempts >= 5;
        await transaction
          .update(operationalRetentionRuns)
          .set({
            state: terminal ? "failed" : "pending",
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(
              now.getTime() + Math.min(run.attempts ** 2, 15) * 60_000,
            ),
            errorCode: terminal ? "retention_execution_failed" : null,
            completedAt: terminal ? now : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(operationalRetentionRuns.id, run.id),
              eq(operationalRetentionRuns.state, "running"),
              eq(operationalRetentionRuns.leaseToken, run.leaseToken),
            ),
          );
      });
    },
  };
}

async function applyRetention(
  transaction: Transaction,
  environment: PlatformConfigurationEnvironment,
  now: Date,
): Promise<OperationalRetentionCounts> {
  const dayAgo = new Date(now.getTime() - dayMs);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * dayMs);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * dayMs);
  const yearAgo = new Date(now.getTime() - 365 * dayMs);

  const nonceIds = await transaction
    .select({ id: arthWorkloadRequestNonces.id })
    .from(arthWorkloadRequestNonces)
    .where(
      and(
        eq(arthWorkloadRequestNonces.environment, environment),
        lt(arthWorkloadRequestNonces.expiresAt, dayAgo),
      ),
    )
    .orderBy(asc(arthWorkloadRequestNonces.expiresAt))
    .limit(batchSize);
  const workloadRequestNonces = await deleteIds(
    transaction,
    arthWorkloadRequestNonces,
    nonceIds,
  );

  const probeJobIds = await transaction
    .select({ id: platformHealthProbeJobs.id })
    .from(platformHealthProbeJobs)
    .where(
      and(
        eq(platformHealthProbeJobs.environment, environment),
        inArray(platformHealthProbeJobs.state, ["completed", "superseded"]),
        lt(platformHealthProbeJobs.completedAt, thirtyDaysAgo),
      ),
    )
    .orderBy(asc(platformHealthProbeJobs.completedAt))
    .limit(batchSize);
  const healthProbeJobs = await deleteIds(
    transaction,
    platformHealthProbeJobs,
    probeJobIds,
  );

  const providerEventIds = await transaction
    .select({ id: transactionalEmailProviderEvents.id })
    .from(transactionalEmailProviderEvents)
    .where(
      and(
        eq(transactionalEmailProviderEvents.environment, environment),
        lt(transactionalEmailProviderEvents.receivedAt, ninetyDaysAgo),
        notExists(
          transaction
            .select({ id: transactionalEmailRecipientSuppressions.id })
            .from(transactionalEmailRecipientSuppressions)
            .where(
              eq(
                transactionalEmailRecipientSuppressions.sourceEventId,
                transactionalEmailProviderEvents.id,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(transactionalEmailProviderEvents.receivedAt))
    .limit(batchSize);
  const transactionalEmailEvents = await deleteIds(
    transaction,
    transactionalEmailProviderEvents,
    providerEventIds,
  );

  const verificationIds = await transaction
    .select({ id: verificationEmailDeliveries.id })
    .from(verificationEmailDeliveries)
    .where(
      and(
        eq(verificationEmailDeliveries.environment, environment),
        inArray(verificationEmailDeliveries.state, [
          "accepted",
          "delivered",
          "bounced",
          "complained",
          "expired",
          "cancelled",
          "dead_letter",
        ]),
        lt(verificationEmailDeliveries.updatedAt, ninetyDaysAgo),
        notExists(
          transaction
            .select({ id: transactionalEmailProviderEvents.id })
            .from(transactionalEmailProviderEvents)
            .where(
              eq(
                transactionalEmailProviderEvents.verificationDeliveryId,
                verificationEmailDeliveries.id,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(verificationEmailDeliveries.updatedAt))
    .limit(batchSize);
  const verificationDeliveries = await deleteIds(
    transaction,
    verificationEmailDeliveries,
    verificationIds,
  );

  const alertDeliveryIds = await transaction
    .select({ id: operationalAlertDeliveries.id })
    .from(operationalAlertDeliveries)
    .innerJoin(
      operationalAlertOccurrences,
      eq(
        operationalAlertOccurrences.id,
        operationalAlertDeliveries.occurrenceId,
      ),
    )
    .where(
      and(
        eq(operationalAlertDeliveries.environment, environment),
        eq(operationalAlertOccurrences.status, "resolved"),
        lt(operationalAlertOccurrences.resolvedAt, ninetyDaysAgo),
        inArray(operationalAlertDeliveries.state, [
          "accepted",
          "delivered",
          "bounced",
          "complained",
          "dead_letter",
        ]),
        notExists(
          transaction
            .select({ id: transactionalEmailProviderEvents.id })
            .from(transactionalEmailProviderEvents)
            .where(
              eq(
                transactionalEmailProviderEvents.operationalAlertDeliveryId,
                operationalAlertDeliveries.id,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(operationalAlertDeliveries.updatedAt))
    .limit(batchSize);
  const alertDeliveries = await deleteIds(
    transaction,
    operationalAlertDeliveries,
    alertDeliveryIds,
  );

  const occurrenceIds = await transaction
    .select({ id: operationalAlertOccurrences.id })
    .from(operationalAlertOccurrences)
    .where(
      and(
        eq(operationalAlertOccurrences.environment, environment),
        eq(operationalAlertOccurrences.status, "resolved"),
        lt(operationalAlertOccurrences.resolvedAt, ninetyDaysAgo),
        notExists(
          transaction
            .select({ id: operationalAlertDeliveries.id })
            .from(operationalAlertDeliveries)
            .where(
              eq(
                operationalAlertDeliveries.occurrenceId,
                operationalAlertOccurrences.id,
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(operationalAlertOccurrences.resolvedAt))
    .limit(batchSize);
  const alertOccurrences = await deleteIds(
    transaction,
    operationalAlertOccurrences,
    occurrenceIds,
  );

  const modelObservationIds = await transaction
    .select({ id: modelProviderHealthObservations.id })
    .from(modelProviderHealthObservations)
    .innerJoin(
      schema.modelProviders,
      eq(schema.modelProviders.id, modelProviderHealthObservations.providerId),
    )
    .where(
      and(
        eq(schema.modelProviders.environment, environment),
        lt(modelProviderHealthObservations.observedAt, yearAgo),
      ),
    )
    .orderBy(asc(modelProviderHealthObservations.observedAt))
    .limit(batchSize);
  const modelHealthObservations = await deleteIds(
    transaction,
    modelProviderHealthObservations,
    modelObservationIds,
  );

  const integrationObservationIds = await transaction
    .select({ id: platformIntegrationHealthObservations.id })
    .from(platformIntegrationHealthObservations)
    .innerJoin(
      schema.platformIntegrations,
      eq(
        schema.platformIntegrations.id,
        platformIntegrationHealthObservations.integrationId,
      ),
    )
    .where(
      and(
        eq(schema.platformIntegrations.environment, environment),
        lt(platformIntegrationHealthObservations.observedAt, yearAgo),
      ),
    )
    .orderBy(asc(platformIntegrationHealthObservations.observedAt))
    .limit(batchSize);
  const integrationHealthObservations = await deleteIds(
    transaction,
    platformIntegrationHealthObservations,
    integrationObservationIds,
  );

  return {
    workload_request_nonces: workloadRequestNonces,
    health_probe_jobs: healthProbeJobs,
    transactional_email_provider_events: transactionalEmailEvents,
    verification_email_deliveries: verificationDeliveries,
    operational_alert_deliveries: alertDeliveries,
    operational_alert_occurrences: alertOccurrences,
    model_health_observations: modelHealthObservations,
    integration_health_observations: integrationHealthObservations,
  };
}

async function deleteIds(
  transaction: Transaction,
  table:
    | typeof arthWorkloadRequestNonces
    | typeof platformHealthProbeJobs
    | typeof transactionalEmailProviderEvents
    | typeof verificationEmailDeliveries
    | typeof operationalAlertDeliveries
    | typeof operationalAlertOccurrences
    | typeof modelProviderHealthObservations
    | typeof platformIntegrationHealthObservations,
  rows: ReadonlyArray<{ readonly id: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const removed = await transaction
    .delete(table)
    .where(
      inArray(
        table.id,
        rows.map((row) => row.id),
      ),
    )
    .returning({ id: table.id });
  return removed.length;
}

async function databaseClock(transaction: Transaction) {
  const [row] = await transaction
    .select({
      now: sql<string>`clock_timestamp()::text`,
      scheduledFor: sql<string>`date_trunc('hour', clock_timestamp())::text`,
    })
    .from(sql`(select 1) as clock_source`);
  return {
    now: parseDatabaseDate(row?.now),
    scheduledFor: parseDatabaseDate(row?.scheduledFor),
  };
}

function parseDatabaseDate(value: string | undefined): Date {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime()))
    throw new Error("database_clock_unavailable");
  return date;
}
