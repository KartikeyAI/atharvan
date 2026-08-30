import type { PlatformIntegrationRegistryStore } from "@atharvan/integrations";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformIntegrationHealthObservations,
  platformIntegrationRevisions,
  platformIntegrations,
  platformSecretReferences,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SetInput = Parameters<
  PlatformIntegrationRegistryStore["setIntegration"]
>[0];

export function createPostgresPlatformIntegrationRegistryStore(
  database: Database,
): PlatformIntegrationRegistryStore {
  return {
    async listRegistry(input) {
      const [rows, healthRows] = await Promise.all([
        database
          .select({
            id: platformIntegrations.id,
            key: platformIntegrations.key,
            displayName: platformIntegrationRevisions.displayName,
            protocol: platformIntegrationRevisions.protocol,
            connectionMode: platformIntegrationRevisions.connectionMode,
            capabilities: platformIntegrationRevisions.capabilities,
            adapterPackage: platformIntegrationRevisions.adapterPackage,
            adapterVersion: platformIntegrationRevisions.adapterVersion,
            documentationUrl: platformIntegrationRevisions.documentationUrl,
            authorizationUrl: platformIntegrationRevisions.authorizationUrl,
            tokenUrl: platformIntegrationRevisions.tokenUrl,
            clientId: platformIntegrationRevisions.clientId,
            clientSecretReferenceId:
              platformIntegrationRevisions.clientSecretReferenceId,
            webhookSecretReferenceId:
              platformIntegrationRevisions.webhookSecretReferenceId,
            callbackUrls: platformIntegrationRevisions.callbackUrls,
            requiredScopes: platformIntegrationRevisions.requiredScopes,
            optionalScopes: platformIntegrationRevisions.optionalScopes,
            lifecycle: platformIntegrationRevisions.lifecycle,
            operationalState: platformIntegrationRevisions.operationalState,
            maintenanceExpiresAt:
              platformIntegrationRevisions.maintenanceExpiresAt,
            revisionNumber: platformIntegrationRevisions.revisionNumber,
            updatedAt: platformIntegrations.updatedAt,
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
          .where(eq(platformIntegrations.environment, input.environment))
          .orderBy(asc(platformIntegrationRevisions.displayName)),
        database
          .selectDistinctOn(
            [platformIntegrationHealthObservations.integrationId],
            {
              id: platformIntegrationHealthObservations.id,
              integrationId:
                platformIntegrationHealthObservations.integrationId,
              status: platformIntegrationHealthObservations.status,
              source: platformIntegrationHealthObservations.source,
              latencyMs: platformIntegrationHealthObservations.latencyMs,
              httpStatusCode:
                platformIntegrationHealthObservations.httpStatusCode,
              errorCode: platformIntegrationHealthObservations.errorCode,
              observedAt: platformIntegrationHealthObservations.observedAt,
              expiresAt: platformIntegrationHealthObservations.expiresAt,
            },
          )
          .from(platformIntegrationHealthObservations)
          .innerJoin(
            platformIntegrations,
            eq(
              platformIntegrations.id,
              platformIntegrationHealthObservations.integrationId,
            ),
          )
          .where(eq(platformIntegrations.environment, input.environment))
          .orderBy(
            platformIntegrationHealthObservations.integrationId,
            desc(platformIntegrationHealthObservations.observedAt),
            desc(platformIntegrationHealthObservations.createdAt),
          ),
      ]);

      const secretIds = [
        ...new Set(
          rows.flatMap((row) =>
            [row.clientSecretReferenceId, row.webhookSecretReferenceId].filter(
              (id): id is string => id !== null,
            ),
          ),
        ),
      ];
      const secretRows =
        secretIds.length === 0
          ? []
          : await database
              .select({
                id: platformSecretReferences.id,
                key: platformSecretReferences.key,
              })
              .from(platformSecretReferences)
              .where(inArray(platformSecretReferences.id, secretIds));
      const secretKeys = new Map(secretRows.map((row) => [row.id, row.key]));
      const healthByIntegration = new Map(
        healthRows.map((row) => [row.integrationId, row]),
      );

      return {
        environment: input.environment,
        items: rows.map((row) => {
          const latestHealth = healthByIntegration.get(row.id);
          const maintenanceActive =
            row.operationalState === "maintenance" &&
            row.maintenanceExpiresAt !== null &&
            row.maintenanceExpiresAt.getTime() > input.now.getTime();
          return {
            ...row,
            capabilities: row.capabilities as Array<
              | "source_control"
              | "deployment"
              | "database"
              | "authentication"
              | "observability"
              | "billing"
              | "notifications"
              | "design"
            >,
            clientSecretReferenceKey:
              row.clientSecretReferenceId === null
                ? null
                : (secretKeys.get(row.clientSecretReferenceId) ?? null),
            webhookSecretReferenceKey:
              row.webhookSecretReferenceId === null
                ? null
                : (secretKeys.get(row.webhookSecretReferenceId) ?? null),
            maintenanceExpiresAt:
              row.maintenanceExpiresAt?.toISOString() ?? null,
            effectiveOperationalState:
              row.operationalState === "enabled" ||
              (row.operationalState === "maintenance" && !maintenanceActive)
                ? ("enabled" as const)
                : ("disabled" as const),
            updatedAt: row.updatedAt.toISOString(),
            health:
              latestHealth === undefined
                ? unknownHealth()
                : {
                    id: latestHealth.id,
                    state:
                      latestHealth.expiresAt.getTime() <= input.now.getTime()
                        ? ("stale" as const)
                        : latestHealth.status,
                    reportedStatus: latestHealth.status,
                    source: latestHealth.source,
                    latencyMs: latestHealth.latencyMs,
                    httpStatusCode: latestHealth.httpStatusCode,
                    errorCode: latestHealth.errorCode,
                    observedAt: latestHealth.observedAt.toISOString(),
                    expiresAt: latestHealth.expiresAt.toISOString(),
                  },
          };
        }),
      };
    },

    async setIntegration(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        if (
          !(await areActiveEnvironmentSecrets(transaction, input.environment, [
            input.clientSecretReferenceId,
            input.webhookSecretReferenceId,
          ]))
        ) {
          return { outcome: "rejected", reason: "secret_reference_invalid" };
        }

        let [integration] = await transaction
          .select({
            id: platformIntegrations.id,
            currentRevisionNumber: platformIntegrations.currentRevisionNumber,
          })
          .from(platformIntegrations)
          .where(
            and(
              eq(platformIntegrations.key, input.key),
              eq(platformIntegrations.environment, input.environment),
            ),
          )
          .limit(1)
          .for("update");

        if (integration === undefined) {
          if (
            input.protocol === "oauth2" &&
            input.lifecycle === "active" &&
            (input.clientSecretReferenceId === null ||
              input.clientSecretReferenceId === undefined)
          ) {
            return {
              outcome: "rejected",
              reason: "oauth_configuration_incomplete",
            };
          }
          const [created] = await transaction
            .insert(platformIntegrations)
            .values({
              id: input.integrationId,
              key: input.key,
              environment: input.environment,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                platformIntegrations.key,
                platformIntegrations.environment,
              ],
            })
            .returning({ id: platformIntegrations.id });
          if (created !== undefined) {
            await insertRevision(
              transaction,
              input,
              created.id,
              1,
              input.clientSecretReferenceId ?? null,
              input.webhookSecretReferenceId ?? null,
            );
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
          [integration] = await transaction
            .select({
              id: platformIntegrations.id,
              currentRevisionNumber: platformIntegrations.currentRevisionNumber,
            })
            .from(platformIntegrations)
            .where(
              and(
                eq(platformIntegrations.key, input.key),
                eq(platformIntegrations.environment, input.environment),
              ),
            )
            .limit(1)
            .for("update");
        }
        if (integration === undefined) {
          throw new Error("integration_state_conflict");
        }

        const [current] = await transaction
          .select()
          .from(platformIntegrationRevisions)
          .where(
            and(
              eq(platformIntegrationRevisions.integrationId, integration.id),
              eq(
                platformIntegrationRevisions.revisionNumber,
                integration.currentRevisionNumber,
              ),
            ),
          )
          .limit(1);
        if (current === undefined)
          throw new Error("integration_state_conflict");
        const clientSecretReferenceId =
          input.clientSecretReferenceId === undefined
            ? current.clientSecretReferenceId
            : input.clientSecretReferenceId;
        const webhookSecretReferenceId =
          input.webhookSecretReferenceId === undefined
            ? current.webhookSecretReferenceId
            : input.webhookSecretReferenceId;
        if (
          input.protocol === "oauth2" &&
          input.lifecycle === "active" &&
          clientSecretReferenceId === null
        ) {
          return {
            outcome: "rejected",
            reason: "oauth_configuration_incomplete",
          };
        }
        if (
          matches(
            current,
            input,
            clientSecretReferenceId,
            webhookSecretReferenceId,
          )
        ) {
          return {
            outcome: "unchanged",
            id: integration.id,
            revisionNumber: integration.currentRevisionNumber,
          };
        }
        const revisionNumber = integration.currentRevisionNumber + 1;
        await insertRevision(
          transaction,
          input,
          integration.id,
          revisionNumber,
          clientSecretReferenceId,
          webhookSecretReferenceId,
        );
        await transaction
          .update(platformIntegrations)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(platformIntegrations.id, integration.id));
        await insertAudit(
          transaction,
          input,
          integration.id,
          integration.currentRevisionNumber,
          revisionNumber,
          "updated",
        );
        return { outcome: "updated", id: integration.id, revisionNumber };
      });
    },

    async recordHealthObservation(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        const [integration] = await transaction
          .select({ id: platformIntegrations.id })
          .from(platformIntegrations)
          .where(
            and(
              eq(platformIntegrations.id, input.integrationId),
              eq(platformIntegrations.environment, input.environment),
            ),
          )
          .limit(1);
        if (integration === undefined) {
          return { outcome: "rejected", reason: "integration_not_found" };
        }
        await transaction.insert(platformIntegrationHealthObservations).values({
          id: input.observationId,
          integrationId: input.integrationId,
          status: input.status,
          source: input.source,
          latencyMs: input.latencyMs,
          httpStatusCode: input.httpStatusCode,
          errorCode: input.errorCode,
          recordedByOperatorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
          observedAt: input.observedAt,
          expiresAt: input.expiresAt,
          createdAt: input.observedAt,
        });
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.integration.health_observed",
          targetType: "platform_integration",
          targetId: input.integrationId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            reportedStatus: input.status,
            source: input.source,
            observedAt: input.observedAt.toISOString(),
            expiresAt: input.expiresAt.toISOString(),
          },
          occurredAt: input.observedAt,
        });
        return { outcome: "created", id: input.observationId };
      });
    },
  };
}

