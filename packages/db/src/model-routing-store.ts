import type { ModelRoutingStore } from "@atharvan/models";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  modelOperationalControlRevisions,
  modelOperationalControls,
  modelProviderHealthObservations,
  modelProviderRevisions,
  modelProviders,
  modelRevisions,
  modelRoutingPolicies,
  modelRoutingPolicyRevisions,
  modelRoutingPolicyTargets,
  models,
  operators,
  platformSecretReferences,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Queryable = Database | Transaction;

export function createPostgresModelRoutingStore(
  database: Database,
): ModelRoutingStore {
  return {
    async listOperations(input) {
      const [policyRows, targetRows, controls] = await Promise.all([
        database
          .select({
            id: modelRoutingPolicies.id,
            key: modelRoutingPolicies.key,
            displayName: modelRoutingPolicyRevisions.displayName,
            requiredCapabilities:
              modelRoutingPolicyRevisions.requiredCapabilities,
            maximumDataClassification:
              modelRoutingPolicyRevisions.maximumDataClassification,
            allowedRegions: modelRoutingPolicyRevisions.allowedRegions,
            revisionNumber: modelRoutingPolicyRevisions.revisionNumber,
            revisionId: modelRoutingPolicyRevisions.id,
            updatedAt: modelRoutingPolicies.updatedAt,
          })
          .from(modelRoutingPolicies)
          .innerJoin(
            modelRoutingPolicyRevisions,
            and(
              eq(modelRoutingPolicyRevisions.policyId, modelRoutingPolicies.id),
              eq(
                modelRoutingPolicyRevisions.revisionNumber,
                modelRoutingPolicies.currentRevisionNumber,
              ),
            ),
          )
          .where(eq(modelRoutingPolicies.environment, input.environment))
          .orderBy(asc(modelRoutingPolicyRevisions.displayName)),
        listCurrentPolicyTargets(database, input.environment),
        listOperationalControls(database, input.environment, input.now),
      ]);
      const targetsByRevision = new Map<
        string,
        Array<(typeof targetRows)[number]>
      >();
      for (const target of targetRows) {
        const items = targetsByRevision.get(target.policyRevisionId) ?? [];
        items.push(target);
        targetsByRevision.set(target.policyRevisionId, items);
      }
      return {
        environment: input.environment,
        policies: policyRows.map((policy) => ({
          id: policy.id,
          key: policy.key,
          displayName: policy.displayName,
          requiredCapabilities: policy.requiredCapabilities as Array<
            | "text_generation"
            | "code_generation"
            | "reasoning"
            | "vision"
            | "tool_use"
            | "structured_output"
            | "embeddings"
          >,
          maximumDataClassification: policy.maximumDataClassification,
          allowedRegions: policy.allowedRegions,
          revisionNumber: policy.revisionNumber,
          updatedAt: policy.updatedAt.toISOString(),
          targets: (targetsByRevision.get(policy.revisionId) ?? []).map(
            publicTarget,
          ),
        })),
        controls,
      };
    },

    async setPolicy(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        const targetModelIds = input.targets.map((target) => target.modelId);
        const validModels = await transaction
          .select({ id: models.id })
          .from(models)
          .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
          .where(
            and(
              inArray(models.id, targetModelIds),
              eq(modelProviders.environment, input.environment),
            ),
          );
        if (
          new Set(validModels.map((model) => model.id)).size !==
          input.targets.length
        ) {
          return { outcome: "rejected", reason: "routing_target_not_found" };
        }

        let [policy] = await transaction
          .select({
            id: modelRoutingPolicies.id,
            currentRevisionNumber: modelRoutingPolicies.currentRevisionNumber,
          })
          .from(modelRoutingPolicies)
          .where(
            and(
              eq(modelRoutingPolicies.key, input.key),
              eq(modelRoutingPolicies.environment, input.environment),
            ),
          )
          .limit(1)
          .for("update");
        if (policy === undefined) {
          const [created] = await transaction
            .insert(modelRoutingPolicies)
            .values({
              id: input.policyId,
              key: input.key,
              environment: input.environment,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing()
            .returning({ id: modelRoutingPolicies.id });
          if (created === undefined) {
            [policy] = await transaction
              .select({
                id: modelRoutingPolicies.id,
                currentRevisionNumber:
                  modelRoutingPolicies.currentRevisionNumber,
              })
              .from(modelRoutingPolicies)
              .where(
                and(
                  eq(modelRoutingPolicies.key, input.key),
                  eq(modelRoutingPolicies.environment, input.environment),
                ),
              )
              .limit(1)
              .for("update");
          } else {
            await insertPolicyRevision(transaction, input, created.id, 1);
            await insertRoutingAudit(transaction, {
              input,
              eventType: "platform.model_routing_policy.created",
              targetType: "model_routing_policy",
              targetId: created.id,
              previousRevisionNumber: null,
              revisionNumber: 1,
            });
            return {
              outcome: "created",
              id: created.id,
              revisionNumber: 1,
            };
          }
        }
        if (policy === undefined) throw new Error("routing_policy_conflict");

        const current = await getPolicyRevision(
          transaction,
          policy.id,
          policy.currentRevisionNumber,
        );
        if (current === null) throw new Error("routing_policy_conflict");
        if (policyMatches(current, input)) {
          return {
            outcome: "unchanged",
            id: policy.id,
            revisionNumber: policy.currentRevisionNumber,
          };
        }
        const revisionNumber = policy.currentRevisionNumber + 1;
        await insertPolicyRevision(
          transaction,
          input,
          policy.id,
          revisionNumber,
        );
        await transaction
          .update(modelRoutingPolicies)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(modelRoutingPolicies.id, policy.id));
        await insertRoutingAudit(transaction, {
          input,
          eventType: "platform.model_routing_policy.updated",
          targetType: "model_routing_policy",
          targetId: policy.id,
          previousRevisionNumber: policy.currentRevisionNumber,
          revisionNumber,
        });
        return { outcome: "updated", id: policy.id, revisionNumber };
      });
    },

    async setControl(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId))) {
          return { outcome: "rejected", reason: "operator_not_active" };
        }
        if (
          !(await targetExists(
            transaction,
            input.environment,
            input.targetKind,
            input.targetId,
          ))
        ) {
          return { outcome: "rejected", reason: "routing_target_not_found" };
        }

        const targetFilter =
          input.targetKind === "provider"
            ? eq(modelOperationalControls.providerId, input.targetId)
            : eq(modelOperationalControls.modelId, input.targetId);
        let [control] = await transaction
          .select({
            id: modelOperationalControls.id,
            currentRevisionNumber:
              modelOperationalControls.currentRevisionNumber,
          })
          .from(modelOperationalControls)
          .where(targetFilter)
          .limit(1)
          .for("update");
        if (control === undefined) {
          const [created] = await transaction
            .insert(modelOperationalControls)
            .values({
              id: input.controlId,
              targetKind: input.targetKind,
              providerId:
                input.targetKind === "provider" ? input.targetId : null,
              modelId: input.targetKind === "model" ? input.targetId : null,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing()
            .returning({ id: modelOperationalControls.id });
          if (created === undefined) {
            [control] = await transaction
              .select({
                id: modelOperationalControls.id,
                currentRevisionNumber:
                  modelOperationalControls.currentRevisionNumber,
              })
              .from(modelOperationalControls)
              .where(targetFilter)
              .limit(1)
              .for("update");
          } else {
            await insertControlRevision(transaction, input, created.id, 1);
            await insertRoutingAudit(transaction, {
              input,
              eventType: "platform.model_operational_control.created",
              targetType: `model_${input.targetKind}_control`,
              targetId: input.targetId,
              previousRevisionNumber: null,
              revisionNumber: 1,
            });
            return {
              outcome: "created",
              id: created.id,
              revisionNumber: 1,
            };
          }
        }
        if (control === undefined) throw new Error("routing_control_conflict");
        const [current] = await transaction
          .select({
            state: modelOperationalControlRevisions.state,
            maintenanceExpiresAt:
              modelOperationalControlRevisions.maintenanceExpiresAt,
          })
          .from(modelOperationalControlRevisions)
          .where(
            and(
              eq(modelOperationalControlRevisions.controlId, control.id),
              eq(
                modelOperationalControlRevisions.revisionNumber,
                control.currentRevisionNumber,
              ),
            ),
          )
          .limit(1);
        if (current === undefined) throw new Error("routing_control_conflict");
        if (
          current.state === input.state &&
          dateEqual(current.maintenanceExpiresAt, input.maintenanceExpiresAt)
        ) {
          return {
            outcome: "unchanged",
            id: control.id,
            revisionNumber: control.currentRevisionNumber,
          };
        }
        const revisionNumber = control.currentRevisionNumber + 1;
        await insertControlRevision(
          transaction,
          input,
          control.id,
          revisionNumber,
        );
        await transaction
          .update(modelOperationalControls)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(modelOperationalControls.id, control.id));
        await insertRoutingAudit(transaction, {
          input,
          eventType: "platform.model_operational_control.updated",
          targetType: `model_${input.targetKind}_control`,
          targetId: input.targetId,
          previousRevisionNumber: control.currentRevisionNumber,
          revisionNumber,
        });
        return { outcome: "updated", id: control.id, revisionNumber };
      });
    },

    async getResolutionSnapshot(input) {
      const [policy] = await database
        .select({
          id: modelRoutingPolicies.id,
          key: modelRoutingPolicies.key,
          revisionId: modelRoutingPolicyRevisions.id,
          revisionNumber: modelRoutingPolicyRevisions.revisionNumber,
          requiredCapabilities:
            modelRoutingPolicyRevisions.requiredCapabilities,
          maximumDataClassification:
            modelRoutingPolicyRevisions.maximumDataClassification,
          allowedRegions: modelRoutingPolicyRevisions.allowedRegions,
        })
        .from(modelRoutingPolicies)
        .innerJoin(
          modelRoutingPolicyRevisions,
          and(
            eq(modelRoutingPolicyRevisions.policyId, modelRoutingPolicies.id),
            eq(
              modelRoutingPolicyRevisions.revisionNumber,
              modelRoutingPolicies.currentRevisionNumber,
            ),
          ),
        )
        .where(
          and(
            eq(modelRoutingPolicies.key, input.policyKey),
            eq(modelRoutingPolicies.environment, input.environment),
          ),
        )
        .limit(1);
      if (policy === undefined) return null;
      const [targetRows, controls] = await Promise.all([
        listTargetsForRevision(database, policy.revisionId),
        listOperationalControls(database, input.environment, input.now),
      ]);
      const providerIds = [...new Set(targetRows.map((row) => row.providerId))];
      const healthRows =
        providerIds.length === 0
          ? []
          : await database
              .selectDistinctOn([modelProviderHealthObservations.providerId], {
                providerId: modelProviderHealthObservations.providerId,
                status: modelProviderHealthObservations.status,
                expiresAt: modelProviderHealthObservations.expiresAt,
              })
              .from(modelProviderHealthObservations)
              .where(
                inArray(
                  modelProviderHealthObservations.providerId,
                  providerIds,
                ),
              )
              .orderBy(
                modelProviderHealthObservations.providerId,
                desc(modelProviderHealthObservations.observedAt),
                desc(modelProviderHealthObservations.createdAt),
              );
      const healthByProvider = new Map(
        healthRows.map((health) => [health.providerId, health]),
      );
      const controlByTarget = new Map(
        controls.map((control) => [
          `${control.targetKind}:${control.targetId}`,
          control.effectiveState,
        ]),
      );
      return {
        policyId: policy.id,
        policyKey: policy.key,
        policyRevisionId: policy.revisionId,
        policyRevisionNumber: policy.revisionNumber,
        requiredCapabilities: policy.requiredCapabilities as Array<
          | "text_generation"
          | "code_generation"
          | "reasoning"
          | "vision"
          | "tool_use"
          | "structured_output"
          | "embeddings"
        >,
        maximumDataClassification: policy.maximumDataClassification,
        allowedRegions: policy.allowedRegions,
        candidates: targetRows.map((target) => {
          const health = healthByProvider.get(target.providerId);
          return {
            targetId: target.id,
            modelId: target.modelId,
            modelKey: target.modelKey,
            modelDisplayName: target.modelDisplayName,
            providerId: target.providerId,
            providerKey: target.providerKey,
            providerDisplayName: target.providerDisplayName,
            priority: target.priority,
            rolloutBasisPoints: target.rolloutBasisPoints,
            allowDegraded: target.allowDegraded,
            modelCapabilities: target.modelCapabilities as Array<
              | "text_generation"
              | "code_generation"
              | "reasoning"
              | "vision"
              | "tool_use"
              | "structured_output"
              | "embeddings"
            >,
            modelRegions: target.modelRegions,
            modelMaximumDataClassification:
              target.modelMaximumDataClassification,
            modelLifecycle: target.modelLifecycle,
            providerRegions: target.providerRegions,
            providerMaximumDataClassification:
              target.providerMaximumDataClassification,
            providerLifecycle: target.providerLifecycle,
            providerAdapterKind: target.providerAdapterKind,
            providerCredentialActive:
              target.providerCredentialStatus === "active",
            providerHealthState:
              health === undefined
                ? "unknown"
                : health.expiresAt.getTime() <= input.now.getTime()
                  ? "stale"
                  : health.status,
            providerControlState:
              controlByTarget.get(`provider:${target.providerId}`) ??
              "unconfigured",
            modelControlState:
              controlByTarget.get(`model:${target.modelId}`) ?? "unconfigured",
          };
        }),
      };
    },
  };
}

