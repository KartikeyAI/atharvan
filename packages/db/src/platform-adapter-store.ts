import type { PlatformAdapterRegistryStore } from "@atharvan/adapters";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformAdapterReleaseRevisions,
  platformAdapterReleases,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SetInput = Parameters<PlatformAdapterRegistryStore["setRelease"]>[0];

export function createPostgresPlatformAdapterRegistryStore(
  database: Database,
): PlatformAdapterRegistryStore {
  return {
    async listRegistry(input) {
      const rows = await database
        .select({
          id: platformAdapterReleases.id,
          key: platformAdapterReleases.key,
          version: platformAdapterReleases.version,
          displayName: platformAdapterReleaseRevisions.displayName,
          category: platformAdapterReleaseRevisions.category,
          packageName: platformAdapterReleaseRevisions.packageName,
          packageDigestSha256:
            platformAdapterReleaseRevisions.packageDigestSha256,
          documentationUrl: platformAdapterReleaseRevisions.documentationUrl,
          capabilities: platformAdapterReleaseRevisions.capabilities,
          declaredPermissions:
            platformAdapterReleaseRevisions.declaredPermissions,
          configurationFields:
            platformAdapterReleaseRevisions.configurationFields,
          commands: platformAdapterReleaseRevisions.commands,
          supportedEnvironments:
            platformAdapterReleaseRevisions.supportedEnvironments,
          compatibilityTags: platformAdapterReleaseRevisions.compatibilityTags,
          requiredSecretPurposes:
            platformAdapterReleaseRevisions.requiredSecretPurposes,
          healthChecks: platformAdapterReleaseRevisions.healthChecks,
          releaseChannel: platformAdapterReleaseRevisions.releaseChannel,
          signatureStatus: platformAdapterReleaseRevisions.signatureStatus,
          securityReviewStatus:
            platformAdapterReleaseRevisions.securityReviewStatus,
          securityReviewReference:
            platformAdapterReleaseRevisions.securityReviewReference,
          lifecycle: platformAdapterReleaseRevisions.lifecycle,
          blockReason: platformAdapterReleaseRevisions.blockReason,
          deprecatedAt: platformAdapterReleaseRevisions.deprecatedAt,
          sunsetAt: platformAdapterReleaseRevisions.sunsetAt,
          revisionNumber: platformAdapterReleaseRevisions.revisionNumber,
          updatedAt: platformAdapterReleases.updatedAt,
        })
        .from(platformAdapterReleases)
        .innerJoin(
          platformAdapterReleaseRevisions,
          and(
            eq(
              platformAdapterReleaseRevisions.releaseId,
              platformAdapterReleases.id,
            ),
            eq(
              platformAdapterReleaseRevisions.revisionNumber,
              platformAdapterReleases.currentRevisionNumber,
            ),
          ),
        )
        .where(eq(platformAdapterReleases.environment, input.environment))
        .orderBy(
          asc(platformAdapterReleaseRevisions.displayName),
          asc(platformAdapterReleases.version),
        );

      return {
        environment: input.environment,
        items: rows.map((row) => ({
          ...row,
          deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
          sunsetAt: row.sunsetAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    },

    async setRelease(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }

        let [release] = await transaction
          .select({
            id: platformAdapterReleases.id,
            currentRevisionNumber:
              platformAdapterReleases.currentRevisionNumber,
          })
          .from(platformAdapterReleases)
          .where(
            and(
              eq(platformAdapterReleases.key, input.key),
              eq(platformAdapterReleases.version, input.version),
              eq(platformAdapterReleases.environment, input.environment),
            ),
          )
          .limit(1)
          .for("update");

        if (release === undefined) {
          const [created] = await transaction
            .insert(platformAdapterReleases)
            .values({
              id: input.releaseId,
              key: input.key,
              version: input.version,
              environment: input.environment,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                platformAdapterReleases.key,
                platformAdapterReleases.version,
                platformAdapterReleases.environment,
              ],
            })
            .returning({ id: platformAdapterReleases.id });
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
          [release] = await transaction
            .select({
              id: platformAdapterReleases.id,
              currentRevisionNumber:
                platformAdapterReleases.currentRevisionNumber,
            })
            .from(platformAdapterReleases)
            .where(
              and(
                eq(platformAdapterReleases.key, input.key),
                eq(platformAdapterReleases.version, input.version),
                eq(platformAdapterReleases.environment, input.environment),
              ),
            )
            .limit(1)
            .for("update");
        }
        if (release === undefined)
          throw new Error("adapter_release_state_conflict");

        const [current] = await transaction
          .select()
          .from(platformAdapterReleaseRevisions)
          .where(
            and(
              eq(platformAdapterReleaseRevisions.releaseId, release.id),
              eq(
                platformAdapterReleaseRevisions.revisionNumber,
                release.currentRevisionNumber,
              ),
            ),
          )
          .limit(1);
        if (current === undefined)
          throw new Error("adapter_release_state_conflict");
        if (
          current.packageName !== input.packageName ||
          current.packageDigestSha256 !== input.packageDigestSha256
        ) {
          return {
            outcome: "rejected",
            reason: "adapter_release_artifact_immutable",
          };
        }
        if (matches(current, input)) {
          return {
            outcome: "unchanged",
            id: release.id,
            revisionNumber: release.currentRevisionNumber,
          };
        }
        const revisionNumber = release.currentRevisionNumber + 1;
        await insertRevision(transaction, input, release.id, revisionNumber);
        await transaction
          .update(platformAdapterReleases)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(platformAdapterReleases.id, release.id));
        await insertAudit(
          transaction,
          input,
          release.id,
          release.currentRevisionNumber,
          revisionNumber,
          "updated",
        );
        return { outcome: "updated", id: release.id, revisionNumber };
      });
    },
  };
}

