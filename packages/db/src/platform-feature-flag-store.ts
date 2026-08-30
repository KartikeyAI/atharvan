import type { PlatformFeatureFlagStore } from "@atharvan/flags";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformFeatureFlagRevisions,
  platformFeatureFlags,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SetInput = Parameters<PlatformFeatureFlagStore["setFlag"]>[0];

const recentRevisionLimit = 10;

export function createPostgresPlatformFeatureFlagStore(
  database: Database,
): PlatformFeatureFlagStore {
  return {
    listFlags: (input) => loadFlags(database, input),
    async findFlag(input) {
      const registry = await loadFlags(database, input, input.key);
      return registry.items[0] ?? null;
    },

    async setFlag(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        if (!(await isActiveOperator(transaction, input.ownerOperatorId))) {
          return { outcome: "rejected", reason: "flag_owner_not_active" };
        }

        let [flag] = await transaction
          .select({
            id: platformFeatureFlags.id,
            currentRevisionNumber: platformFeatureFlags.currentRevisionNumber,
          })
          .from(platformFeatureFlags)
          .where(
            and(
              eq(platformFeatureFlags.key, input.key),
              eq(platformFeatureFlags.environment, input.environment),
            ),
          )
          .limit(1)
          .for("update");

        if (flag === undefined) {
          const [created] = await transaction
            .insert(platformFeatureFlags)
            .values({
              id: input.flagId,
              key: input.key,
              environment: input.environment,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                platformFeatureFlags.key,
                platformFeatureFlags.environment,
              ],
            })
            .returning({ id: platformFeatureFlags.id });
          if (created !== undefined) {
            await insertRevision(transaction, input, created.id, 1);
            await insertAudit(
              transaction,
              input,
              created.id,
              null,
              1,
              "created",
            );
            return { outcome: "created", id: created.id, revisionNumber: 1 };
          }
          [flag] = await transaction
            .select({
              id: platformFeatureFlags.id,
              currentRevisionNumber: platformFeatureFlags.currentRevisionNumber,
            })
            .from(platformFeatureFlags)
            .where(
              and(
                eq(platformFeatureFlags.key, input.key),
                eq(platformFeatureFlags.environment, input.environment),
              ),
            )
            .limit(1)
            .for("update");
        }
        if (flag === undefined) throw new Error("feature_flag_state_conflict");

        const [current] = await transaction
          .select()
          .from(platformFeatureFlagRevisions)
          .where(
            and(
              eq(platformFeatureFlagRevisions.flagId, flag.id),
              eq(
                platformFeatureFlagRevisions.revisionNumber,
                flag.currentRevisionNumber,
              ),
            ),
          )
          .limit(1);
        if (current === undefined)
          throw new Error("feature_flag_state_conflict");
        if (current.lifecycle === "archived") {
          return { outcome: "rejected", reason: "feature_flag_archived" };
        }
        if (matches(current, input)) {
          return {
            outcome: "unchanged",
            id: flag.id,
            revisionNumber: flag.currentRevisionNumber,
          };
        }

        const revisionNumber = flag.currentRevisionNumber + 1;
        await insertRevision(transaction, input, flag.id, revisionNumber);
        await transaction
          .update(platformFeatureFlags)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(platformFeatureFlags.id, flag.id));
        await insertAudit(
          transaction,
          input,
          flag.id,
          flag.currentRevisionNumber,
          revisionNumber,
          input.emergencyDisabled && !current.emergencyDisabled
            ? "emergency_disabled"
            : "updated",
        );
        return { outcome: "updated", id: flag.id, revisionNumber };
      });
    },
  };
}