async function insertRevision(
  transaction: Transaction,
  input: SetInput,
  integrationId: string,
  revisionNumber: number,
  clientSecretReferenceId: string | null,
  webhookSecretReferenceId: string | null,
) {
  await transaction.insert(platformIntegrationRevisions).values({
    id: input.revisionId,
    integrationId,
    revisionNumber,
    displayName: input.displayName,
    protocol: input.protocol,
    connectionMode: input.connectionMode,
    capabilities: [...input.capabilities],
    adapterPackage: input.adapterPackage,
    adapterVersion: input.adapterVersion,
    documentationUrl: input.documentationUrl,
    authorizationUrl: input.authorizationUrl,
    tokenUrl: input.tokenUrl,
    clientId: input.clientId,
    clientSecretReferenceId,
    webhookSecretReferenceId,
    callbackUrls: [...input.callbackUrls],
    requiredScopes: [...input.requiredScopes],
    optionalScopes: [...input.optionalScopes],
    lifecycle: input.lifecycle,
    operationalState: input.operationalState,
    maintenanceExpiresAt: input.maintenanceExpiresAt,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertAudit(
  transaction: Transaction,
  input: SetInput,
  integrationId: string,
  previousRevisionNumber: number | null,
  revisionNumber: number,
  action: "created" | "updated",
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    eventType: `platform.integration.${action}`,
    targetType: "platform_integration",
    targetId: integrationId,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: { previousRevisionNumber, revisionNumber },
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

async function areActiveEnvironmentSecrets(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  ids: ReadonlyArray<string | null | undefined>,
) {
  const required = [...new Set(ids.filter((id): id is string => id != null))];
  if (required.length === 0) return true;
  const rows = await transaction
    .select({ id: platformSecretReferences.id })
    .from(platformSecretReferences)
    .where(
      and(
        inArray(platformSecretReferences.id, required),
        eq(platformSecretReferences.environment, environment),
        eq(platformSecretReferences.status, "active"),
      ),
    );
  return rows.length === required.length;
}

function matches(
  current: typeof platformIntegrationRevisions.$inferSelect,
  input: SetInput,
  clientSecretReferenceId: string | null,
  webhookSecretReferenceId: string | null,
) {
  return (
    current.displayName === input.displayName &&
    current.protocol === input.protocol &&
    current.connectionMode === input.connectionMode &&
    arraysEqual(current.capabilities, input.capabilities) &&
    current.adapterPackage === input.adapterPackage &&
    current.adapterVersion === input.adapterVersion &&
    current.documentationUrl === input.documentationUrl &&
    current.authorizationUrl === input.authorizationUrl &&
    current.tokenUrl === input.tokenUrl &&
    current.clientId === input.clientId &&
    current.clientSecretReferenceId === clientSecretReferenceId &&
    current.webhookSecretReferenceId === webhookSecretReferenceId &&
    arraysEqual(current.callbackUrls, input.callbackUrls) &&
    arraysEqual(current.requiredScopes, input.requiredScopes) &&
    arraysEqual(current.optionalScopes, input.optionalScopes) &&
    current.lifecycle === input.lifecycle &&
    current.operationalState === input.operationalState &&
    current.maintenanceExpiresAt?.getTime() ===
      input.maintenanceExpiresAt?.getTime()
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

function unknownHealth() {
  return {
    id: "unknown",
    state: "unknown" as const,
    reportedStatus: null,
    source: null,
    latencyMs: null,
    httpStatusCode: null,
    errorCode: null,
    observedAt: null,
    expiresAt: null,
  };
}