async function listCurrentPolicyTargets(
  database: Queryable,
  environment: "development" | "production" | "test",
) {
  return database
    .select({
      policyRevisionId: modelRoutingPolicyTargets.policyRevisionId,
      id: modelRoutingPolicyTargets.id,
      modelId: models.id,
      modelKey: models.key,
      modelDisplayName: modelRevisions.displayName,
      providerId: modelProviders.id,
      providerKey: modelProviders.key,
      providerDisplayName: modelProviderRevisions.displayName,
      priority: modelRoutingPolicyTargets.priority,
      rolloutBasisPoints: modelRoutingPolicyTargets.rolloutBasisPoints,
      allowDegraded: modelRoutingPolicyTargets.allowDegraded,
    })
    .from(modelRoutingPolicyTargets)
    .innerJoin(
      modelRoutingPolicyRevisions,
      eq(
        modelRoutingPolicyRevisions.id,
        modelRoutingPolicyTargets.policyRevisionId,
      ),
    )
    .innerJoin(
      modelRoutingPolicies,
      and(
        eq(modelRoutingPolicies.id, modelRoutingPolicyRevisions.policyId),
        eq(
          modelRoutingPolicies.currentRevisionNumber,
          modelRoutingPolicyRevisions.revisionNumber,
        ),
      ),
    )
    .innerJoin(models, eq(models.id, modelRoutingPolicyTargets.modelId))
    .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
    .innerJoin(
      modelRevisions,
      and(
        eq(modelRevisions.modelId, models.id),
        eq(modelRevisions.revisionNumber, models.currentRevisionNumber),
      ),
    )
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
    .where(eq(modelRoutingPolicies.environment, environment))
    .orderBy(
      modelRoutingPolicyTargets.policyRevisionId,
      asc(modelRoutingPolicyTargets.priority),
    );
}