async function loadFlags(
  database: Database,
  input: {
    readonly environment: SetInput["environment"];
    readonly now: Date;
  },
  key?: string,
) {
  const condition =
    key === undefined
      ? eq(platformFeatureFlags.environment, input.environment)
      : and(
          eq(platformFeatureFlags.environment, input.environment),
          eq(platformFeatureFlags.key, key),
        );
  const currentRows = await database
    .select({
      id: platformFeatureFlags.id,
      key: platformFeatureFlags.key,
      environment: platformFeatureFlags.environment,
      createdAt: platformFeatureFlags.createdAt,
      updatedAt: platformFeatureFlags.updatedAt,
      revisionNumber: platformFeatureFlagRevisions.revisionNumber,
      displayName: platformFeatureFlagRevisions.displayName,
      purpose: platformFeatureFlagRevisions.purpose,
      ownerOperatorId: platformFeatureFlagRevisions.ownerOperatorId,
      ownerEmail: operators.email,
      lifecycle: platformFeatureFlagRevisions.lifecycle,
      defaultEnabled: platformFeatureFlagRevisions.defaultEnabled,
      emergencyDisabled: platformFeatureFlagRevisions.emergencyDisabled,
      rules: platformFeatureFlagRevisions.rules,
      reviewAt: platformFeatureFlagRevisions.reviewAt,
      expiresAt: platformFeatureFlagRevisions.expiresAt,
      reason: platformFeatureFlagRevisions.reason,
      correlationId: platformFeatureFlagRevisions.correlationId,
      createdByOperatorId: platformFeatureFlagRevisions.createdByOperatorId,
      revisionCreatedAt: platformFeatureFlagRevisions.createdAt,
    })
    .from(platformFeatureFlags)
    .innerJoin(
      platformFeatureFlagRevisions,
      and(
        eq(platformFeatureFlagRevisions.flagId, platformFeatureFlags.id),
        eq(
          platformFeatureFlagRevisions.revisionNumber,
          platformFeatureFlags.currentRevisionNumber,
        ),
      ),
    )
    .innerJoin(
      operators,
      eq(operators.id, platformFeatureFlagRevisions.ownerOperatorId),
    )
    .where(condition)
    .orderBy(asc(platformFeatureFlagRevisions.displayName));

  if (currentRows.length === 0) {
    return { environment: input.environment, items: [] };
  }

  const rankedRevisions = database
    .select({
      flagId: platformFeatureFlagRevisions.flagId,
      revisionNumber: platformFeatureFlagRevisions.revisionNumber,
      displayName: platformFeatureFlagRevisions.displayName,
      purpose: platformFeatureFlagRevisions.purpose,
      ownerOperatorId: platformFeatureFlagRevisions.ownerOperatorId,
      ownerEmail: operators.email,
      lifecycle: platformFeatureFlagRevisions.lifecycle,
      defaultEnabled: platformFeatureFlagRevisions.defaultEnabled,
      emergencyDisabled: platformFeatureFlagRevisions.emergencyDisabled,
      rules: platformFeatureFlagRevisions.rules,
      reviewAt: platformFeatureFlagRevisions.reviewAt,
      expiresAt: platformFeatureFlagRevisions.expiresAt,
      reason: platformFeatureFlagRevisions.reason,
      correlationId: platformFeatureFlagRevisions.correlationId,
      createdByOperatorId: platformFeatureFlagRevisions.createdByOperatorId,
      createdAt: platformFeatureFlagRevisions.createdAt,
      rank: sql<number>`row_number() over (partition by ${platformFeatureFlagRevisions.flagId} order by ${platformFeatureFlagRevisions.revisionNumber} desc)`.as(
        "revision_rank",
      ),
    })
    .from(platformFeatureFlagRevisions)
    .innerJoin(
      operators,
      eq(operators.id, platformFeatureFlagRevisions.ownerOperatorId),
    )
    .as("ranked_feature_flag_revisions");
  const historyRows = await database
    .select()
    .from(rankedRevisions)
    .where(
      and(
        inArray(
          rankedRevisions.flagId,
          currentRows.map((row) => row.id),
        ),
        lte(rankedRevisions.rank, recentRevisionLimit),
      ),
    )
    .orderBy(rankedRevisions.flagId, desc(rankedRevisions.revisionNumber));
  const historyByFlag = new Map<string, typeof historyRows>();
  for (const row of historyRows) {
    const history = historyByFlag.get(row.flagId) ?? [];
    history.push(row);
    historyByFlag.set(row.flagId, history);
  }

  return {
    environment: input.environment,
    items: currentRows.map((row) => ({
      id: row.id,
      key: row.key,
      environment: row.environment,
      freshness: freshness(row.reviewAt, row.expiresAt, input.now),
      current: mapRevision({ ...row, createdAt: row.revisionCreatedAt }),
      recentRevisions: (historyByFlag.get(row.id) ?? []).map(mapRevision),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

function mapRevision(row: {
  readonly revisionNumber: number;
  readonly displayName: string;
  readonly purpose: string;
  readonly ownerOperatorId: string;
  readonly ownerEmail: string;
  readonly lifecycle: "draft" | "active" | "archived";
  readonly defaultEnabled: boolean;
  readonly emergencyDisabled: boolean;
  readonly rules: SetInput["rules"];
  readonly reviewAt: Date;
  readonly expiresAt: Date | null;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdByOperatorId: string;
  readonly createdAt: Date;
}) {
  return {
    ...row,
    reviewAt: row.reviewAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function freshness(reviewAt: Date, expiresAt: Date | null, now: Date) {
  if (expiresAt !== null && expiresAt.getTime() <= now.getTime())
    return "expired" as const;
  if (reviewAt.getTime() <= now.getTime()) return "review_due" as const;
  return "current" as const;
}

async function insertRevision(
  transaction: Transaction,
  input: SetInput,
  flagId: string,
  revisionNumber: number,
) {
  await transaction.insert(platformFeatureFlagRevisions).values({
    id: input.revisionId,
    flagId,
    revisionNumber,
    displayName: input.displayName,
    purpose: input.purpose,
    ownerOperatorId: input.ownerOperatorId,
    lifecycle: input.lifecycle,
    defaultEnabled: input.defaultEnabled,
    emergencyDisabled: input.emergencyDisabled,
    rules: input.rules,
    reviewAt: input.reviewAt,
    expiresAt: input.expiresAt,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertAudit(
  transaction: Transaction,
  input: SetInput,
  flagId: string,
  previousRevisionNumber: number | null,
  revisionNumber: number,
  action: "created" | "updated" | "emergency_disabled",
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    eventType: `platform.feature_flag.${action}`,
    targetType: "platform_feature_flag",
    targetId: flagId,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: {
      previousRevisionNumber,
      revisionNumber,
      lifecycle: input.lifecycle,
      ownerOperatorId: input.ownerOperatorId,
      defaultEnabled: input.defaultEnabled,
      emergencyDisabled: input.emergencyDisabled,
      ruleCount: input.rules.length,
      reviewAt: input.reviewAt.toISOString(),
      expiresAt: input.expiresAt?.toISOString() ?? null,
    },
    occurredAt: input.now,
  });
}

async function isActiveOperator(transaction: Transaction, operatorId: string) {
  const [operator] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.status, "active")))
    .limit(1);
  return operator !== undefined;
}

function matches(
  current: typeof platformFeatureFlagRevisions.$inferSelect,
  input: SetInput,
) {
  return (
    current.displayName === input.displayName &&
    current.purpose === input.purpose &&
    current.ownerOperatorId === input.ownerOperatorId &&
    current.lifecycle === input.lifecycle &&
    current.defaultEnabled === input.defaultEnabled &&
    current.emergencyDisabled === input.emergencyDisabled &&
    JSON.stringify(current.rules) === JSON.stringify(input.rules) &&
    current.reviewAt.getTime() === input.reviewAt.getTime() &&
    current.expiresAt?.getTime() === input.expiresAt?.getTime()
  );
}
