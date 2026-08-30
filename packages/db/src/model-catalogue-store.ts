import type { ModelCatalogueStore } from "@atharvan/models";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  modelProviderHealthObservations,
  modelProviderRevisions,
  modelProviders,
  modelRevisions,
  models,
  operators,
  platformSecretReferences,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPostgresModelCatalogueStore(
  database: Database,
): ModelCatalogueStore {
  return {
    async listCatalogue(input) {
      const [providerRows, modelRows, healthRows] = await Promise.all([
        database
          .select({
            id: modelProviders.id,
            key: modelProviders.key,
            displayName: modelProviderRevisions.displayName,
            adapterKind: modelProviderRevisions.adapterKind,
            baseUrl: modelProviderRevisions.baseUrl,
            credentialReferenceId: modelProviderRevisions.credentialReferenceId,
            credentialReferenceKey: platformSecretReferences.key,
            regions: modelProviderRevisions.regions,
            maximumDataClassification:
              modelProviderRevisions.maximumDataClassification,
            lifecycle: modelProviderRevisions.lifecycle,
            revisionNumber: modelProviderRevisions.revisionNumber,
            updatedAt: modelProviders.updatedAt,
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
          .leftJoin(
            platformSecretReferences,
            eq(
              platformSecretReferences.id,
              modelProviderRevisions.credentialReferenceId,
            ),
          )
          .where(eq(modelProviders.environment, input.environment))
          .orderBy(asc(modelProviderRevisions.displayName)),
        database
          .select({
            id: models.id,
            providerId: models.providerId,
            key: models.key,
            displayName: modelRevisions.displayName,
            kind: modelRevisions.kind,
            capabilities: modelRevisions.capabilities,
            contextWindowTokens: modelRevisions.contextWindowTokens,
            maximumOutputTokens: modelRevisions.maximumOutputTokens,
            inputPriceMicrounitsPerMillion:
              modelRevisions.inputPriceMicrounitsPerMillion,
            outputPriceMicrounitsPerMillion:
              modelRevisions.outputPriceMicrounitsPerMillion,
            currency: modelRevisions.currency,
            regions: modelRevisions.regions,
            maximumDataClassification: modelRevisions.maximumDataClassification,
            lifecycle: modelRevisions.lifecycle,
            revisionNumber: modelRevisions.revisionNumber,
            updatedAt: models.updatedAt,
          })
          .from(models)
          .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
          .innerJoin(
            modelRevisions,
            and(
              eq(modelRevisions.modelId, models.id),
              eq(modelRevisions.revisionNumber, models.currentRevisionNumber),
            ),
          )
          .where(eq(modelProviders.environment, input.environment))
          .orderBy(asc(modelRevisions.displayName)),
        database
          .selectDistinctOn([modelProviderHealthObservations.providerId], {
            id: modelProviderHealthObservations.id,
            providerId: modelProviderHealthObservations.providerId,
            status: modelProviderHealthObservations.status,
            source: modelProviderHealthObservations.source,
            latencyMs: modelProviderHealthObservations.latencyMs,
            httpStatusCode: modelProviderHealthObservations.httpStatusCode,
            errorCode: modelProviderHealthObservations.errorCode,
            observedAt: modelProviderHealthObservations.observedAt,
            expiresAt: modelProviderHealthObservations.expiresAt,
          })
          .from(modelProviderHealthObservations)
          .innerJoin(
            modelProviders,
            eq(modelProviders.id, modelProviderHealthObservations.providerId),
          )
          .where(eq(modelProviders.environment, input.environment))
          .orderBy(
            modelProviderHealthObservations.providerId,
            desc(modelProviderHealthObservations.observedAt),
            desc(modelProviderHealthObservations.createdAt),
          ),
      ]);

      const modelsByProvider = new Map<
        string,
        Array<(typeof modelRows)[number]>
      >();
      for (const model of modelRows) {
        const entries = modelsByProvider.get(model.providerId) ?? [];
        entries.push(model);
        modelsByProvider.set(model.providerId, entries);
      }
      const healthByProvider = new Map(
        healthRows.map((observation) => [observation.providerId, observation]),
      );

      return {
        environment: input.environment,
        items: providerRows.map((provider) => {
          const latestHealth = healthByProvider.get(provider.id);
          return {
            ...provider,
            credentialReferenceKey: provider.credentialReferenceKey ?? null,
            updatedAt: provider.updatedAt.toISOString(),
            health:
              latestHealth === undefined
                ? unknownHealth()
                : {
                    id: latestHealth.id,
                    state:
                      latestHealth.expiresAt.getTime() <= input.now.getTime()
                        ? "stale"
                        : latestHealth.status,
                    reportedStatus: latestHealth.status,
                    source: latestHealth.source,
                    latencyMs: latestHealth.latencyMs,
                    httpStatusCode: latestHealth.httpStatusCode,
                    errorCode: latestHealth.errorCode,
                    observedAt: latestHealth.observedAt.toISOString(),
                    expiresAt: latestHealth.expiresAt.toISOString(),
                  },
            models: (modelsByProvider.get(provider.id) ?? []).map((model) => ({
              id: model.id,
              key: model.key,
              displayName: model.displayName,
              kind: model.kind,
              capabilities: model.capabilities as Array<
                | "text_generation"
                | "code_generation"
                | "reasoning"
                | "vision"
                | "tool_use"
                | "structured_output"
                | "embeddings"
              >,
              contextWindowTokens: model.contextWindowTokens,
              maximumOutputTokens: model.maximumOutputTokens,
              inputPriceMicrounitsPerMillion:
                model.inputPriceMicrounitsPerMillion,
              outputPriceMicrounitsPerMillion:
                model.outputPriceMicrounitsPerMillion,
              currency: "USD" as const,
              regions: model.regions,
              maximumDataClassification: model.maximumDataClassification,
              lifecycle: model.lifecycle,
              revisionNumber: model.revisionNumber,
              updatedAt: model.updatedAt.toISOString(),
            })),
          };
        }),
      };
    },

    async setProvider(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        if (
          input.credentialReferenceId !== null &&
          input.credentialReferenceId !== undefined &&
          !(await isActiveEnvironmentSecret(
            transaction,
            input.credentialReferenceId,
            input.environment,
          ))
        ) {
          return {
            outcome: "rejected",
            reason: "credential_reference_invalid",
          };
        }

        let [provider] = await transaction
          .select({
            id: modelProviders.id,
            currentRevisionNumber: modelProviders.currentRevisionNumber,
          })
          .from(modelProviders)
          .where(
            and(
              eq(modelProviders.key, input.key),
              eq(modelProviders.environment, input.environment),
            ),
          )
          .limit(1)
          .for("update");
        if (provider === undefined) {
          const [created] = await transaction
            .insert(modelProviders)
            .values({
              id: input.providerId,
              key: input.key,
              environment: input.environment,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [modelProviders.key, modelProviders.environment],
            })
            .returning({ id: modelProviders.id });
          if (created === undefined) {
            [provider] = await transaction
              .select({
                id: modelProviders.id,
                currentRevisionNumber: modelProviders.currentRevisionNumber,
              })
              .from(modelProviders)
              .where(
                and(
                  eq(modelProviders.key, input.key),
                  eq(modelProviders.environment, input.environment),
                ),
              )
              .limit(1)
              .for("update");
          } else {
            await insertProviderRevision(
              transaction,
              input,
              created.id,
              1,
              input.credentialReferenceId ?? null,
            );
            await insertCatalogueAudit(transaction, {
              actorId: input.actorId,
              eventType: "platform.model_provider.created",
              targetType: "model_provider",
              targetId: created.id,
              correlationId: input.correlationId,
              reason: input.reason,
              previousRevisionNumber: null,
              revisionNumber: 1,
              now: input.now,
            });
            return {
              outcome: "created",
              id: created.id,
              revisionNumber: 1,
            };
          }
        }
        if (provider === undefined) throw new Error("provider_state_conflict");

        const [current] = await transaction
          .select({
            displayName: modelProviderRevisions.displayName,
            adapterKind: modelProviderRevisions.adapterKind,
            baseUrl: modelProviderRevisions.baseUrl,
            credentialReferenceId: modelProviderRevisions.credentialReferenceId,
            regions: modelProviderRevisions.regions,
            maximumDataClassification:
              modelProviderRevisions.maximumDataClassification,
            lifecycle: modelProviderRevisions.lifecycle,
          })
          .from(modelProviderRevisions)
          .where(
            and(
              eq(modelProviderRevisions.providerId, provider.id),
              eq(
                modelProviderRevisions.revisionNumber,
                provider.currentRevisionNumber,
              ),
            ),
          )
          .limit(1);
        if (current === undefined) throw new Error("provider_state_conflict");
        const credentialReferenceId =
          input.credentialReferenceId === undefined
            ? current.credentialReferenceId
            : input.credentialReferenceId;
        if (providerMatches(current, input, credentialReferenceId)) {
          return {
            outcome: "unchanged",
            id: provider.id,
            revisionNumber: provider.currentRevisionNumber,
          };
        }

        const revisionNumber = provider.currentRevisionNumber + 1;
        await insertProviderRevision(
          transaction,
          input,
          provider.id,
          revisionNumber,
          credentialReferenceId,
        );
        await transaction
          .update(modelProviders)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(modelProviders.id, provider.id));
        await insertCatalogueAudit(transaction, {
          actorId: input.actorId,
          eventType: "platform.model_provider.updated",
          targetType: "model_provider",
          targetId: provider.id,
          correlationId: input.correlationId,
          reason: input.reason,
          previousRevisionNumber: provider.currentRevisionNumber,
          revisionNumber,
          now: input.now,
        });
        return { outcome: "updated", id: provider.id, revisionNumber };
      });
    },

    async setModel(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        const [provider] = await transaction
          .select({ id: modelProviders.id })
          .from(modelProviders)
          .where(
            and(
              eq(modelProviders.id, input.providerId),
              eq(modelProviders.environment, input.environment),
            ),
          )
          .limit(1);
        if (provider === undefined) {
          return { outcome: "rejected", reason: "provider_not_found" };
        }

        let [model] = await transaction
          .select({
            id: models.id,
            currentRevisionNumber: models.currentRevisionNumber,
          })
          .from(models)
          .where(
            and(
              eq(models.providerId, input.providerId),
              eq(models.key, input.key),
            ),
          )
          .limit(1)
          .for("update");
        if (model === undefined) {
          const [created] = await transaction
            .insert(models)
            .values({
              id: input.modelId,
              providerId: input.providerId,
              key: input.key,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [models.providerId, models.key],
            })
            .returning({ id: models.id });
          if (created === undefined) {
            [model] = await transaction
              .select({
                id: models.id,
                currentRevisionNumber: models.currentRevisionNumber,
              })
              .from(models)
              .where(
                and(
                  eq(models.providerId, input.providerId),
                  eq(models.key, input.key),
                ),
              )
              .limit(1)
              .for("update");
          } else {
            await insertModelRevision(transaction, input, created.id, 1);
            await insertCatalogueAudit(transaction, {
              actorId: input.actorId,
              eventType: "platform.model.created",
              targetType: "model",
              targetId: created.id,
              correlationId: input.correlationId,
              reason: input.reason,
              previousRevisionNumber: null,
              revisionNumber: 1,
              now: input.now,
            });
            return {
              outcome: "created",
              id: created.id,
              revisionNumber: 1,
            };
          }
        }
        if (model === undefined) throw new Error("model_state_conflict");

        const [current] = await transaction
          .select({
            displayName: modelRevisions.displayName,
            kind: modelRevisions.kind,
            capabilities: modelRevisions.capabilities,
            contextWindowTokens: modelRevisions.contextWindowTokens,
            maximumOutputTokens: modelRevisions.maximumOutputTokens,
            inputPriceMicrounitsPerMillion:
              modelRevisions.inputPriceMicrounitsPerMillion,
            outputPriceMicrounitsPerMillion:
              modelRevisions.outputPriceMicrounitsPerMillion,
            regions: modelRevisions.regions,
            maximumDataClassification: modelRevisions.maximumDataClassification,
            lifecycle: modelRevisions.lifecycle,
          })
          .from(modelRevisions)
          .where(
            and(
              eq(modelRevisions.modelId, model.id),
              eq(modelRevisions.revisionNumber, model.currentRevisionNumber),
            ),
          )
          .limit(1);
        if (current === undefined) throw new Error("model_state_conflict");
        if (modelMatches(current, input)) {
          return {
            outcome: "unchanged",
            id: model.id,
            revisionNumber: model.currentRevisionNumber,
          };
        }

        const revisionNumber = model.currentRevisionNumber + 1;
        await insertModelRevision(transaction, input, model.id, revisionNumber);
        await transaction
          .update(models)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(models.id, model.id));
        await insertCatalogueAudit(transaction, {
          actorId: input.actorId,
          eventType: "platform.model.updated",
          targetType: "model",
          targetId: model.id,
          correlationId: input.correlationId,
          reason: input.reason,
          previousRevisionNumber: model.currentRevisionNumber,
          revisionNumber,
          now: input.now,
        });
        return { outcome: "updated", id: model.id, revisionNumber };
      });
    },

    async recordHealthObservation(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        const [provider] = await transaction
          .select({ id: modelProviders.id })
          .from(modelProviders)
          .where(
            and(
              eq(modelProviders.id, input.providerId),
              eq(modelProviders.environment, input.environment),
            ),
          )
          .limit(1);
        if (provider === undefined) {
          return { outcome: "rejected", reason: "provider_not_found" };
        }
        await transaction.insert(modelProviderHealthObservations).values({
          id: input.observationId,
          providerId: input.providerId,
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
          eventType: "platform.model_provider.health_observed",
          targetType: "model_provider",
          targetId: input.providerId,
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

async function insertProviderRevision(
  transaction: Transaction,
  input: Parameters<ModelCatalogueStore["setProvider"]>[0],
  providerId: string,
  revisionNumber: number,
  credentialReferenceId: string | null,
) {
  await transaction.insert(modelProviderRevisions).values({
    id: input.revisionId,
    providerId,
    revisionNumber,
    displayName: input.displayName,
    adapterKind: input.adapterKind,
    baseUrl: input.baseUrl,
    credentialReferenceId,
    regions: [...input.regions],
    maximumDataClassification: input.maximumDataClassification,
    lifecycle: input.lifecycle,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertModelRevision(
  transaction: Transaction,
  input: Parameters<ModelCatalogueStore["setModel"]>[0],
  modelId: string,
  revisionNumber: number,
) {
  await transaction.insert(modelRevisions).values({
    id: input.revisionId,
    modelId,
    revisionNumber,
    displayName: input.displayName,
    kind: input.kind,
    capabilities: [...input.capabilities],
    contextWindowTokens: input.contextWindowTokens,
    maximumOutputTokens: input.maximumOutputTokens,
    inputPriceMicrounitsPerMillion: input.inputPriceMicrounitsPerMillion,
    outputPriceMicrounitsPerMillion: input.outputPriceMicrounitsPerMillion,
    currency: "USD",
    regions: [...input.regions],
    maximumDataClassification: input.maximumDataClassification,
    lifecycle: input.lifecycle,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertCatalogueAudit(
  transaction: Transaction,
  input: {
    readonly actorId: string;
    readonly eventType: string;
    readonly targetType: "model_provider" | "model";
    readonly targetId: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly previousRevisionNumber: number | null;
    readonly revisionNumber: number;
    readonly now: Date;
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: {
      previousRevisionNumber: input.previousRevisionNumber,
      revisionNumber: input.revisionNumber,
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

async function isActiveEnvironmentSecret(
  transaction: Transaction,
  referenceId: string,
  environment: "development" | "production" | "test",
) {
  const [reference] = await transaction
    .select({ id: platformSecretReferences.id })
    .from(platformSecretReferences)
    .where(
      and(
        eq(platformSecretReferences.id, referenceId),
        eq(platformSecretReferences.environment, environment),
        eq(platformSecretReferences.status, "active"),
      ),
    )
    .limit(1);
  return reference !== undefined;
}

function providerMatches(
  current: {
    readonly displayName: string;
    readonly adapterKind: string;
    readonly baseUrl: string | null;
    readonly credentialReferenceId: string | null;
    readonly regions: ReadonlyArray<string>;
    readonly maximumDataClassification: string;
    readonly lifecycle: string;
  },
  input: Parameters<ModelCatalogueStore["setProvider"]>[0],
  credentialReferenceId: string | null,
) {
  return (
    current.displayName === input.displayName &&
    current.adapterKind === input.adapterKind &&
    current.baseUrl === input.baseUrl &&
    current.credentialReferenceId === credentialReferenceId &&
    arraysEqual(current.regions, input.regions) &&
    current.maximumDataClassification === input.maximumDataClassification &&
    current.lifecycle === input.lifecycle
  );
}

function modelMatches(
  current: {
    readonly displayName: string;
    readonly kind: string;
    readonly capabilities: ReadonlyArray<string>;
    readonly contextWindowTokens: number;
    readonly maximumOutputTokens: number | null;
    readonly inputPriceMicrounitsPerMillion: number;
    readonly outputPriceMicrounitsPerMillion: number;
    readonly regions: ReadonlyArray<string>;
    readonly maximumDataClassification: string;
    readonly lifecycle: string;
  },
  input: Parameters<ModelCatalogueStore["setModel"]>[0],
) {
  return (
    current.displayName === input.displayName &&
    current.kind === input.kind &&
    arraysEqual(current.capabilities, input.capabilities) &&
    current.contextWindowTokens === input.contextWindowTokens &&
    current.maximumOutputTokens === input.maximumOutputTokens &&
    current.inputPriceMicrounitsPerMillion ===
      input.inputPriceMicrounitsPerMillion &&
    current.outputPriceMicrounitsPerMillion ===
      input.outputPriceMicrounitsPerMillion &&
    arraysEqual(current.regions, input.regions) &&
    current.maximumDataClassification === input.maximumDataClassification &&
    current.lifecycle === input.lifecycle
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
