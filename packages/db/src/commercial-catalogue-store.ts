import type {
  CommercialCatalogueCommandResult,
  CommercialCatalogueStore,
} from "@atharvan/commercial";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  commercialPlanVersions,
  commercialPlans,
  commercialProductRevisions,
  commercialProducts,
  operators,
} from "./schema";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const maximumProducts = 200;
const maximumPlans = 1_000;
const maximumVersionRows = 2_000;
const maximumVersionsPerPlan = 20;

/** PostgreSQL persistence for the environment-scoped immutable commercial catalogue. */
export function createPostgresCommercialCatalogueStore(
  database: Database,
): CommercialCatalogueStore {
  return {
    async listCatalogue(input) {
      const rawProducts = await database
        .select({
          id: commercialProducts.id,
          key: commercialProducts.key,
          displayName: commercialProductRevisions.displayName,
          description: commercialProductRevisions.description,
          lifecycle: commercialProductRevisions.lifecycle,
          revisionNumber: commercialProductRevisions.revisionNumber,
          updatedAt: commercialProducts.updatedAt,
        })
        .from(commercialProducts)
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
        .where(eq(commercialProducts.environment, input.environment))
        .orderBy(asc(commercialProducts.key))
        .limit(maximumProducts + 1);
      const products = rawProducts.slice(0, maximumProducts);
      const productIds = products.map((product) => product.id);
      const rawPlans =
        productIds.length === 0
          ? []
          : await database
              .select({
                id: commercialPlans.id,
                productId: commercialPlans.productId,
                key: commercialPlans.key,
                currentVersionNumber: commercialPlans.currentVersionNumber,
                updatedAt: commercialPlans.updatedAt,
                versionId: commercialPlanVersions.id,
                displayName: commercialPlanVersions.displayName,
                description: commercialPlanVersions.description,
                audience: commercialPlanVersions.audience,
                pricingModel: commercialPlanVersions.pricingModel,
                billingInterval: commercialPlanVersions.billingInterval,
                currency: commercialPlanVersions.currency,
                amountMinor: commercialPlanVersions.amountMinor,
                taxBehavior: commercialPlanVersions.taxBehavior,
                trialDays: commercialPlanVersions.trialDays,
                providerPriceReference:
                  commercialPlanVersions.providerPriceReference,
                lifecycle: commercialPlanVersions.lifecycle,
                effectiveFrom: commercialPlanVersions.effectiveFrom,
                reason: commercialPlanVersions.reason,
                versionCreatedAt: commercialPlanVersions.createdAt,
              })
              .from(commercialPlans)
              .innerJoin(
                commercialPlanVersions,
                and(
                  eq(commercialPlanVersions.planId, commercialPlans.id),
                  eq(
                    commercialPlanVersions.versionNumber,
                    commercialPlans.currentVersionNumber,
                  ),
                ),
              )
              .where(inArray(commercialPlans.productId, productIds))
              .orderBy(asc(commercialPlans.productId), asc(commercialPlans.key))
              .limit(maximumPlans + 1);
      const plans = rawPlans.slice(0, maximumPlans);
      const planIds = plans.map((plan) => plan.id);
      const rawVersions =
        planIds.length === 0
          ? []
          : await database
              .select({
                id: commercialPlanVersions.id,
                planId: commercialPlanVersions.planId,
                versionNumber: commercialPlanVersions.versionNumber,
                displayName: commercialPlanVersions.displayName,
                description: commercialPlanVersions.description,
                audience: commercialPlanVersions.audience,
                pricingModel: commercialPlanVersions.pricingModel,
                billingInterval: commercialPlanVersions.billingInterval,
                currency: commercialPlanVersions.currency,
                amountMinor: commercialPlanVersions.amountMinor,
                taxBehavior: commercialPlanVersions.taxBehavior,
                trialDays: commercialPlanVersions.trialDays,
                providerPriceReference:
                  commercialPlanVersions.providerPriceReference,
                lifecycle: commercialPlanVersions.lifecycle,
                effectiveFrom: commercialPlanVersions.effectiveFrom,
                reason: commercialPlanVersions.reason,
                createdAt: commercialPlanVersions.createdAt,
              })
              .from(commercialPlanVersions)
              .where(inArray(commercialPlanVersions.planId, planIds))
              .orderBy(
                asc(commercialPlanVersions.planId),
                desc(commercialPlanVersions.versionNumber),
              )
              .limit(maximumVersionRows + 1);

      const versionsByPlan = new Map<
        string,
        Array<(typeof rawVersions)[number]>
      >();
      for (const version of rawVersions.slice(0, maximumVersionRows)) {
        const versions = versionsByPlan.get(version.planId) ?? [];
        if (versions.length < maximumVersionsPerPlan) versions.push(version);
        versionsByPlan.set(version.planId, versions);
      }
      const plansByProduct = new Map<string, Array<(typeof plans)[number]>>();
      for (const plan of plans) {
        const entries = plansByProduct.get(plan.productId) ?? [];
        entries.push(plan);
        plansByProduct.set(plan.productId, entries);
      }

      return {
        environment: input.environment,
        truncated:
          rawProducts.length > maximumProducts ||
          rawPlans.length > maximumPlans ||
          rawVersions.length > maximumVersionRows,
        items: products.map((product) => ({
          ...product,
          updatedAt: product.updatedAt.toISOString(),
          plans: (plansByProduct.get(product.id) ?? []).map((plan) => {
            const current = toPlanVersion({
              id: plan.versionId,
              versionNumber: plan.currentVersionNumber,
              displayName: plan.displayName,
              description: plan.description,
              audience: plan.audience,
              pricingModel: plan.pricingModel,
              billingInterval: plan.billingInterval,
              currency: plan.currency,
              amountMinor: plan.amountMinor,
              taxBehavior: plan.taxBehavior,
              trialDays: plan.trialDays,
              providerPriceReference: plan.providerPriceReference,
              lifecycle: plan.lifecycle,
              effectiveFrom: plan.effectiveFrom,
              reason: plan.reason,
              createdAt: plan.versionCreatedAt,
            });
            const versions = (versionsByPlan.get(plan.id) ?? []).map(
              toPlanVersion,
            );
            if (!versions.some((version) => version.id === current.id)) {
              versions.unshift(current);
            }
            return {
              id: plan.id,
              key: plan.key,
              currentVersionNumber: plan.currentVersionNumber,
              updatedAt: plan.updatedAt.toISOString(),
              current,
              versions: versions.slice(0, maximumVersionsPerPlan),
              historyTruncated: plan.currentVersionNumber > versions.length,
            };
          }),
        })),
      };
    },

    async setProduct(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");

        let product = await lockProduct(
          transaction,
          input.environment,
          input.key,
        );
        if (product === undefined) {
          const [created] = await transaction
            .insert(commercialProducts)
            .values({
              id: input.productId,
              environment: input.environment,
              key: input.key,
              currentRevisionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [commercialProducts.environment, commercialProducts.key],
            })
            .returning({ id: commercialProducts.id });
          if (created !== undefined) {
            await insertProductRevision(transaction, input, created.id, 1);
            const result = createdResult(created.id);
            await recordCommercialChange(transaction, input, result, {
              eventType: "commercial.product.created",
              targetType: "commercial_product",
              targetId: input.key,
              previousRevisionNumber: null,
            });
            return result;
          }
          product = await lockProduct(
            transaction,
            input.environment,
            input.key,
          );
        }
        if (product === undefined)
          throw new Error("commercial_product_state_conflict");

        const current = await currentProductRevision(
          transaction,
          product.id,
          product.currentRevisionNumber,
        );
        if (current === undefined)
          throw new Error("commercial_product_state_conflict");
        if (!validLifecycleTransition(current.lifecycle, input.lifecycle))
          return rejected("product_lifecycle_transition_invalid");
        if (
          current.displayName === input.displayName &&
          current.description === input.description &&
          current.lifecycle === input.lifecycle
        ) {
          const result = unchangedResult(
            product.id,
            product.currentRevisionNumber,
          );
          await recordCommercialReceipt(transaction, input, result, {
            name: "commercial.product.set",
            targetType: "commercial_product",
            targetId: input.key,
          });
          return result;
        }

        const revisionNumber = product.currentRevisionNumber + 1;
        await insertProductRevision(
          transaction,
          input,
          product.id,
          revisionNumber,
        );
        await transaction
          .update(commercialProducts)
          .set({ currentRevisionNumber: revisionNumber, updatedAt: input.now })
          .where(eq(commercialProducts.id, product.id));
        const result = updatedResult(product.id, revisionNumber);
        await recordCommercialChange(transaction, input, result, {
          eventType: "commercial.product.updated",
          targetType: "commercial_product",
          targetId: input.key,
          previousRevisionNumber: product.currentRevisionNumber,
        });
        return result;
      });
    },

    async setPlanVersion(input) {
      return database.transaction(async (transaction) => {
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const product = await findProductById(
          transaction,
          input.environment,
          input.productId,
        );
        if (product === undefined) return rejected("product_not_found");
        if (input.lifecycle === "active" && product.lifecycle !== "active")
          return rejected("product_not_active");

        let plan = await lockPlan(transaction, input.productId, input.key);
        if (plan === undefined) {
          const [created] = await transaction
            .insert(commercialPlans)
            .values({
              id: input.planId,
              productId: input.productId,
              key: input.key,
              currentVersionNumber: 1,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .onConflictDoNothing({
              target: [commercialPlans.productId, commercialPlans.key],
            })
            .returning({ id: commercialPlans.id });
          if (created !== undefined) {
            await insertPlanVersion(transaction, input, created.id, 1);
            const result = createdResult(created.id);
            await recordCommercialChange(transaction, input, result, {
              eventType: "commercial.plan_version.created",
              targetType: "commercial_plan",
              targetId: `${input.productId}/${input.key}`,
              previousRevisionNumber: null,
            });
            return result;
          }
          plan = await lockPlan(transaction, input.productId, input.key);
        }
        if (plan === undefined)
          throw new Error("commercial_plan_state_conflict");

        const current = await currentPlanVersion(
          transaction,
          plan.id,
          plan.currentVersionNumber,
        );
        if (current === undefined)
          throw new Error("commercial_plan_state_conflict");
        if (!validLifecycleTransition(current.lifecycle, input.lifecycle))
          return rejected("plan_lifecycle_transition_invalid");
        if (planVersionMatches(current, input)) {
          const result = unchangedResult(plan.id, plan.currentVersionNumber);
          await recordCommercialReceipt(transaction, input, result, {
            name: "commercial.plan-version.set",
            targetType: "commercial_plan",
            targetId: `${input.productId}/${input.key}`,
          });
          return result;
        }

        const versionNumber = plan.currentVersionNumber + 1;
        await insertPlanVersion(transaction, input, plan.id, versionNumber);
        await transaction
          .update(commercialPlans)
          .set({ currentVersionNumber: versionNumber, updatedAt: input.now })
          .where(eq(commercialPlans.id, plan.id));
        const result = updatedResult(plan.id, versionNumber);
        await recordCommercialChange(transaction, input, result, {
          eventType: "commercial.plan_version.created",
          targetType: "commercial_plan",
          targetId: `${input.productId}/${input.key}`,
          previousRevisionNumber: plan.currentVersionNumber,
        });
        return result;
      });
    },
  };
}

