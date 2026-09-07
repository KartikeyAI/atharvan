import type {
  EntitlementCommandResult,
  EntitlementStore,
} from "@atharvan/commercial";
import type {
  EntitlementValue,
  EnterpriseEntitlementGrant,
  WorkspaceEntitlementLayer,
  WorkspaceEntitlementSnapshot,
} from "@atharvan/domain";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import { enqueueArthCommand } from "./arth-command-outbox";
import * as schema from "./schema";
import {
  auditEvents,
  commercialPlanEntitlementSets,
  commercialPlanEntitlementValues,
  commercialPlans,
  commercialPlanVersions,
  commercialProductRevisions,
  commercialProducts,
  customerWorkspaceProjections,
  operators,
  workspaceEnterpriseEntitlementGrantRevisions,
  workspaceEnterpriseEntitlementGrants,
  workspaceEntitlementAssignments,
  workspaceEntitlementObservations,
  workspaceEntitlementSnapshotLayers,
  workspaceEntitlementSnapshots,
} from "./schema";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const maximumSnapshotHistory = 20;
const maximumObservationHistory = 100;
const maximumEnterpriseGrants = 128;

/** PostgreSQL persistence for sealed plan entitlements and workspace snapshots. */
export function createPostgresEntitlementStore(
  database: Database,
): EntitlementStore {
  return {
    async getPlanEntitlementSet(input) {
      const set = await findPlanEntitlementSet(
        database,
        input.environment,
        input.planVersionId,
      );
      if (!set) return null;
      return {
        id: set.id,
        planVersionId: input.planVersionId,
        values: await readPlanValues(database, set.id),
        reason: set.reason,
        createdByOperatorId: set.createdByOperatorId,
        createdAt: set.createdAt.toISOString(),
      };
    },

    async getWorkspaceEntitlements(input) {
      const [workspace] = await database
        .select({
          name: customerWorkspaceProjections.name,
          lifecycle: customerWorkspaceProjections.lifecycle,
        })
        .from(customerWorkspaceProjections)
        .where(
          and(
            eq(customerWorkspaceProjections.environment, input.environment),
            eq(customerWorkspaceProjections.sourceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (!workspace) return null;

      const [assignment] = await database
        .select()
        .from(workspaceEntitlementAssignments)
        .where(
          and(
            eq(workspaceEntitlementAssignments.environment, input.environment),
            eq(
              workspaceEntitlementAssignments.workspaceSourceId,
              input.workspaceId,
            ),
          ),
        )
        .limit(1);
      if (!assignment) {
        return {
          environment: input.environment,
          workspaceId: input.workspaceId,
          workspaceName: workspace.name,
          workspaceLifecycle: workspace.lifecycle,
          current: null,
          grants: [],
          history: [],
          historyTruncated: false,
        };
      }

      const snapshots = await database
        .select({
          id: workspaceEntitlementSnapshots.id,
          revisionNumber: workspaceEntitlementSnapshots.revisionNumber,
          planVersionId: workspaceEntitlementSnapshots.planVersionId,
          planKey: commercialPlans.key,
          planVersionNumber: commercialPlanVersions.versionNumber,
          reason: workspaceEntitlementSnapshots.reason,
          createdByOperatorId:
            workspaceEntitlementSnapshots.createdByOperatorId,
          createdAt: workspaceEntitlementSnapshots.createdAt,
        })
        .from(workspaceEntitlementSnapshots)
        .innerJoin(
          commercialPlanVersions,
          eq(
            commercialPlanVersions.id,
            workspaceEntitlementSnapshots.planVersionId,
          ),
        )
        .innerJoin(
          commercialPlans,
          eq(commercialPlans.id, commercialPlanVersions.planId),
        )
        .where(eq(workspaceEntitlementSnapshots.assignmentId, assignment.id))
        .orderBy(desc(workspaceEntitlementSnapshots.revisionNumber))
        .limit(maximumSnapshotHistory + 1);
      const visibleSnapshots = snapshots.slice(0, maximumSnapshotHistory);
      const snapshotIds = visibleSnapshots.map((snapshot) => snapshot.id);
      const [layers, observations, grantRows] = await Promise.all([
        snapshotIds.length === 0
          ? Promise.resolve([])
          : database
              .select()
              .from(workspaceEntitlementSnapshotLayers)
              .where(
                inArray(
                  workspaceEntitlementSnapshotLayers.snapshotId,
                  snapshotIds,
                ),
              )
              .orderBy(
                asc(workspaceEntitlementSnapshotLayers.key),
                asc(workspaceEntitlementSnapshotLayers.sourceKind),
              ),
        database
          .select()
          .from(workspaceEntitlementObservations)
          .where(
            eq(workspaceEntitlementObservations.assignmentId, assignment.id),
          )
          .orderBy(desc(workspaceEntitlementObservations.sourceRevision))
          .limit(maximumObservationHistory),
        readCurrentGrants(database, assignment.id),
      ]);
      const layersBySnapshot = new Map<string, WorkspaceEntitlementLayer[]>();
      for (const row of layers) {
        const values = layersBySnapshot.get(row.snapshotId) ?? [];
        values.push(toLayer(row));
        layersBySnapshot.set(row.snapshotId, values);
      }
      const observationsByRevision = new Map<
        number,
        (typeof observations)[number]
      >();
      for (const observation of observations) {
        if (!observationsByRevision.has(observation.desiredRevisionNumber)) {
          observationsByRevision.set(
            observation.desiredRevisionNumber,
            observation,
          );
        }
      }
      const history = visibleSnapshots.map((snapshot) =>
        toSnapshot(
          snapshot,
          layersBySnapshot.get(snapshot.id) ?? [],
          observationsByRevision.get(snapshot.revisionNumber),
          input.now,
        ),
      );
      return {
        environment: input.environment,
        workspaceId: input.workspaceId,
        workspaceName: workspace.name,
        workspaceLifecycle: workspace.lifecycle,
        current:
          history.find(
            (snapshot) =>
              snapshot.revisionNumber === assignment.currentRevisionNumber,
          ) ?? null,
        grants: grantRows.map((row) => toGrant(row, input.now)),
        history,
        historyTruncated: snapshots.length > maximumSnapshotHistory,
      };
    },

    async sealPlanEntitlementSet(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const plan = await findPlanVersion(
          transaction,
          input.environment,
          input.planVersionId,
        );
        if (!plan) return rejected("plan_version_not_found");
        if (
          plan.planLifecycle === "retired" ||
          plan.productLifecycle === "retired"
        )
          return rejected("plan_version_retired");

        const [created] = await transaction
          .insert(commercialPlanEntitlementSets)
          .values({
            id: input.setId,
            planVersionId: input.planVersionId,
            reason: input.reason,
            createdByOperatorId: input.actorId,
            correlationId: input.correlationId,
            createdAt: input.now,
          })
          .onConflictDoNothing({
            target: commercialPlanEntitlementSets.planVersionId,
          })
          .returning({ id: commercialPlanEntitlementSets.id });
        if (created) {
          await insertPlanValues(transaction, created.id, input.values);
          const result = createdResult(created.id, 1);
          await recordEntitlementChange(transaction, input, result, {
            eventType: "commercial.plan_entitlements.sealed",
            targetType: "commercial_plan_version",
            targetId: input.planVersionId,
            evidence: { entitlementCount: input.values.length },
            commandName: "commercial.plan-entitlements.seal",
          });
          return result;
        }

        const existing = await findPlanEntitlementSet(
          transaction,
          input.environment,
          input.planVersionId,
        );
        if (!existing) throw new Error("plan_entitlement_set_state_conflict");
        const existingValues = await readPlanValues(transaction, existing.id);
        if (!valuesEqual(existingValues, input.values))
          return rejected("plan_entitlement_set_already_sealed");
        const result = unchangedResult(existing.id, 1);
        await recordEntitlementReceipt(transaction, input, result, {
          name: "commercial.plan-entitlements.seal",
          targetType: "commercial_plan_version",
          targetId: input.planVersionId,
        });
        return result;
      });
    },

    async assignWorkspacePlan(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const workspace = await lockWorkspace(
          transaction,
          input.environment,
          input.workspaceId,
        );
        if (!workspace) return rejected("workspace_not_found");
        if (workspace.lifecycle === "archived")
          return rejected("workspace_archived");
        const plan = await findPlanVersion(
          transaction,
          input.environment,
          input.planVersionId,
        );
        if (!plan) return rejected("plan_version_not_found");
        if (
          plan.planLifecycle !== "active" ||
          plan.productLifecycle !== "active"
        )
          return rejected("plan_version_not_active");
        const set = await findPlanEntitlementSet(
          transaction,
          input.environment,
          input.planVersionId,
        );
        if (!set) return rejected("plan_entitlement_set_missing");

        let assignment = await lockAssignment(
          transaction,
          input.environment,
          input.workspaceId,
        );
        let created = false;
        if (!assignment) {
          const [inserted] = await transaction
            .insert(workspaceEntitlementAssignments)
            .values({
              id: input.assignmentId,
              environment: input.environment,
              workspaceSourceId: input.workspaceId,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                workspaceEntitlementAssignments.environment,
                workspaceEntitlementAssignments.workspaceSourceId,
              ],
            })
            .returning({ id: workspaceEntitlementAssignments.id });
          created = inserted !== undefined;
          assignment = created
            ? { id: input.assignmentId, currentRevisionNumber: 1 }
            : await lockAssignment(
                transaction,
                input.environment,
                input.workspaceId,
              );
        }
        if (!assignment)
          throw new Error("entitlement_assignment_state_conflict");
        if (!created) {
          const current = await readSnapshotHeader(
            transaction,
            assignment.id,
            assignment.currentRevisionNumber,
          );
          if (!current) throw new Error("entitlement_snapshot_state_conflict");
          if (current.planVersionId === input.planVersionId) {
            const result = unchangedResult(
              assignment.id,
              assignment.currentRevisionNumber,
            );
            await recordEntitlementReceipt(transaction, input, result, {
              name: "entitlement.assign",
              targetType: "workspace_entitlement",
              targetId: input.workspaceId,
            });
            return result;
          }
        }

        const revisionNumber = created
          ? 1
          : assignment.currentRevisionNumber + 1;
        const layers = await buildLayers(
          transaction,
          assignment.id,
          set.id,
          input.now,
        );
        await insertSnapshot(transaction, {
          snapshotId: input.snapshotId,
          assignmentId: assignment.id,
          revisionNumber,
          planVersionId: input.planVersionId,
          entitlementSetId: set.id,
          actorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
          now: input.now,
          layers,
        });
        if (!created) {
          await transaction
            .update(workspaceEntitlementAssignments)
            .set({
              currentRevisionNumber: revisionNumber,
              updatedAt: input.now,
            })
            .where(eq(workspaceEntitlementAssignments.id, assignment.id));
        }
        await enqueueSnapshotCommand(transaction, input, {
          assignmentId: assignment.id,
          revisionNumber,
          planVersionId: input.planVersionId,
          layers,
        });
        const result = created
          ? createdResult(assignment.id, revisionNumber)
          : updatedResult(assignment.id, revisionNumber);
        await recordEntitlementChange(transaction, input, result, {
          eventType: "workspace.entitlement_snapshot.assigned",
          targetType: "workspace_entitlement",
          targetId: input.workspaceId,
          evidence: {
            snapshotId: input.snapshotId,
            planVersionId: input.planVersionId,
            entitlementCount: layers.length,
          },
          commandName: "entitlement.assign",
        });
        return result;
      });
    },

    async setEnterpriseGrant(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const assignment = await lockAssignment(
          transaction,
          input.environment,
          input.workspaceId,
        );
        if (!assignment) return rejected("workspace_entitlement_missing");
        const currentSnapshot = await readSnapshotHeader(
          transaction,
          assignment.id,
          assignment.currentRevisionNumber,
        );
        if (!currentSnapshot)
          throw new Error("entitlement_snapshot_state_conflict");

        let grant = await lockGrant(
          transaction,
          assignment.id,
          input.value.key,
        );
        let created = false;
        if (!grant) {
          if (input.lifecycle === "revoked") return rejected("grant_not_found");
          const existingGrants = await transaction
            .select({ id: workspaceEnterpriseEntitlementGrants.id })
            .from(workspaceEnterpriseEntitlementGrants)
            .where(
              eq(
                workspaceEnterpriseEntitlementGrants.assignmentId,
                assignment.id,
              ),
            )
            .limit(maximumEnterpriseGrants);
          if (existingGrants.length >= maximumEnterpriseGrants)
            return rejected("enterprise_grant_limit_reached");
          const [inserted] = await transaction
            .insert(workspaceEnterpriseEntitlementGrants)
            .values({
              id: input.grantId,
              assignmentId: assignment.id,
              key: input.value.key,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                workspaceEnterpriseEntitlementGrants.assignmentId,
                workspaceEnterpriseEntitlementGrants.key,
              ],
            })
            .returning({ id: workspaceEnterpriseEntitlementGrants.id });
          created = inserted !== undefined;
          grant = created
            ? { id: input.grantId, currentRevisionNumber: 1 }
            : await lockGrant(transaction, assignment.id, input.value.key);
        }
        if (!grant) throw new Error("enterprise_grant_state_conflict");
        if (!created) {
          const current = await readGrantRevision(
            transaction,
            grant.id,
            grant.currentRevisionNumber,
          );
          if (!current) throw new Error("enterprise_grant_state_conflict");
          if (current.lifecycle === "revoked")
            return rejected("grant_already_revoked");
          if (grantMatches(current, input)) {
            const result = unchangedResult(
              grant.id,
              grant.currentRevisionNumber,
            );
            await recordEntitlementReceipt(transaction, input, result, {
              name: "entitlement.enterprise-grant.set",
              targetType: "workspace_entitlement_grant",
              targetId: `${input.workspaceId}/${input.value.key}`,
            });
            return result;
          }
        }

        const grantRevisionNumber = created
          ? 1
          : grant.currentRevisionNumber + 1;
        await insertGrantRevision(
          transaction,
          input,
          grant.id,
          grantRevisionNumber,
        );
        if (!created) {
          await transaction
            .update(workspaceEnterpriseEntitlementGrants)
            .set({
              currentRevisionNumber: grantRevisionNumber,
              updatedAt: input.now,
            })
            .where(eq(workspaceEnterpriseEntitlementGrants.id, grant.id));
        }

        const snapshotRevisionNumber = assignment.currentRevisionNumber + 1;
        const layers = await buildLayers(
          transaction,
          assignment.id,
          currentSnapshot.entitlementSetId,
          input.now,
        );
        await insertSnapshot(transaction, {
          snapshotId: input.snapshotId,
          assignmentId: assignment.id,
          revisionNumber: snapshotRevisionNumber,
          planVersionId: currentSnapshot.planVersionId,
          entitlementSetId: currentSnapshot.entitlementSetId,
          actorId: input.actorId,
          reason: input.reason,
          correlationId: input.correlationId,
          now: input.now,
          layers,
        });
        await transaction
          .update(workspaceEntitlementAssignments)
          .set({
            currentRevisionNumber: snapshotRevisionNumber,
            updatedAt: input.now,
          })
          .where(eq(workspaceEntitlementAssignments.id, assignment.id));
        await enqueueSnapshotCommand(transaction, input, {
          assignmentId: assignment.id,
          revisionNumber: snapshotRevisionNumber,
          planVersionId: currentSnapshot.planVersionId,
          layers,
        });
        const result = {
          outcome: created ? ("created" as const) : ("updated" as const),
          id: grant.id,
          revisionNumber: grantRevisionNumber,
          snapshotRevisionNumber,
        };
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          commandId: input.commandId,
          eventType:
            input.lifecycle === "revoked"
              ? "workspace.enterprise_entitlement_grant.revoked"
              : created
                ? "workspace.enterprise_entitlement_grant.created"
                : "workspace.enterprise_entitlement_grant.updated",
          targetType: "workspace_entitlement_grant",
          targetId: grant.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            workspaceId: input.workspaceId,
            entitlementKey: input.value.key,
            grantRevisionNumber,
            snapshotRevisionNumber,
            contractReference: input.contractReference,
          },
          occurredAt: input.now,
        });
        await recordEntitlementReceipt(transaction, input, result, {
          name: "entitlement.enterprise-grant.set",
          targetType: "workspace_entitlement_grant",
          targetId: `${input.workspaceId}/${input.value.key}`,
        });
        return result;
      });
    },
  };
}

