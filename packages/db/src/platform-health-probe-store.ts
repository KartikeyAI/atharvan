import type {
  PlatformConfigurationEnvironment,
  PlatformHealthProbeQueueHealth,
  PlatformHttpHealthProbe,
} from "@atharvan/domain";
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  modelProviderHealthObservations,
  modelProviderRevisions,
  modelProviders,
  platformHealthProbeJobs,
  platformIntegrationHealthObservations,
  platformIntegrationRevisions,
  platformIntegrations,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface LeasedPlatformHealthProbe {
  readonly id: string;
  readonly environment: PlatformConfigurationEnvironment;
  readonly targetKind: "model_provider" | "platform_integration";
  readonly targetId: string;
  readonly targetRevisionNumber: number;
  readonly probe: PlatformHttpHealthProbe;
  readonly leaseToken: string;
}

export interface PlatformHealthProbeResult {
  readonly status: "healthy" | "degraded" | "unavailable";
  readonly latencyMs: number;
  readonly httpStatusCode: number | null;
  readonly errorCode: string | null;
  readonly observedAt: Date;
}

/** Durable, idempotent probe scheduling with lease fencing for overlapping cron runs. */
export function createPostgresPlatformHealthProbeStore(database: Database) {
  return {
    async health(
      environment: PlatformConfigurationEnvironment,
    ): Promise<PlatformHealthProbeQueueHealth> {
      const [row] = await database
        .select({
          pending: sql<number>`count(*) FILTER (WHERE ${platformHealthProbeJobs.state} = 'pending')::integer`,
          leased: sql<number>`count(*) FILTER (WHERE ${platformHealthProbeJobs.state} = 'leased')::integer`,
          retryExhausted: sql<number>`count(*) FILTER (WHERE ${platformHealthProbeJobs.completionReason} = 'retry_exhausted' AND ${platformHealthProbeJobs.updatedAt} >= clock_timestamp() - interval '15 minutes')::integer`,
          oldestOutstandingAt: sql<
            string | null
          >`min(${platformHealthProbeJobs.scheduledFor}) FILTER (WHERE ${platformHealthProbeJobs.state} IN ('pending', 'leased'))::text`,
          observedAt: sql<string>`clock_timestamp()::text`,
        })
        .from(platformHealthProbeJobs)
        .where(eq(platformHealthProbeJobs.environment, environment));
      if (!row) throw new Error("platform_health_probe_health_unavailable");
      const counts = [row.pending, row.leased, row.retryExhausted];
      if (!counts.every((value) => Number.isSafeInteger(value) && value >= 0))
        throw new Error("platform_health_probe_health_invalid");
      return {
        pending: row.pending,
        leased: row.leased,
        retryExhausted: row.retryExhausted,
        oldestOutstandingAt: row.oldestOutstandingAt
          ? new Date(row.oldestOutstandingAt).toISOString()
          : null,
        observedAt: new Date(row.observedAt).toISOString(),
      };
    },

    async enqueueDue(environment: PlatformConfigurationEnvironment) {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        const [providers, integrations] = await Promise.all([
          transaction
            .select({
              targetId: modelProviders.id,
              targetRevisionNumber: modelProviders.currentRevisionNumber,
              probe: modelProviderRevisions.healthProbe,
            })
            .from(modelProviders)
            .innerJoin(
              modelProviderRevisions,
              and(
                eq(modelProviderRevisions.providerId, modelProviders.id),
                eq(
                  modelProviderRevisions.revisionNumber,
                  modelProviders.currentRevisionNumber,
                ),
              ),
            )
            .where(
              and(
                eq(modelProviders.environment, environment),
                eq(modelProviderRevisions.lifecycle, "active"),
                sql`${modelProviderRevisions.healthProbe} IS NOT NULL`,
              ),
            ),
          transaction
            .select({
              targetId: platformIntegrations.id,
              targetRevisionNumber: platformIntegrations.currentRevisionNumber,
              probe: platformIntegrationRevisions.healthProbe,
            })
            .from(platformIntegrations)
            .innerJoin(
              platformIntegrationRevisions,
              and(
                eq(
                  platformIntegrationRevisions.integrationId,
                  platformIntegrations.id,
                ),
                eq(
                  platformIntegrationRevisions.revisionNumber,
                  platformIntegrations.currentRevisionNumber,
                ),
              ),
            )
            .where(
              and(
                eq(platformIntegrations.environment, environment),
                eq(platformIntegrationRevisions.lifecycle, "active"),
                sql`${platformIntegrationRevisions.healthProbe} IS NOT NULL`,
                or(
                  eq(platformIntegrationRevisions.operationalState, "enabled"),
                  and(
                    eq(
                      platformIntegrationRevisions.operationalState,
                      "maintenance",
                    ),
                    lte(platformIntegrationRevisions.maintenanceExpiresAt, now),
                  ),
                ),
              ),
            ),
        ]);
        const jobs = [
          ...providers.flatMap((row) =>
            row.probe === null
              ? []
              : [
                  jobValue(
                    environment,
                    now,
                    { ...row, probe: row.probe },
                    "model_provider",
                  ),
                ],
          ),
          ...integrations.flatMap((row) =>
            row.probe === null
              ? []
              : [
                  jobValue(
                    environment,
                    now,
                    { ...row, probe: row.probe },
                    "platform_integration",
                  ),
                ],
          ),
        ];
        if (jobs.length === 0) return 0;
        const inserted = await transaction
          .insert(platformHealthProbeJobs)
          .values(jobs)
          .onConflictDoNothing()
          .returning({ id: platformHealthProbeJobs.id });
        return inserted.length;
      });
    },

    async claimDue(
      environment: PlatformConfigurationEnvironment,
      limit = 8,
    ): Promise<ReadonlyArray<LeasedPlatformHealthProbe>> {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        const exhausted = await transaction
          .update(platformHealthProbeJobs)
          .set({
            state: "superseded",
            leaseToken: null,
            leaseExpiresAt: null,
            completedAt: now,
            completionReason: "retry_exhausted",
            updatedAt: now,
          })
          .where(
            and(
              eq(platformHealthProbeJobs.environment, environment),
              eq(platformHealthProbeJobs.state, "leased"),
              lte(platformHealthProbeJobs.leaseExpiresAt, now),
              sql`${platformHealthProbeJobs.attempts} >= 5`,
            ),
          )
          .returning();
        for (const row of exhausted) {
          const target = targetIdentity(row);
          if (target === null) continue;
          await transaction.insert(auditEvents).values({
            eventType: "platform.health_probe.retry_exhausted",
            targetType: target.targetKind,
            targetId: target.targetId,
            correlationId: row.id,
            reason:
              "Retire a probe job after its lease recovery budget was exhausted.",
            evidence: {
              revisionNumber: row.targetRevisionNumber,
              attempts: row.attempts,
            },
            occurredAt: now,
          });
        }
        const rows = await transaction
          .select()
          .from(platformHealthProbeJobs)
          .where(
            and(
              eq(platformHealthProbeJobs.environment, environment),
              lte(platformHealthProbeJobs.nextAttemptAt, now),
              sql`${platformHealthProbeJobs.attempts} < 5`,
              or(
                eq(platformHealthProbeJobs.state, "pending"),
                and(
                  eq(platformHealthProbeJobs.state, "leased"),
                  lte(platformHealthProbeJobs.leaseExpiresAt, now),
                ),
              ),
            ),
          )
          .orderBy(
            asc(platformHealthProbeJobs.scheduledFor),
            asc(platformHealthProbeJobs.id),
          )
          .limit(Math.min(Math.max(limit, 1), 20))
          .for("update", { skipLocked: true });
        const leased: LeasedPlatformHealthProbe[] = [];
        for (const row of rows) {
          const target = targetIdentity(row);
          if (target === null) continue;
          const leaseToken = crypto.randomUUID();
          await transaction
            .update(platformHealthProbeJobs)
            .set({
              state: "leased",
              attempts: row.attempts + 1,
              leaseToken,
              leaseExpiresAt: new Date(
                now.getTime() + Math.max(row.probe.timeoutMs + 15_000, 30_000),
              ),
              updatedAt: now,
            })
            .where(eq(platformHealthProbeJobs.id, row.id));
          leased.push({
            id: row.id,
            environment: row.environment,
            ...target,
            targetRevisionNumber: row.targetRevisionNumber,
            probe: row.probe,
            leaseToken,
          });
        }
        return leased;
      });
    },

    async settle(
      job: LeasedPlatformHealthProbe,
      result: PlatformHealthProbeResult,
    ): Promise<"recorded" | "superseded" | "lease_lost"> {
      return database.transaction(async (transaction) => {
        const now = await databaseNow(transaction);
        const [owned] = await transaction
          .select({ id: platformHealthProbeJobs.id })
          .from(platformHealthProbeJobs)
          .where(
            and(
              eq(platformHealthProbeJobs.id, job.id),
              eq(platformHealthProbeJobs.environment, job.environment),
              eq(platformHealthProbeJobs.state, "leased"),
              eq(platformHealthProbeJobs.leaseToken, job.leaseToken),
              gt(platformHealthProbeJobs.leaseExpiresAt, now),
            ),
          )
          .for("update");
        if (owned === undefined) return "lease_lost";
        const current = await targetIsCurrent(transaction, job);
        if (!current) {
          await completeJob(
            transaction,
            job.id,
            now,
            "superseded",
            "target_revision_changed",
          );
          return "superseded";
        }
        const expiresAt = new Date(
          result.observedAt.getTime() + job.probe.intervalSeconds * 2_000,
        );
        if (job.targetKind === "model_provider") {
          await transaction.insert(modelProviderHealthObservations).values({
            id: crypto.randomUUID(),
            providerId: job.targetId,
            status: result.status,
            source: "scheduled_probe",
            latencyMs: result.latencyMs,
            httpStatusCode: result.httpStatusCode,
            errorCode: result.errorCode,
            recordedByOperatorId: null,
            reason: "Scheduled HTTPS provider health probe.",
            correlationId: job.id,
            observedAt: result.observedAt,
            expiresAt,
            createdAt: now,
          });
        } else {
          await transaction
            .insert(platformIntegrationHealthObservations)
            .values({
              id: crypto.randomUUID(),
              integrationId: job.targetId,
              status: result.status,
              source: "scheduled_probe",
              latencyMs: result.latencyMs,
              httpStatusCode: result.httpStatusCode,
              errorCode: result.errorCode,
              recordedByOperatorId: null,
              reason: "Scheduled HTTPS integration health probe.",
              correlationId: job.id,
              observedAt: result.observedAt,
              expiresAt,
              createdAt: now,
            });
        }
        await transaction.insert(auditEvents).values({
          eventType: `${job.targetKind}.scheduled_health_observed`,
          targetType: job.targetKind,
          targetId: job.targetId,
          correlationId: job.id,
          reason: "Record an automated external health observation.",
          evidence: {
            revisionNumber: job.targetRevisionNumber,
            status: result.status,
            latencyMs: result.latencyMs,
            httpStatusCode: result.httpStatusCode,
            errorCode: result.errorCode,
          },
          occurredAt: result.observedAt,
        });
        await completeJob(
          transaction,
          job.id,
          now,
          "completed",
          "observation_recorded",
        );
        return "recorded";
      });
    },
  };
}