async function listTargetsForRevision(database: Queryable, revisionId: string) {
  return database
    .select({
      id: modelRoutingPolicyTargets.id,
      modelId: models.id,
      modelKey: models.key,
      modelDisplayName: modelRevisions.displayName,
      modelCapabilities: modelRevisions.capabilities,
      modelRegions: modelRevisions.regions,
      modelMaximumDataClassification: modelRevisions.maximumDataClassification,
      modelLifecycle: modelRevisions.lifecycle,
      providerId: modelProviders.id,
      providerKey: modelProviders.key,
      providerDisplayName: modelProviderRevisions.displayName,
      providerAdapterKind: modelProviderRevisions.adapterKind,
      providerRegions: modelProviderRevisions.regions,
      providerMaximumDataClassification:
        modelProviderRevisions.maximumDataClassification,
      providerLifecycle: modelProviderRevisions.lifecycle,
      providerCredentialStatus: platformSecretReferences.status,
      priority: modelRoutingPolicyTargets.priority,
      rolloutBasisPoints: modelRoutingPolicyTargets.rolloutBasisPoints,
      allowDegraded: modelRoutingPolicyTargets.allowDegraded,
    })
    .from(modelRoutingPolicyTargets)
    .innerJoin(models, eq(models.id, modelRoutingPolicyTargets.modelId))
    .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
    .innerJoin(
      modelRevisions,
      and(
        eq(modelRevisions.modelId, models.id),
        eq(modelRevisions.revisionNumber, models.currentRevisionNumber),
      ),
    )
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
    .where(eq(modelRoutingPolicyTargets.policyRevisionId, revisionId))
    .orderBy(asc(modelRoutingPolicyTargets.priority));
}