async function findPlanVersion(
  database: Transaction,
  environment: "development" | "production" | "test",
  planVersionId: string,
) {
  const [plan] = await database
    .select({
      planLifecycle: commercialPlanVersions.lifecycle,
      productLifecycle: commercialProductRevisions.lifecycle,
    })
    .from(commercialPlanVersions)
    .innerJoin(
      commercialPlans,
      eq(commercialPlans.id, commercialPlanVersions.planId),
    )
    .innerJoin(
      commercialProducts,
      eq(commercialProducts.id, commercialPlans.productId),
    )
    .innerJoin(
      commercialProductRevisions,
      and(
        eq(commercialProductRevisions.productId, commercialProducts.id),
        eq(
          commercialProductRevisions.revisionNumber,
          commercialProducts.currentRevisionNumber,
        ),
      ),
    )
    .where(
      and(
        eq(commercialPlanVersions.id, planVersionId),
        eq(commercialProducts.environment, environment),
      ),
    )
    .limit(1)
    .for("share", { of: commercialProducts });
  return plan;
}

async function findPlanEntitlementSet(
  database: Database | Transaction,
  environment: "development" | "production" | "test",
  planVersionId: string,
) {
  const [set] = await database
    .select({
      id: commercialPlanEntitlementSets.id,
      reason: commercialPlanEntitlementSets.reason,
      createdByOperatorId: commercialPlanEntitlementSets.createdByOperatorId,
      createdAt: commercialPlanEntitlementSets.createdAt,
    })
    .from(commercialPlanEntitlementSets)
    .innerJoin(
      commercialPlanVersions,
      eq(
        commercialPlanVersions.id,
        commercialPlanEntitlementSets.planVersionId,
      ),
    )
    .innerJoin(
      commercialPlans,
      eq(commercialPlans.id, commercialPlanVersions.planId),
    )
    .innerJoin(
      commercialProducts,
      eq(commercialProducts.id, commercialPlans.productId),
    )
    .where(
      and(
        eq(commercialPlanEntitlementSets.planVersionId, planVersionId),
        eq(commercialProducts.environment, environment),
      ),
    )
    .limit(1);
  return set;
}