async function insertRevision(
  transaction: Transaction,
  input: SetInput,
  releaseId: string,
  revisionNumber: number,
) {
  await transaction.insert(platformAdapterReleaseRevisions).values({
    id: input.revisionId,
    releaseId,
    revisionNumber,
    displayName: input.displayName,
    category: input.category,
    packageName: input.packageName,
    packageDigestSha256: input.packageDigestSha256,
    documentationUrl: input.documentationUrl,
    capabilities: input.capabilities,
    declaredPermissions: [...input.declaredPermissions],
    configurationFields: input.configurationFields,
    commands: input.commands,
    supportedEnvironments: [...input.supportedEnvironments],
    compatibilityTags: [...input.compatibilityTags],
    requiredSecretPurposes: [...input.requiredSecretPurposes],
    healthChecks: input.healthChecks,
    releaseChannel: input.releaseChannel,
    signatureStatus: input.signatureStatus,
    securityReviewStatus: input.securityReviewStatus,
    securityReviewReference: input.securityReviewReference,
    lifecycle: input.lifecycle,
    blockReason: input.blockReason,
    deprecatedAt: input.deprecatedAt,
    sunsetAt: input.sunsetAt,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertAudit(
  transaction: Transaction,
  input: SetInput,
  releaseId: string,
  previousRevisionNumber: number | null,
  revisionNumber: number,
  action: "created" | "updated",
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    eventType: `platform.adapter_release.${action}`,
    targetType: "platform_adapter_release",
    targetId: releaseId,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: {
      previousRevisionNumber,
      revisionNumber,
      packageName: input.packageName,
      version: input.version,
      packageDigestSha256: input.packageDigestSha256,
      lifecycle: input.lifecycle,
      releaseChannel: input.releaseChannel,
      signatureStatus: input.signatureStatus,
      securityReviewStatus: input.securityReviewStatus,
    },
    occurredAt: input.now,
  });
}

async function isActiveOperator(transaction: Transaction, actorId: string) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, actorId), eq(operators.status, "active")))
    .limit(1);
  return actor !== undefined;
}

function matches(
  current: typeof platformAdapterReleaseRevisions.$inferSelect,
  input: SetInput,
) {
  return (
    current.displayName === input.displayName &&
    current.category === input.category &&
    current.documentationUrl === input.documentationUrl &&
    deepEqual(current.capabilities, input.capabilities) &&
    arraysEqual(current.declaredPermissions, input.declaredPermissions) &&
    deepEqual(current.configurationFields, input.configurationFields) &&
    deepEqual(current.commands, input.commands) &&
    arraysEqual(current.supportedEnvironments, input.supportedEnvironments) &&
    arraysEqual(current.compatibilityTags, input.compatibilityTags) &&
    arraysEqual(current.requiredSecretPurposes, input.requiredSecretPurposes) &&
    deepEqual(current.healthChecks, input.healthChecks) &&
    current.releaseChannel === input.releaseChannel &&
    current.signatureStatus === input.signatureStatus &&
    current.securityReviewStatus === input.securityReviewStatus &&
    current.securityReviewReference === input.securityReviewReference &&
    current.lifecycle === input.lifecycle &&
    current.blockReason === input.blockReason &&
    current.deprecatedAt?.getTime() === input.deprecatedAt?.getTime() &&
    current.sunsetAt?.getTime() === input.sunsetAt?.getTime()
  );
}

function arraysEqual(
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
) {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function deepEqual(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}