async function listOperationalControls(
  database: Queryable,
  environment: "development" | "production" | "test",
  now: Date,
) {
  const [providerRows, modelRows] = await Promise.all([
    database
      .select({
        id: modelOperationalControls.id,
        targetId: modelProviders.id,
        targetKey: modelProviders.key,
        targetDisplayName: modelProviderRevisions.displayName,
        providerId: modelProviders.id,
        providerKey: modelProviders.key,
        state: modelOperationalControlRevisions.state,
        maintenanceExpiresAt:
          modelOperationalControlRevisions.maintenanceExpiresAt,
        revisionNumber: modelOperationalControlRevisions.revisionNumber,
        updatedAt: modelOperationalControls.updatedAt,
      })
      .from(modelOperationalControls)
      .innerJoin(
        modelOperationalControlRevisions,
        and(
          eq(
            modelOperationalControlRevisions.controlId,
            modelOperationalControls.id,
          ),
          eq(
            modelOperationalControlRevisions.revisionNumber,
            modelOperationalControls.currentRevisionNumber,
          ),
        ),
      )
      .innerJoin(
        modelProviders,
        eq(modelProviders.id, modelOperationalControls.providerId),
      )
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
      .where(eq(modelProviders.environment, environment)),
    database
      .select({
        id: modelOperationalControls.id,
        targetId: models.id,
        targetKey: models.key,
        targetDisplayName: modelRevisions.displayName,
        providerId: modelProviders.id,
        providerKey: modelProviders.key,
        state: modelOperationalControlRevisions.state,
        maintenanceExpiresAt:
          modelOperationalControlRevisions.maintenanceExpiresAt,
        revisionNumber: modelOperationalControlRevisions.revisionNumber,
        updatedAt: modelOperationalControls.updatedAt,
      })
      .from(modelOperationalControls)
      .innerJoin(
        modelOperationalControlRevisions,
        and(
          eq(
            modelOperationalControlRevisions.controlId,
            modelOperationalControls.id,
          ),
          eq(
            modelOperationalControlRevisions.revisionNumber,
            modelOperationalControls.currentRevisionNumber,
          ),
        ),
      )
      .innerJoin(models, eq(models.id, modelOperationalControls.modelId))
      .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
      .innerJoin(
        modelRevisions,
        and(
          eq(modelRevisions.modelId, models.id),
          eq(modelRevisions.revisionNumber, models.currentRevisionNumber),
        ),
      )
      .where(eq(modelProviders.environment, environment)),
  ]);
  return [
    ...providerRows.map((row) => publicControl("provider", row, now)),
    ...modelRows.map((row) => publicControl("model", row, now)),
  ].sort((first, second) =>
    `${first.targetKind}:${first.targetDisplayName}`.localeCompare(
      `${second.targetKind}:${second.targetDisplayName}`,
    ),
  );
}