async function readPlanValues(
  database: Database | Transaction,
  entitlementSetId: string,
) {
  const rows = await database
    .select()
    .from(commercialPlanEntitlementValues)
    .where(
      eq(commercialPlanEntitlementValues.entitlementSetId, entitlementSetId),
    )
    .orderBy(asc(commercialPlanEntitlementValues.key));
  return rows.map(toValue);
}

async function insertPlanValues(
  transaction: Transaction,
  entitlementSetId: string,
  values: ReadonlyArray<EntitlementValue>,
) {
  await transaction.insert(commercialPlanEntitlementValues).values(
    values.map((value) => ({
      entitlementSetId,
      ...toValueColumns(value),
    })),
  );
}

async function lockWorkspace(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  workspaceId: string,
) {
  const [workspace] = await transaction
    .select({ lifecycle: customerWorkspaceProjections.lifecycle })
    .from(customerWorkspaceProjections)
    .where(
      and(
        eq(customerWorkspaceProjections.environment, environment),
        eq(customerWorkspaceProjections.sourceId, workspaceId),
      ),
    )
    .limit(1)
    .for("share");
  return workspace;
}

async function lockAssignment(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  workspaceId: string,
) {
  const [assignment] = await transaction
    .select({
      id: workspaceEntitlementAssignments.id,
      currentRevisionNumber:
        workspaceEntitlementAssignments.currentRevisionNumber,
    })
    .from(workspaceEntitlementAssignments)
    .where(
      and(
        eq(workspaceEntitlementAssignments.environment, environment),
        eq(workspaceEntitlementAssignments.workspaceSourceId, workspaceId),
      ),
    )
    .limit(1)
    .for("update");
  return assignment;
}