function toPlanVersion(value: {
  readonly id: string;
  readonly versionNumber: number;
  readonly displayName: string;
  readonly description: string;
  readonly audience: "public" | "private" | "grandfathered";
  readonly pricingModel: "free" | "fixed" | "contract";
  readonly billingInterval: "month" | "year" | null;
  readonly currency: string;
  readonly amountMinor: number;
  readonly taxBehavior: "exclusive" | "inclusive" | "unspecified";
  readonly trialDays: number;
  readonly providerPriceReference: string | null;
  readonly lifecycle: "draft" | "active" | "retired";
  readonly effectiveFrom: Date;
  readonly reason: string;
  readonly createdAt: Date;
}) {
  return {
    ...value,
    effectiveFrom: value.effectiveFrom.toISOString(),
    createdAt: value.createdAt.toISOString(),
  };
}

async function isActiveOperator(transaction: Transaction, actorId: string) {
  const [actor] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, actorId), eq(operators.status, "active")))
    .limit(1);
  return actor !== undefined;
}

async function lockProduct(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  key: string,
) {
  const [product] = await transaction
    .select({
      id: commercialProducts.id,
      currentRevisionNumber: commercialProducts.currentRevisionNumber,
    })
    .from(commercialProducts)
    .where(
      and(
        eq(commercialProducts.environment, environment),
        eq(commercialProducts.key, key),
      ),
    )
    .limit(1)
    .for("update");
  return product;
}

