import type { PlatformSecretLifecycleStore } from "@atharvan/secrets";
import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformSecretReferences,
  platformSecretVersions,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createPostgresPlatformSecretStore(
  database: Database,
): PlatformSecretLifecycleStore {
  return {
    async listReferences() {
      const [references, versions] = await Promise.all([
        database
          .select({
            id: platformSecretReferences.id,
            key: platformSecretReferences.key,
            purpose: platformSecretReferences.purpose,
            environment: platformSecretReferences.environment,
            provider: platformSecretReferences.provider,
            status: platformSecretReferences.status,
            currentVersionNumber: platformSecretReferences.currentVersionNumber,
            createdByOperatorId: platformSecretReferences.createdByOperatorId,
            createdAt: platformSecretReferences.createdAt,
            updatedAt: platformSecretReferences.updatedAt,
            revokedAt: platformSecretReferences.revokedAt,
          })
          .from(platformSecretReferences)
          .orderBy(
            platformSecretReferences.environment,
            platformSecretReferences.key,
          ),
        database
          .select()
          .from(platformSecretVersions)
          .orderBy(
            platformSecretVersions.referenceId,
            desc(platformSecretVersions.versionNumber),
          ),
      ]);
      const versionsByReference = new Map<
        string,
        Array<(typeof versions)[number]>
      >();
      for (const version of versions) {
        const entries = versionsByReference.get(version.referenceId) ?? [];
        if (entries.length < 10) entries.push(version);
        versionsByReference.set(version.referenceId, entries);
      }

      return references.map((reference) => ({
        ...reference,
        createdAt: reference.createdAt.toISOString(),
        updatedAt: reference.updatedAt.toISOString(),
        revokedAt: reference.revokedAt?.toISOString() ?? null,
        recentVersions: (versionsByReference.get(reference.id) ?? []).map(
          (version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
            status: version.status,
            reason: version.reason,
            correlationId: version.correlationId,
            createdByOperatorId: version.createdByOperatorId,
            createdAt: version.createdAt.toISOString(),
            activatedAt: version.activatedAt?.toISOString() ?? null,
            retiredAt: version.retiredAt?.toISOString() ?? null,
            failedAt: version.failedAt?.toISOString() ?? null,
          }),
        ),
      }));
    },

    async beginCreate(input) {
      return database.transaction(async (transaction) => {
        await requireActiveSuperAdministrator(transaction, input.actorId);
        const [reference] = await transaction
          .insert(platformSecretReferences)
          .values({
            id: input.referenceId,
            key: input.key,
            purpose: input.purpose,
            environment: input.environment,
            provider: "cloudflare_secrets_store",
            providerName: input.providerName,
            status: "provisioning",
            createdByOperatorId: input.actorId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({
            target: [
              platformSecretReferences.key,
              platformSecretReferences.environment,
            ],
          })
          .returning({ id: platformSecretReferences.id });
        if (reference === undefined) {
          return { outcome: "rejected", reason: "secret_key_exists" } as const;
        }

        await transaction.insert(platformSecretVersions).values({
          id: input.versionId,
          referenceId: input.referenceId,
          versionNumber: 1,
          status: "pending",
          createdByOperatorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
          createdAt: input.now,
        });
        return { outcome: "created" } as const;
      });
    },

    async completeCreate(input) {
      await database.transaction(async (transaction) => {
        const [reference] = await transaction
          .select({ id: platformSecretReferences.id })
          .from(platformSecretReferences)
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "provisioning"),
            ),
          )
          .limit(1)
          .for("update");
        if (reference === undefined) throw new Error("secret_state_conflict");

        await transaction
          .update(platformSecretVersions)
          .set({ status: "active", activatedAt: input.now })
          .where(
            and(
              eq(platformSecretVersions.id, input.versionId),
              eq(platformSecretVersions.referenceId, input.referenceId),
              eq(platformSecretVersions.status, "pending"),
            ),
          );
        await transaction
          .update(platformSecretReferences)
          .set({
            status: "active",
            providerSecretId: input.externalId,
            currentVersionNumber: 1,
            updatedAt: input.now,
          })
          .where(eq(platformSecretReferences.id, input.referenceId));
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.created",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { resultingStatus: "active", versionNumber: 1 },
          occurredAt: input.now,
        });
      });
    },

    async failCreate(input) {
      await database.transaction(async (transaction) => {
        await transaction
          .update(platformSecretVersions)
          .set({ status: "failed", failedAt: input.now })
          .where(
            and(
              eq(platformSecretVersions.id, input.versionId),
              eq(platformSecretVersions.status, "pending"),
            ),
          );
        await transaction
          .update(platformSecretReferences)
          .set({ status: "provisioning_failed", updatedAt: input.now })
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "provisioning"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.provisioning_failed",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { resultingStatus: "provisioning_failed" },
          occurredAt: input.now,
        });
      });
    },

    async beginRotation(input) {
      return database.transaction(async (transaction) => {
        await requireActiveSuperAdministrator(transaction, input.actorId);
        const [reference] = await transaction
          .select({
            id: platformSecretReferences.id,
            providerSecretId: platformSecretReferences.providerSecretId,
            providerName: platformSecretReferences.providerName,
            currentVersionNumber: platformSecretReferences.currentVersionNumber,
          })
          .from(platformSecretReferences)
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "active"),
            ),
          )
          .limit(1)
          .for("update");
        if (
          reference?.providerSecretId === null ||
          reference?.currentVersionNumber === null ||
          reference === undefined
        ) {
          return {
            outcome: "rejected",
            reason: "secret_reference_not_active",
          } as const;
        }
        await transaction.insert(platformSecretVersions).values({
          id: input.versionId,
          referenceId: input.referenceId,
          versionNumber: reference.currentVersionNumber + 1,
          status: "pending",
          createdByOperatorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
          createdAt: input.now,
        });
        await transaction
          .update(platformSecretReferences)
          .set({ status: "rotating", updatedAt: input.now })
          .where(eq(platformSecretReferences.id, input.referenceId));
        return {
          outcome: "started",
          externalId: reference.providerSecretId,
          providerName: reference.providerName,
        } as const;
      });
    },

    async completeRotation(input) {
      await database.transaction(async (transaction) => {
        const [pending] = await transaction
          .select({ versionNumber: platformSecretVersions.versionNumber })
          .from(platformSecretVersions)
          .where(
            and(
              eq(platformSecretVersions.id, input.versionId),
              eq(platformSecretVersions.referenceId, input.referenceId),
              eq(platformSecretVersions.status, "pending"),
            ),
          )
          .limit(1)
          .for("update");
        if (pending === undefined) throw new Error("secret_state_conflict");
        await transaction
          .update(platformSecretVersions)
          .set({ status: "retired", retiredAt: input.now })
          .where(
            and(
              eq(platformSecretVersions.referenceId, input.referenceId),
              eq(platformSecretVersions.status, "active"),
            ),
          );
        await transaction
          .update(platformSecretVersions)
          .set({ status: "active", activatedAt: input.now })
          .where(eq(platformSecretVersions.id, input.versionId));
        await transaction
          .update(platformSecretReferences)
          .set({
            status: "active",
            currentVersionNumber: pending.versionNumber,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "rotating"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.rotated",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            resultingStatus: "active",
            versionNumber: pending.versionNumber,
          },
          occurredAt: input.now,
        });
      });
    },

    async failRotation(input) {
      await database.transaction(async (transaction) => {
        await transaction
          .update(platformSecretVersions)
          .set({ status: "failed", failedAt: input.now })
          .where(
            and(
              eq(platformSecretVersions.id, input.versionId),
              eq(platformSecretVersions.status, "pending"),
            ),
          );
        await transaction
          .update(platformSecretReferences)
          .set({ status: "rotation_failed", updatedAt: input.now })
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "rotating"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.rotation_failed",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { resultingStatus: "rotation_failed" },
          occurredAt: input.now,
        });
      });
    },

    async beginRevocation(input) {
      return database.transaction(async (transaction) => {
        await requireActiveSuperAdministrator(transaction, input.actorId);
        const [reference] = await transaction
          .select({
            providerSecretId: platformSecretReferences.providerSecretId,
          })
          .from(platformSecretReferences)
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "active"),
            ),
          )
          .limit(1)
          .for("update");
        if (reference?.providerSecretId === null || reference === undefined) {
          return {
            outcome: "rejected",
            reason: "secret_reference_not_active",
          } as const;
        }
        await transaction
          .update(platformSecretReferences)
          .set({ status: "revoking", updatedAt: input.now })
          .where(eq(platformSecretReferences.id, input.referenceId));
        return {
          outcome: "started",
          externalId: reference.providerSecretId,
        } as const;
      });
    },

    async completeRevocation(input) {
      await database.transaction(async (transaction) => {
        await transaction
          .update(platformSecretVersions)
          .set({ status: "retired", retiredAt: input.now })
          .where(
            and(
              eq(platformSecretVersions.referenceId, input.referenceId),
              eq(platformSecretVersions.status, "active"),
            ),
          );
        await transaction
          .update(platformSecretReferences)
          .set({
            status: "revoked",
            revokedByOperatorId: input.actorId,
            revokedReason: input.reason,
            revokedCorrelationId: input.correlationId,
            revokedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "revoking"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.revoked",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { resultingStatus: "revoked" },
          occurredAt: input.now,
        });
      });
    },

    async failRevocation(input) {
      await database.transaction(async (transaction) => {
        await transaction
          .update(platformSecretReferences)
          .set({ status: "revocation_failed", updatedAt: input.now })
          .where(
            and(
              eq(platformSecretReferences.id, input.referenceId),
              eq(platformSecretReferences.status, "revoking"),
            ),
          );
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.secret.revocation_failed",
          targetType: "platform_secret_reference",
          targetId: input.referenceId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { resultingStatus: "revocation_failed" },
          occurredAt: input.now,
        });
      });
    },
  };
}

async function requireActiveSuperAdministrator(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  actorId: string,
) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(
      and(
        eq(operators.id, actorId),
        eq(operators.status, "active"),
        eq(operators.isSuperAdministrator, true),
      ),
    )
    .limit(1)
    .for("update");
  if (actor === undefined) throw new Error("operator_command_forbidden");
}