async function readSnapshotHeader(
  transaction: Transaction,
  assignmentId: string,
  revisionNumber: number,
) {
  const [snapshot] = await transaction
    .select({
      planVersionId: workspaceEntitlementSnapshots.planVersionId,
      entitlementSetId: workspaceEntitlementSnapshots.entitlementSetId,
    })
    .from(workspaceEntitlementSnapshots)
    .where(
      and(
        eq(workspaceEntitlementSnapshots.assignmentId, assignmentId),
        eq(workspaceEntitlementSnapshots.revisionNumber, revisionNumber),
      ),
    )
    .limit(1);
  return snapshot;
}

async function lockGrant(
  transaction: Transaction,
  assignmentId: string,
  key: string,
) {
  const [grant] = await transaction
    .select({
      id: workspaceEnterpriseEntitlementGrants.id,
      currentRevisionNumber:
        workspaceEnterpriseEntitlementGrants.currentRevisionNumber,
    })
    .from(workspaceEnterpriseEntitlementGrants)
    .where(
      and(
        eq(workspaceEnterpriseEntitlementGrants.assignmentId, assignmentId),
        eq(workspaceEnterpriseEntitlementGrants.key, key),
      ),
    )
    .limit(1)
    .for("update");
  return grant;
}

async function readGrantRevision(
  transaction: Transaction,
  grantId: string,
  revisionNumber: number,
) {
  const [revision] = await transaction
    .select()
    .from(workspaceEnterpriseEntitlementGrantRevisions)
    .where(
      and(
        eq(workspaceEnterpriseEntitlementGrantRevisions.grantId, grantId),
        eq(
          workspaceEnterpriseEntitlementGrantRevisions.revisionNumber,
          revisionNumber,
        ),
      ),
    )
    .limit(1);
  return revision;
}