function publicControl(
  targetKind: "provider" | "model",
  row: {
    readonly id: string;
    readonly targetId: string;
    readonly targetKey: string;
    readonly targetDisplayName: string;
    readonly providerId: string;
    readonly providerKey: string;
    readonly state: "enabled" | "maintenance" | "disabled";
    readonly maintenanceExpiresAt: Date | null;
    readonly revisionNumber: number;
    readonly updatedAt: Date;
  },
  now: Date,
) {
  return {
    id: row.id,
    targetKind,
    targetId: row.targetId,
    targetKey: row.targetKey,
    targetDisplayName: row.targetDisplayName,
    providerId: row.providerId,
    providerKey: row.providerKey,
    configuredState: row.state,
    effectiveState:
      row.state === "maintenance" &&
      row.maintenanceExpiresAt !== null &&
      row.maintenanceExpiresAt.getTime() <= now.getTime()
        ? ("enabled" as const)
        : row.state,
    maintenanceExpiresAt: row.maintenanceExpiresAt?.toISOString() ?? null,
    revisionNumber: row.revisionNumber,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function publicTarget(row: {
  readonly id: string;
  readonly modelId: string;
  readonly modelKey: string;
  readonly modelDisplayName: string;
  readonly providerId: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly priority: number;
  readonly rolloutBasisPoints: number;
  readonly allowDegraded: boolean;
}) {
  return row;
}

async function getPolicyRevision(
  transaction: Transaction,
  policyId: string,
  revisionNumber: number,
) {
  const [revision] = await transaction
    .select({
      id: modelRoutingPolicyRevisions.id,
      displayName: modelRoutingPolicyRevisions.displayName,
      requiredCapabilities: modelRoutingPolicyRevisions.requiredCapabilities,
      maximumDataClassification:
        modelRoutingPolicyRevisions.maximumDataClassification,
      allowedRegions: modelRoutingPolicyRevisions.allowedRegions,
    })
    .from(modelRoutingPolicyRevisions)
    .where(
      and(
        eq(modelRoutingPolicyRevisions.policyId, policyId),
        eq(modelRoutingPolicyRevisions.revisionNumber, revisionNumber),
      ),
    )
    .limit(1);
  if (revision === undefined) return null;
  const targets = await transaction
    .select({
      modelId: modelRoutingPolicyTargets.modelId,
      priority: modelRoutingPolicyTargets.priority,
      rolloutBasisPoints: modelRoutingPolicyTargets.rolloutBasisPoints,
      allowDegraded: modelRoutingPolicyTargets.allowDegraded,
    })
    .from(modelRoutingPolicyTargets)
    .where(eq(modelRoutingPolicyTargets.policyRevisionId, revision.id))
    .orderBy(asc(modelRoutingPolicyTargets.priority));
  return { ...revision, targets };
}

function policyMatches(
  current: NonNullable<Awaited<ReturnType<typeof getPolicyRevision>>>,
  input: Parameters<ModelRoutingStore["setPolicy"]>[0],
) {
  return (
    current.displayName === input.displayName &&
    arraysEqual(current.requiredCapabilities, input.requiredCapabilities) &&
    current.maximumDataClassification === input.maximumDataClassification &&
    arraysEqual(current.allowedRegions, input.allowedRegions) &&
    current.targets.length === input.targets.length &&
    current.targets.every((target, index) => {
      const expected = input.targets[index];
      return (
        expected !== undefined &&
        target.modelId === expected.modelId &&
        target.priority === expected.priority &&
        target.rolloutBasisPoints === expected.rolloutBasisPoints &&
        target.allowDegraded === expected.allowDegraded
      );
    })
  );
}

async function insertPolicyRevision(
  transaction: Transaction,
  input: Parameters<ModelRoutingStore["setPolicy"]>[0],
  policyId: string,
  revisionNumber: number,
) {
  await transaction.insert(modelRoutingPolicyRevisions).values({
    id: input.revisionId,
    policyId,
    revisionNumber,
    displayName: input.displayName,
    requiredCapabilities: [...input.requiredCapabilities],
    maximumDataClassification: input.maximumDataClassification,
    allowedRegions: [...input.allowedRegions],
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
  await transaction.insert(modelRoutingPolicyTargets).values(
    input.targets.map((target) => ({
      id: target.id,
      policyRevisionId: input.revisionId,
      modelId: target.modelId,
      priority: target.priority,
      rolloutBasisPoints: target.rolloutBasisPoints,
      allowDegraded: target.allowDegraded,
      createdAt: input.now,
    })),
  );
}

async function insertControlRevision(
  transaction: Transaction,
  input: Parameters<ModelRoutingStore["setControl"]>[0],
  controlId: string,
  revisionNumber: number,
) {
  await transaction.insert(modelOperationalControlRevisions).values({
    id: input.revisionId,
    controlId,
    revisionNumber,
    state: input.state,
    maintenanceExpiresAt: input.maintenanceExpiresAt,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertRoutingAudit(
  transaction: Transaction,
  input: {
    readonly input: {
      readonly actorId: string;
      readonly correlationId: string;
      readonly reason: string;
      readonly now: Date;
    };
    readonly eventType: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly previousRevisionNumber: number | null;
    readonly revisionNumber: number;
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: input.input.actorId,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    correlationId: input.input.correlationId,
    reason: input.input.reason,
    evidence: {
      previousRevisionNumber: input.previousRevisionNumber,
      revisionNumber: input.revisionNumber,
    },
    occurredAt: input.input.now,
  });
}

async function targetExists(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  targetKind: "provider" | "model",
  targetId: string,
) {
  if (targetKind === "provider") {
    const [provider] = await transaction
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(
        and(
          eq(modelProviders.id, targetId),
          eq(modelProviders.environment, environment),
        ),
      )
      .limit(1);
    return provider !== undefined;
  }
  const [model] = await transaction
    .select({ id: models.id })
    .from(models)
    .innerJoin(modelProviders, eq(modelProviders.id, models.providerId))
    .where(
      and(eq(models.id, targetId), eq(modelProviders.environment, environment)),
    )
    .limit(1);
  return model !== undefined;
}

async function isActiveOperator(transaction: Transaction, actorId: string) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, actorId), eq(operators.status, "active")))
    .limit(1);
  return actor !== undefined;
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

function dateEqual(first: Date | null, second: Date | null) {
  return first?.getTime() === second?.getTime();
}