async function currentProductRevision(
  transaction: Transaction,
  productId: string,
  revisionNumber: number,
) {
  const [revision] = await transaction
    .select({
      displayName: commercialProductRevisions.displayName,
      description: commercialProductRevisions.description,
      lifecycle: commercialProductRevisions.lifecycle,
    })
    .from(commercialProductRevisions)
    .where(
      and(
        eq(commercialProductRevisions.productId, productId),
        eq(commercialProductRevisions.revisionNumber, revisionNumber),
      ),
    )
    .limit(1);
  return revision;
}

async function findProductById(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  productId: string,
) {
  const [product] = await transaction
    .select({
      id: commercialProducts.id,
      lifecycle: commercialProductRevisions.lifecycle,
    })
    .from(commercialProducts)
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
        eq(commercialProducts.id, productId),
        eq(commercialProducts.environment, environment),
      ),
    )
    .limit(1)
    .for("update", { of: commercialProducts });
  return product;
}

async function lockPlan(
  transaction: Transaction,
  productId: string,
  key: string,
) {
  const [plan] = await transaction
    .select({
      id: commercialPlans.id,
      currentVersionNumber: commercialPlans.currentVersionNumber,
    })
    .from(commercialPlans)
    .where(
      and(
        eq(commercialPlans.productId, productId),
        eq(commercialPlans.key, key),
      ),
    )
    .limit(1)
    .for("update");
  return plan;
}