async function readCurrentGrants(
  database: Database | Transaction,
  assignmentId: string,
) {
  const grants = await database
    .select({
      id: workspaceEnterpriseEntitlementGrants.id,
      key: workspaceEnterpriseEntitlementGrants.key,
      revisionNumber:
        workspaceEnterpriseEntitlementGrants.currentRevisionNumber,
      revisionId: workspaceEnterpriseEntitlementGrantRevisions.id,
      valueType: workspaceEnterpriseEntitlementGrantRevisions.valueType,
      enabled: workspaceEnterpriseEntitlementGrantRevisions.enabled,
      limit: workspaceEnterpriseEntitlementGrantRevisions.limit,
      unit: workspaceEnterpriseEntitlementGrantRevisions.unit,
      overagePolicy: workspaceEnterpriseEntitlementGrantRevisions.overagePolicy,
      lifecycle: workspaceEnterpriseEntitlementGrantRevisions.lifecycle,
      contractReference:
        workspaceEnterpriseEntitlementGrantRevisions.contractReference,
      startsAt: workspaceEnterpriseEntitlementGrantRevisions.startsAt,
      expiresAt: workspaceEnterpriseEntitlementGrantRevisions.expiresAt,
      reason: workspaceEnterpriseEntitlementGrantRevisions.reason,
      createdByOperatorId:
        workspaceEnterpriseEntitlementGrantRevisions.createdByOperatorId,
      createdAt: workspaceEnterpriseEntitlementGrantRevisions.createdAt,
    })
    .from(workspaceEnterpriseEntitlementGrants)
    .innerJoin(
      workspaceEnterpriseEntitlementGrantRevisions,
      and(
        eq(
          workspaceEnterpriseEntitlementGrantRevisions.grantId,
          workspaceEnterpriseEntitlementGrants.id,
        ),
        eq(
          workspaceEnterpriseEntitlementGrantRevisions.revisionNumber,
          workspaceEnterpriseEntitlementGrants.currentRevisionNumber,
        ),
      ),
    )
    .where(eq(workspaceEnterpriseEntitlementGrants.assignmentId, assignmentId))
    .orderBy(asc(workspaceEnterpriseEntitlementGrants.key))
    .limit(maximumEnterpriseGrants + 1);
  if (grants.length > maximumEnterpriseGrants)
    throw new Error("enterprise_grant_limit_exceeded");
  return grants;
}