function jobValue(
  environment: PlatformConfigurationEnvironment,
  now: Date,
  row: {
    readonly targetId: string;
    readonly targetRevisionNumber: number;
    readonly probe: PlatformHttpHealthProbe;
  },
  targetKind: "model_provider" | "platform_integration",
) {
  const windowMs = row.probe.intervalSeconds * 1_000;
  const scheduledFor = new Date(
    Math.floor(now.getTime() / windowMs) * windowMs,
  );
  return {
    id: crypto.randomUUID(),
    environment,
    providerId: targetKind === "model_provider" ? row.targetId : null,
    integrationId: targetKind === "platform_integration" ? row.targetId : null,
    targetRevisionNumber: row.targetRevisionNumber,
    scheduledFor,
    probe: row.probe,
    state: "pending" as const,
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function targetIdentity(row: typeof platformHealthProbeJobs.$inferSelect) {
  if (row.providerId !== null && row.integrationId === null) {
    return { targetKind: "model_provider" as const, targetId: row.providerId };
  }
  if (row.integrationId !== null && row.providerId === null) {
    return {
      targetKind: "platform_integration" as const,
      targetId: row.integrationId,
    };
  }
  return null;
}

async function targetIsCurrent(
  transaction: Transaction,
  job: LeasedPlatformHealthProbe,
) {
  const target =
    job.targetKind === "model_provider" ? modelProviders : platformIntegrations;
  const [row] = await transaction
    .select({ id: target.id })
    .from(target)
    .where(
      and(
        eq(target.id, job.targetId),
        eq(target.environment, job.environment),
        eq(target.currentRevisionNumber, job.targetRevisionNumber),
      ),
    );
  return row !== undefined;
}

async function completeJob(
  transaction: Transaction,
  id: string,
  now: Date,
  state: "completed" | "superseded",
  completionReason: "observation_recorded" | "target_revision_changed",
) {
  await transaction
    .update(platformHealthProbeJobs)
    .set({
      state,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: now,
      completionReason,
      updatedAt: now,
    })
    .where(eq(platformHealthProbeJobs.id, id));
}

async function databaseNow(transaction: Transaction): Promise<Date> {
  const [row] = await transaction
    .select({ now: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock_source`);
  const now = new Date(row?.now ?? "");
  if (!Number.isFinite(now.getTime()))
    throw new Error("database_clock_unavailable");
  return now;
}