async function currentPlanVersion(
  transaction: Transaction,
  planId: string,
  versionNumber: number,
) {
  const [version] = await transaction
    .select({
      displayName: commercialPlanVersions.displayName,
      description: commercialPlanVersions.description,
      audience: commercialPlanVersions.audience,
      pricingModel: commercialPlanVersions.pricingModel,
      billingInterval: commercialPlanVersions.billingInterval,
      currency: commercialPlanVersions.currency,
      amountMinor: commercialPlanVersions.amountMinor,
      taxBehavior: commercialPlanVersions.taxBehavior,
      trialDays: commercialPlanVersions.trialDays,
      providerPriceReference: commercialPlanVersions.providerPriceReference,
      lifecycle: commercialPlanVersions.lifecycle,
      effectiveFrom: commercialPlanVersions.effectiveFrom,
    })
    .from(commercialPlanVersions)
    .where(
      and(
        eq(commercialPlanVersions.planId, planId),
        eq(commercialPlanVersions.versionNumber, versionNumber),
      ),
    )
    .limit(1);
  return version;
}

async function insertProductRevision(
  transaction: Transaction,
  input: Parameters<CommercialCatalogueStore["setProduct"]>[0],
  productId: string,
  revisionNumber: number,
) {
  await transaction.insert(commercialProductRevisions).values({
    id: input.revisionId,
    productId,
    revisionNumber,
    displayName: input.displayName,
    description: input.description,
    lifecycle: input.lifecycle,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

async function insertPlanVersion(
  transaction: Transaction,
  input: Parameters<CommercialCatalogueStore["setPlanVersion"]>[0],
  planId: string,
  versionNumber: number,
) {
  await transaction.insert(commercialPlanVersions).values({
    id: input.versionId,
    planId,
    versionNumber,
    displayName: input.displayName,
    description: input.description,
    audience: input.audience,
    pricingModel: input.pricingModel,
    billingInterval: input.billingInterval,
    currency: input.currency,
    amountMinor: input.amountMinor,
    taxBehavior: input.taxBehavior,
    trialDays: input.trialDays,
    providerPriceReference: input.providerPriceReference,
    lifecycle: input.lifecycle,
    effectiveFrom: input.effectiveFrom,
    createdByOperatorId: input.actorId,
    reason: input.reason,
    correlationId: input.correlationId,
    createdAt: input.now,
  });
}

function validLifecycleTransition(current: string, next: string) {
  return (
    current === next ||
    (current === "draft" && (next === "active" || next === "retired")) ||
    (current === "active" && next === "retired")
  );
}

function planVersionMatches(
  current: NonNullable<Awaited<ReturnType<typeof currentPlanVersion>>>,
  input: Parameters<CommercialCatalogueStore["setPlanVersion"]>[0],
) {
  return (
    current.displayName === input.displayName &&
    current.description === input.description &&
    current.audience === input.audience &&
    current.pricingModel === input.pricingModel &&
    current.billingInterval === input.billingInterval &&
    current.currency === input.currency &&
    current.amountMinor === input.amountMinor &&
    current.taxBehavior === input.taxBehavior &&
    current.trialDays === input.trialDays &&
    current.providerPriceReference === input.providerPriceReference &&
    current.lifecycle === input.lifecycle &&
    current.effectiveFrom.getTime() === input.effectiveFrom.getTime()
  );
}

async function recordCommercialChange(
  transaction: Transaction,
  input:
    | Parameters<CommercialCatalogueStore["setProduct"]>[0]
    | Parameters<CommercialCatalogueStore["setPlanVersion"]>[0],
  result: Exclude<CommercialCatalogueCommandResult, { outcome: "rejected" }>,
  change: {
    readonly eventType: string;
    readonly targetType: "commercial_product" | "commercial_plan";
    readonly targetId: string;
    readonly previousRevisionNumber: number | null;
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: input.actorId,
    eventType: change.eventType,
    targetType: change.targetType,
    targetId: result.id,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: {
      previousRevisionNumber: change.previousRevisionNumber,
      revisionNumber: result.revisionNumber,
    },
    occurredAt: input.now,
  });
  await recordCommercialReceipt(transaction, input, result, {
    name:
      change.targetType === "commercial_product"
        ? "commercial.product.set"
        : "commercial.plan-version.set",
    targetType: change.targetType,
    targetId: change.targetId,
  });
}

async function recordCommercialReceipt(
  transaction: Transaction,
  input:
    | Parameters<CommercialCatalogueStore["setProduct"]>[0]
    | Parameters<CommercialCatalogueStore["setPlanVersion"]>[0],
  result: Exclude<CommercialCatalogueCommandResult, { outcome: "rejected" }>,
  command: {
    readonly name: "commercial.product.set" | "commercial.plan-version.set";
    readonly targetType: "commercial_product" | "commercial_plan";
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

function createdResult(id: string) {
  return { outcome: "created", id, revisionNumber: 1 } as const;
}

function updatedResult(id: string, revisionNumber: number) {
  return { outcome: "updated", id, revisionNumber } as const;
}

function unchangedResult(id: string, revisionNumber: number) {
  return { outcome: "unchanged", id, revisionNumber } as const;
}