async function buildLayers(
  transaction: Transaction,
  assignmentId: string,
  entitlementSetId: string,
  now: Date,
) {
  const planValues = await readPlanValues(transaction, entitlementSetId);
  const grants = await readCurrentGrants(transaction, assignmentId);
  const layers: WorkspaceEntitlementLayer[] = planValues.map((value) => ({
    ...value,
    sourceKind: "plan",
    sourceId: entitlementSetId,
    startsAt: now.toISOString(),
    expiresAt: null,
  }));
  for (const grant of grants) {
    if (grant.lifecycle !== "active" || grant.expiresAt <= now) continue;
    layers.push({
      ...toValue({ ...grant, key: grant.key }),
      sourceKind: "enterprise_grant",
      sourceId: grant.revisionId,
      startsAt: grant.startsAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
    });
  }
  return layers.sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.sourceKind.localeCompare(right.sourceKind),
  );
}

async function insertSnapshot(
  transaction: Transaction,
  input: {
    readonly snapshotId: string;
    readonly assignmentId: string;
    readonly revisionNumber: number;
    readonly planVersionId: string;
    readonly entitlementSetId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
    readonly layers: ReadonlyArray<WorkspaceEntitlementLayer>;
  },
) {
  await transaction.insert(workspaceEntitlementSnapshots).values({
    id: input.snapshotId,
    assignmentId: input.assignmentId,
    revisionNumber: input.revisionNumber,
    planVersionId: input.planVersionId,
    entitlementSetId: input.entitlementSetId,
    reason: input.reason,
    createdByOperatorId: input.actorId,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
  await transaction.insert(workspaceEntitlementSnapshotLayers).values(
    input.layers.map((layer) => ({
      snapshotId: input.snapshotId,
      ...toValueColumns(layer),
      sourceKind: layer.sourceKind,
      sourceId: layer.sourceId,
      startsAt: new Date(layer.startsAt),
      expiresAt: layer.expiresAt === null ? null : new Date(layer.expiresAt),
    })),
  );
}

async function insertGrantRevision(
  transaction: Transaction,
  input: Parameters<EntitlementStore["setEnterpriseGrant"]>[0],
  grantId: string,
  revisionNumber: number,
) {
  await transaction
    .insert(workspaceEnterpriseEntitlementGrantRevisions)
    .values({
      id: input.grantRevisionId,
      grantId,
      revisionNumber,
      ...toValueColumns(input.value),
      lifecycle: input.lifecycle,
      contractReference: input.contractReference,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      reason: input.reason,
      createdByOperatorId: input.actorId,
      correlationId: input.correlationId,
      createdAt: input.now,
    });
}

async function enqueueSnapshotCommand(
  transaction: Transaction,
  input: {
    readonly commandId?: string;
    readonly environment: "development" | "production" | "test";
    readonly workspaceId: string;
    readonly now: Date;
  },
  snapshot: {
    readonly assignmentId: string;
    readonly revisionNumber: number;
    readonly planVersionId: string;
    readonly layers: ReadonlyArray<WorkspaceEntitlementLayer>;
  },
) {
  await enqueueArthCommand(transaction, {
    commandId: input.commandId,
    environment: input.environment,
    kind: "workspace_entitlement_snapshot",
    aggregateId: snapshot.assignmentId,
    aggregateRevision: snapshot.revisionNumber,
    payload: {
      kind: "workspace_entitlement_snapshot",
      assignmentId: snapshot.assignmentId,
      revisionNumber: snapshot.revisionNumber,
      workspaceId: input.workspaceId,
      planVersionId: snapshot.planVersionId,
      layers: snapshot.layers,
      requestedAt: input.now.toISOString(),
    },
    now: input.now,
  });
}

function toValue(row: {
  readonly key: string;
  readonly valueType: "boolean" | "quantity";
  readonly enabled: boolean | null;
  readonly limit: number | null;
  readonly unit: string | null;
  readonly overagePolicy: "denied" | "metered" | "contract";
}): EntitlementValue {
  if (row.valueType === "boolean") {
    if (row.enabled === null)
      throw new Error("entitlement_value_shape_invalid");
    return {
      key: row.key,
      valueType: "boolean",
      enabled: row.enabled,
      limit: null,
      unit: null,
      overagePolicy: "denied",
    };
  }
  if (row.unit === null) throw new Error("entitlement_value_shape_invalid");
  return {
    key: row.key,
    valueType: "quantity",
    enabled: null,
    limit: row.limit,
    unit: row.unit,
    overagePolicy: row.overagePolicy,
  };
}

function toValueColumns(value: EntitlementValue) {
  return {
    key: value.key,
    valueType: value.valueType,
    enabled: value.enabled,
    limit: value.limit,
    unit: value.unit,
    overagePolicy: value.overagePolicy,
  };
}

function toLayer(
  row: typeof workspaceEntitlementSnapshotLayers.$inferSelect,
): WorkspaceEntitlementLayer {
  return {
    ...toValue(row),
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function toSnapshot(
  row: {
    readonly id: string;
    readonly revisionNumber: number;
    readonly planVersionId: string;
    readonly planKey: string;
    readonly planVersionNumber: number;
    readonly reason: string;
    readonly createdByOperatorId: string;
    readonly createdAt: Date;
  },
  layers: ReadonlyArray<WorkspaceEntitlementLayer>,
  observation: typeof workspaceEntitlementObservations.$inferSelect | undefined,
  now: Date,
): WorkspaceEntitlementSnapshot {
  return {
    ...row,
    layers,
    effective: resolveEffective(layers, now),
    createdAt: row.createdAt.toISOString(),
    reconciliationState:
      observation === undefined
        ? "pending"
        : observation.observedState === "applied"
          ? "applied"
          : "failed",
    observedSourceRevision: observation?.sourceRevision.toString() ?? null,
    observedAt: observation?.observedAt.toISOString() ?? null,
    reconciliationMessage: observation?.message ?? null,
  };
}

function resolveEffective(
  layers: ReadonlyArray<WorkspaceEntitlementLayer>,
  now: Date,
) {
  const byKey = new Map<string, WorkspaceEntitlementLayer>();
  for (const layer of layers) {
    const startsAt = new Date(layer.startsAt);
    const expiresAt =
      layer.expiresAt === null ? null : new Date(layer.expiresAt);
    if (startsAt > now || (expiresAt !== null && expiresAt <= now)) continue;
    const current = byKey.get(layer.key);
    if (!current || layer.sourceKind === "enterprise_grant") {
      byKey.set(layer.key, layer);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((layer) => ({
      ...toValue(layer),
      sourceKind: layer.sourceKind,
      sourceId: layer.sourceId,
      expiresAt: layer.expiresAt,
    }));
}

function toGrant(
  row: Awaited<ReturnType<typeof readCurrentGrants>>[number],
  now: Date,
): EnterpriseEntitlementGrant {
  return {
    id: row.id,
    key: row.key,
    revisionNumber: row.revisionNumber,
    value: toValue({ ...row, key: row.key }),
    lifecycle: row.lifecycle,
    status:
      row.lifecycle === "revoked"
        ? "revoked"
        : row.startsAt > now
          ? "scheduled"
          : row.expiresAt <= now
            ? "expired"
            : "active",
    contractReference: row.contractReference,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    reason: row.reason,
    createdByOperatorId: row.createdByOperatorId,
    changedAt: row.createdAt.toISOString(),
  };
}

function grantMatches(
  current: NonNullable<Awaited<ReturnType<typeof readGrantRevision>>>,
  input: Parameters<EntitlementStore["setEnterpriseGrant"]>[0],
) {
  return (
    valuesEqual(
      [toValue({ ...current, key: input.value.key })],
      [input.value],
    ) &&
    current.lifecycle === input.lifecycle &&
    current.contractReference === input.contractReference &&
    current.startsAt.getTime() === input.startsAt.getTime() &&
    current.expiresAt.getTime() === input.expiresAt.getTime()
  );
}

function valuesEqual(
  left: ReadonlyArray<EntitlementValue>,
  right: ReadonlyArray<EntitlementValue>,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function isActiveOperator(transaction: Transaction, actorId: string) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, actorId), eq(operators.status, "active")))
    .limit(1);
  return actor !== undefined;
}

async function recordEntitlementChange(
  transaction: Transaction,
  input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly environment: "development" | "production" | "test";
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  },
  result: Exclude<EntitlementCommandResult, { outcome: "rejected" }>,
  change: {
    readonly eventType: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly evidence: Record<string, string | number>;
    readonly commandName:
      "commercial.plan-entitlements.seal" | "entitlement.assign";
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    commandId: input.commandId,
    eventType: change.eventType,
    targetType: change.targetType,
    targetId: result.id,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: change.evidence,
    occurredAt: input.now,
  });
  await recordEntitlementReceipt(transaction, input, result, {
    name: change.commandName,
    targetType: change.targetType,
    targetId: change.targetId,
  });
}

async function recordEntitlementReceipt(
  transaction: Transaction,
  input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly environment: "development" | "production" | "test";
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  },
  result: Exclude<EntitlementCommandResult, { outcome: "rejected" }>,
  command: {
    readonly name:
      | "commercial.plan-entitlements.seal"
      | "entitlement.assign"
      | "entitlement.enterprise-grant.set";
    readonly targetType: string;
    readonly targetId: string;
  },
) {
  if (input.commandId === undefined) return;
  await recordTransactionalCommandSuccess(
    transaction,
    {
      commandId: input.commandId,
      actorId: input.actorId,
      environment: input.environment,
      name: command.name,
      targetType: command.targetType,
      targetId: command.targetId,
      correlationId: input.correlationId,
      reason: input.reason,
      now: input.now,
    },
    result,
  );
}

function rejected(reason: string) {
  return { outcome: "rejected", reason } as const;
}

function createdResult(id: string, revisionNumber: number) {
  return { outcome: "created", id, revisionNumber } as const;
}

function updatedResult(id: string, revisionNumber: number) {
  return { outcome: "updated", id, revisionNumber } as const;
}

function unchangedResult(id: string, revisionNumber: number) {
  return { outcome: "unchanged", id, revisionNumber } as const;
}
