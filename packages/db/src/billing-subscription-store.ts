import {
  BillingProviderError,
  type BillingCommandResult,
  type BillingSubscriptionStore,
} from "@atharvan/commercial";
import type {
  BillingCheckoutRequestEntry,
  BillingSubscriptionRevision,
} from "@atharvan/domain";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  billingCheckoutRequests,
  billingProviderSubscriptionBindings,
  billingSubscriptionObservations,
  billingSubscriptionReconciliationJobs,
  commercialPlans,
  commercialPlanVersions,
  commercialProductRevisions,
  commercialProducts,
  customerWorkspaceProjections,
  operators,
  workspaceBillingSubscriptionRevisions,
  workspaceBillingSubscriptions,
  workspaceEntitlementAssignments,
  workspaceEntitlementSnapshots,
} from "./schema";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const checkoutHistoryLimit = 10;
const subscriptionHistoryLimit = 20;
const observationHistoryLimit = 50;
const leaseMilliseconds = 60_000;
const checkoutPollMilliseconds = 60_000;
const subscriptionPollMilliseconds = 15 * 60_000;

/** PostgreSQL authority for durable Stripe Checkout and immutable subscription snapshots. */
export function createPostgresBillingSubscriptionStore(
  database: Database,
): BillingSubscriptionStore {
  return {
    async getWorkspaceRegistry(input) {
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

      const checkoutRows = await database
        .select({
          id: billingCheckoutRequests.id,
          planVersionId: billingCheckoutRequests.planVersionId,
          planDisplayName: commercialPlanVersions.displayName,
          provider: billingCheckoutRequests.provider,
          state: billingCheckoutRequests.state,
          checkoutUrl: billingCheckoutRequests.checkoutUrl,
          expiresAt: billingCheckoutRequests.expiresAt,
          failures: billingCheckoutRequests.failures,
          lastErrorCode: billingCheckoutRequests.lastErrorCode,
          requestedByOperatorId: billingCheckoutRequests.requestedByOperatorId,
          createdAt: billingCheckoutRequests.createdAt,
          updatedAt: billingCheckoutRequests.updatedAt,
        })
        .from(billingCheckoutRequests)
        .innerJoin(
          commercialPlanVersions,
          eq(commercialPlanVersions.id, billingCheckoutRequests.planVersionId),
        )
        .where(
          and(
            eq(billingCheckoutRequests.environment, input.environment),
            eq(billingCheckoutRequests.workspaceSourceId, input.workspaceId),
          ),
        )
        .orderBy(
          desc(billingCheckoutRequests.createdAt),
          desc(billingCheckoutRequests.id),
        )
        .limit(checkoutHistoryLimit + 1);

      const [subscription] = await database
        .select({
          id: workspaceBillingSubscriptions.id,
          provider: workspaceBillingSubscriptions.provider,
          currentRevisionNumber:
            workspaceBillingSubscriptions.currentRevisionNumber,
        })
        .from(workspaceBillingSubscriptions)
        .where(
          and(
            eq(workspaceBillingSubscriptions.environment, input.environment),
            eq(
              workspaceBillingSubscriptions.workspaceSourceId,
              input.workspaceId,
            ),
          ),
        )
        .limit(1);

      return {
        environment: input.environment,
        provider: "stripe",
        providerConfigured: input.providerConfigured,
        workspaceId: input.workspaceId,
        workspaceName: workspace.name,
        workspaceLifecycle: workspace.lifecycle,
        checkoutRequests: checkoutRows
          .slice(0, checkoutHistoryLimit)
          .map((row) => toCheckoutEntry(row, input.now)),
        checkoutRequestsTruncated: checkoutRows.length > checkoutHistoryLimit,
        subscription: subscription
          ? await readSubscriptionRegistry(database, subscription)
          : null,
      };
    },

    async getCheckoutRequest(input) {
      const [row] = await database
        .select({
          id: billingCheckoutRequests.id,
          planVersionId: billingCheckoutRequests.planVersionId,
          planDisplayName: commercialPlanVersions.displayName,
          provider: billingCheckoutRequests.provider,
          state: billingCheckoutRequests.state,
          checkoutUrl: billingCheckoutRequests.checkoutUrl,
          expiresAt: billingCheckoutRequests.expiresAt,
          failures: billingCheckoutRequests.failures,
          lastErrorCode: billingCheckoutRequests.lastErrorCode,
          requestedByOperatorId: billingCheckoutRequests.requestedByOperatorId,
          createdAt: billingCheckoutRequests.createdAt,
          updatedAt: billingCheckoutRequests.updatedAt,
        })
        .from(billingCheckoutRequests)
        .innerJoin(
          commercialPlanVersions,
          eq(commercialPlanVersions.id, billingCheckoutRequests.planVersionId),
        )
        .where(
          and(
            eq(billingCheckoutRequests.id, input.requestId),
            eq(billingCheckoutRequests.environment, input.environment),
          ),
        )
        .limit(1);
      return row ? toCheckoutEntry(row, input.now) : null;
    },

    createCheckoutRequest(input) {
      return database.transaction(async (transaction) => {
        if (!input.commandId) return rejected("command_id_required");
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const workspace = await lockWorkspace(
          transaction,
          input.environment,
          input.workspaceId,
        );
        if (!workspace) return rejected("workspace_not_found");
        if (workspace.lifecycle !== "active")
          return rejected("workspace_not_active");
        const plan = await lockCheckoutPlan(
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
        if (
          plan.pricingModel !== "fixed" ||
          plan.billingInterval === null ||
          plan.providerPriceReference === null
        )
          return rejected("plan_not_checkout_eligible");
        if (
          !(await workspaceHasPlanEntitlements(
            transaction,
            input.environment,
            input.workspaceId,
            input.planVersionId,
          ))
        )
          return rejected("workspace_plan_assignment_mismatch");
        const currentSubscription = await lockCurrentSubscription(
          transaction,
          input.environment,
          input.workspaceId,
        );
        if (
          currentSubscription &&
          currentSubscription.status !== "canceled" &&
          currentSubscription.status !== "incomplete_expired"
        )
          return rejected("workspace_subscription_active");

        const [created] = await transaction
          .insert(billingCheckoutRequests)
          .values({
            id: input.id,
            environment: input.environment,
            workspaceSourceId: input.workspaceId,
            planVersionId: input.planVersionId,
            requestedByOperatorId: input.actorId,
            commandId: input.commandId,
            provider: "stripe",
            providerIdempotencyKey: input.providerIdempotencyKey,
            state: "pending",
            failures: 0,
            nextAttemptAt: input.now,
            correlationId: input.correlationId,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing()
          .returning({ id: billingCheckoutRequests.id });
        if (!created) return rejected("workspace_checkout_already_open");
        const result = {
          outcome: "created" as const,
          id: created.id,
          state: "pending" as const,
          checkoutUrl: null,
          expiresAt: null,
        };
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          commandId: input.commandId,
          eventType: "billing.subscription_checkout.requested",
          targetType: "billing_checkout_request",
          targetId: created.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            workspaceId: input.workspaceId,
            planVersionId: input.planVersionId,
            provider: "stripe",
          },
          occurredAt: input.now,
        });
        await recordReceipt(transaction, input, result, {
          name: "billing.subscription-checkout.start",
          targetType: "workspace_billing",
          targetId: input.workspaceId,
        });
        return result;
      });
    },

    requestSubscriptionReconciliation(input) {
      return database.transaction(async (transaction) => {
        if (!input.commandId) return rejected("command_id_required");
        if (!(await isActiveOperator(transaction, input.actorId)))
          return rejected("operator_not_active");
        const current = await lockCurrentSubscription(
          transaction,
          input.environment,
          input.workspaceId,
        );
        if (!current) return rejected("workspace_subscription_not_found");
        const [job] = await transaction
          .select()
          .from(billingSubscriptionReconciliationJobs)
          .where(
            eq(
              billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
              current.id,
            ),
          )
          .limit(1)
          .for("update");
        if (!job) throw new Error("billing_reconciliation_job_missing");
        const leaseActive =
          job.leaseToken !== null &&
          job.leaseExpiresAt !== null &&
          job.leaseExpiresAt > input.now;
        if (!leaseActive) {
          await transaction
            .update(billingSubscriptionReconciliationJobs)
            .set({
              nextAttemptAt: input.now,
              failures: 0,
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              updatedAt: input.now,
            })
            .where(
              eq(
                billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
                current.id,
              ),
            );
        }
        const result = {
          outcome: leaseActive ? ("unchanged" as const) : ("updated" as const),
          id: current.id,
        };
        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          commandId: input.commandId,
          eventType: "billing.subscription_reconciliation.requested",
          targetType: "workspace_billing_subscription",
          targetId: current.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: { workspaceId: input.workspaceId, leaseActive },
          occurredAt: input.now,
        });
        await recordReceipt(transaction, input, result, {
          name: "billing.subscription.reconcile",
          targetType: "workspace_billing",
          targetId: input.workspaceId,
        });
        return result;
      });
    },

    claimCheckout(input) {
      return database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            id: billingCheckoutRequests.id,
            state: billingCheckoutRequests.state,
            workspaceId: billingCheckoutRequests.workspaceSourceId,
            planVersionId: billingCheckoutRequests.planVersionId,
            providerPriceReference:
              commercialPlanVersions.providerPriceReference,
            providerIdempotencyKey:
              billingCheckoutRequests.providerIdempotencyKey,
            providerCheckoutSessionId:
              billingCheckoutRequests.providerCheckoutSessionId,
            expiresAt: billingCheckoutRequests.expiresAt,
          })
          .from(billingCheckoutRequests)
          .innerJoin(
            commercialPlanVersions,
            eq(
              commercialPlanVersions.id,
              billingCheckoutRequests.planVersionId,
            ),
          )
          .where(
            and(
              eq(billingCheckoutRequests.environment, input.environment),
              input.requestId
                ? eq(billingCheckoutRequests.id, input.requestId)
                : undefined,
              inArray(billingCheckoutRequests.state, ["pending", "ready"]),
              lte(billingCheckoutRequests.nextAttemptAt, input.now),
              or(
                isNull(billingCheckoutRequests.leaseToken),
                lte(billingCheckoutRequests.leaseExpiresAt, input.now),
              ),
              sql`${billingCheckoutRequests.failures} < 5`,
            ),
          )
          .orderBy(
            asc(billingCheckoutRequests.nextAttemptAt),
            asc(billingCheckoutRequests.id),
          )
          .limit(1)
          .for("update", { of: billingCheckoutRequests, skipLocked: true });
        if (!row) return null;
        if (!row.providerPriceReference)
          throw new Error("billing_plan_provider_reference_missing");
        const leaseExpiresAt = new Date(
          input.now.getTime() + leaseMilliseconds,
        );
        const [claimed] = await transaction
          .update(billingCheckoutRequests)
          .set({
            leaseToken: input.leaseToken,
            leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(eq(billingCheckoutRequests.id, row.id))
          .returning({ id: billingCheckoutRequests.id });
        if (!claimed) return null;
        const current = await lockCurrentSubscription(
          transaction,
          input.environment,
          row.workspaceId,
        );
        return {
          ...row,
          state: row.state as "pending" | "ready",
          leaseToken: input.leaseToken,
          providerPriceReference: row.providerPriceReference,
          providerCustomerId: current?.providerCustomerId ?? null,
        };
      });
    },

    markCheckoutReady(input) {
      return database.transaction(async (transaction) => {
        if (
          input.session.state !== "open" ||
          input.session.url === null ||
          input.session.expiresAt <= input.now ||
          input.session.subscriptionId !== null
        )
          throw new BillingProviderError(
            "stripe_checkout_creation_invalid",
            false,
            input.session.requestId,
          );
        const row = await lockCheckoutLease(transaction, input);
        if (row.state !== "pending")
          throw new Error("billing_checkout_state_conflict");
        const [updated] = await transaction
          .update(billingCheckoutRequests)
          .set({
            state: "ready",
            providerCheckoutSessionId: input.session.id,
            checkoutUrl: input.session.url,
            expiresAt: input.session.expiresAt,
            failures: 0,
            nextAttemptAt: new Date(
              Math.min(
                input.session.expiresAt.getTime(),
                input.now.getTime() + checkoutPollMilliseconds,
              ),
            ),
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(billingCheckoutRequests.id, input.requestId),
              eq(billingCheckoutRequests.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: billingCheckoutRequests.id });
        if (!updated) throw new Error("billing_checkout_lease_lost");
        await recordProviderAudit(transaction, row, {
          eventType: "billing.subscription_checkout.ready",
          evidence: {
            providerCheckoutSessionId: input.session.id,
            expiresAt: input.session.expiresAt.toISOString(),
            providerRequestId: input.session.requestId,
          },
          now: input.now,
        });
      });
    },

    deferCheckout(input) {
      return database.transaction(async (transaction) => {
        const row = await lockCheckoutLease(transaction, input);
        if (row.state !== "ready")
          throw new Error("billing_checkout_state_conflict");
        if (input.expiresAt <= input.now)
          throw new BillingProviderError("stripe_checkout_expired", false);
        const [updated] = await transaction
          .update(billingCheckoutRequests)
          .set({
            expiresAt: input.expiresAt,
            failures: 0,
            nextAttemptAt: new Date(
              Math.min(
                input.expiresAt.getTime(),
                input.now.getTime() + checkoutPollMilliseconds,
              ),
            ),
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(billingCheckoutRequests.id, input.requestId),
              eq(billingCheckoutRequests.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: billingCheckoutRequests.id });
        if (!updated) throw new Error("billing_checkout_lease_lost");
      });
    },

    expireCheckout(input) {
      return settleCheckoutTerminal(database, input, "expired");
    },

    failCheckout(input) {
      return database.transaction(async (transaction) => {
        const row = await lockCheckoutLease(transaction, input);
        const failures = Math.min(5, row.failures + 1);
        const terminal = !input.retryable || failures >= 5;
        const [updated] = await transaction
          .update(billingCheckoutRequests)
          .set({
            state: terminal ? "failed" : row.state,
            checkoutUrl: terminal ? null : row.checkoutUrl,
            failures,
            nextAttemptAt: new Date(
              input.now.getTime() + Math.min(300, 2 ** failures) * 1_000,
            ),
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(billingCheckoutRequests.id, input.requestId),
              eq(billingCheckoutRequests.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: billingCheckoutRequests.id });
        if (!updated) throw new Error("billing_checkout_lease_lost");
        await recordProviderAudit(transaction, row, {
          eventType: terminal
            ? "billing.subscription_checkout.failed"
            : "billing.subscription_checkout.retry_scheduled",
          evidence: {
            errorCode: input.errorCode,
            failures,
            providerRequestId: input.providerRequestId,
          },
          now: input.now,
        });
      });
    },

    completeCheckout(input) {
      return database.transaction(async (transaction) => {
        const checkout = await lockCheckoutLease(transaction, input);
        if (checkout.state !== "ready")
          throw new Error("billing_checkout_state_conflict");
        const contract = await readCheckoutContract(
          transaction,
          input.environment,
          input.requestId,
        );
        if (!contract) throw new Error("billing_checkout_contract_missing");
        validateCompletedSubscription(input, contract);
        const workspace = await lockWorkspace(
          transaction,
          input.environment,
          contract.workspaceId,
        );
        if (workspace?.lifecycle !== "active")
          throw new BillingProviderError(
            "workspace_not_active",
            false,
            input.subscription.requestId,
          );
        if (
          !(await workspaceHasPlanEntitlements(
            transaction,
            input.environment,
            contract.workspaceId,
            contract.planVersionId,
          ))
        )
          throw new BillingProviderError(
            "workspace_plan_assignment_mismatch",
            false,
            input.subscription.requestId,
          );

        let current = await lockCurrentSubscription(
          transaction,
          input.environment,
          contract.workspaceId,
        );
        const created = current === undefined;
        if (
          current &&
          current.status !== "canceled" &&
          current.status !== "incomplete_expired"
        )
          throw new BillingProviderError(
            "workspace_subscription_active",
            false,
            input.subscription.requestId,
          );
        const workspaceSubscriptionId = current?.id ?? input.subscriptionId;
        const revisionNumber = current ? current.revisionNumber + 1 : 1;
        if (!current) {
          await transaction.insert(workspaceBillingSubscriptions).values({
            id: workspaceSubscriptionId,
            environment: input.environment,
            workspaceSourceId: contract.workspaceId,
            provider: "stripe",
            currentProviderBindingId: input.providerBindingId,
            currentRevisionNumber: 1,
            createdAt: input.now,
            updatedAt: input.now,
          });
        }
        await transaction.insert(billingProviderSubscriptionBindings).values({
          id: input.providerBindingId,
          workspaceSubscriptionId,
          checkoutRequestId: input.requestId,
          provider: "stripe",
          providerSubscriptionId: input.subscription.id,
          createdAt: input.now,
        });
        await insertSubscriptionRevision(transaction, {
          id: input.revisionId,
          workspaceSubscriptionId,
          revisionNumber,
          providerBindingId: input.providerBindingId,
          planVersionId: contract.planVersionId,
          snapshot: input.subscription,
          providerDataSha256: input.providerDataSha256,
          observedAt: input.now,
          correlationId: input.correlationId,
        });
        if (current) {
          await transaction
            .update(workspaceBillingSubscriptions)
            .set({
              currentProviderBindingId: input.providerBindingId,
              currentRevisionNumber: revisionNumber,
              updatedAt: input.now,
            })
            .where(eq(workspaceBillingSubscriptions.id, current.id));
        }
        await transaction
          .insert(billingSubscriptionReconciliationJobs)
          .values({
            workspaceSubscriptionId,
            nextAttemptAt: new Date(
              input.now.getTime() + subscriptionPollMilliseconds,
            ),
            failures: 0,
            lastReconciledAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target:
              billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
            set: {
              nextAttemptAt: new Date(
                input.now.getTime() + subscriptionPollMilliseconds,
              ),
              failures: 0,
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              lastReconciledAt: input.now,
              updatedAt: input.now,
            },
          });
        await insertObservation(transaction, {
          id: input.observationId,
          workspaceSubscriptionId,
          revisionNumber,
          state: "matched",
          reasonCode: null,
          providerRequestId: input.subscription.requestId,
          observedAt: input.now,
          correlationId: crypto.randomUUID(),
        });
        const [updatedCheckout] = await transaction
          .update(billingCheckoutRequests)
          .set({
            state: "completed",
            providerCustomerId: input.subscription.customerId,
            providerSubscriptionId: input.subscription.id,
            checkoutUrl: null,
            failures: 0,
            nextAttemptAt: input.now,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(billingCheckoutRequests.id, input.requestId),
              eq(billingCheckoutRequests.leaseToken, input.leaseToken),
            ),
          )
          .returning({ id: billingCheckoutRequests.id });
        if (!updatedCheckout) throw new Error("billing_checkout_lease_lost");
        await recordProviderAudit(transaction, checkout, {
          eventType: created
            ? "billing.subscription.created"
            : "billing.subscription.replaced",
          evidence: {
            workspaceSubscriptionId,
            revisionNumber,
            planVersionId: contract.planVersionId,
            providerSubscriptionId: input.subscription.id,
            status: input.subscription.status,
          },
          now: input.now,
        });
      });
    },

    claimSubscription(input) {
      return database.transaction(async (transaction) => {
        const [row] = await transaction
          .select({
            id: workspaceBillingSubscriptions.id,
            workspaceId: workspaceBillingSubscriptions.workspaceSourceId,
            revisionNumber: workspaceBillingSubscriptions.currentRevisionNumber,
            providerBindingId:
              workspaceBillingSubscriptions.currentProviderBindingId,
            providerSubscriptionId:
              billingProviderSubscriptionBindings.providerSubscriptionId,
            checkoutRequestId:
              billingProviderSubscriptionBindings.checkoutRequestId,
            providerCustomerId:
              workspaceBillingSubscriptionRevisions.providerCustomerId,
            planVersionId: workspaceBillingSubscriptionRevisions.planVersionId,
            providerPriceReference:
              commercialPlanVersions.providerPriceReference,
          })
          .from(billingSubscriptionReconciliationJobs)
          .innerJoin(
            workspaceBillingSubscriptions,
            eq(
              workspaceBillingSubscriptions.id,
              billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
            ),
          )
          .innerJoin(
            workspaceBillingSubscriptionRevisions,
            and(
              eq(
                workspaceBillingSubscriptionRevisions.workspaceSubscriptionId,
                workspaceBillingSubscriptions.id,
              ),
              eq(
                workspaceBillingSubscriptionRevisions.revisionNumber,
                workspaceBillingSubscriptions.currentRevisionNumber,
              ),
            ),
          )
          .innerJoin(
            billingProviderSubscriptionBindings,
            eq(
              billingProviderSubscriptionBindings.id,
              workspaceBillingSubscriptions.currentProviderBindingId,
            ),
          )
          .innerJoin(
            commercialPlanVersions,
            eq(
              commercialPlanVersions.id,
              workspaceBillingSubscriptionRevisions.planVersionId,
            ),
          )
          .where(
            and(
              eq(workspaceBillingSubscriptions.environment, input.environment),
              input.subscriptionId
                ? eq(workspaceBillingSubscriptions.id, input.subscriptionId)
                : undefined,
              lte(
                billingSubscriptionReconciliationJobs.nextAttemptAt,
                input.now,
              ),
              or(
                isNull(billingSubscriptionReconciliationJobs.leaseToken),
                lte(
                  billingSubscriptionReconciliationJobs.leaseExpiresAt,
                  input.now,
                ),
              ),
            ),
          )
          .orderBy(
            asc(billingSubscriptionReconciliationJobs.nextAttemptAt),
            asc(workspaceBillingSubscriptions.id),
          )
          .limit(1)
          .for("update", {
            of: billingSubscriptionReconciliationJobs,
            skipLocked: true,
          });
        if (!row) return null;
        if (!row.providerPriceReference)
          throw new Error("billing_plan_provider_reference_missing");
        const [claimed] = await transaction
          .update(billingSubscriptionReconciliationJobs)
          .set({
            leaseToken: input.leaseToken,
            leaseExpiresAt: new Date(input.now.getTime() + leaseMilliseconds),
            updatedAt: input.now,
          })
          .where(
            eq(
              billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
              row.id,
            ),
          )
          .returning({
            id: billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
          });
        if (!claimed) return null;
        return {
          ...row,
          leaseToken: input.leaseToken,
          providerPriceReference: row.providerPriceReference,
        };
      });
    },

    applySubscriptionSnapshot(input) {
      return database.transaction(async (transaction) => {
        const current = await lockSubscriptionForReconciliation(
          transaction,
          input,
        );
        const drift = subscriptionDriftReason(
          input.environment,
          current,
          input.snapshot,
        );
        if (drift) {
          await insertObservation(transaction, {
            id: input.observationId,
            workspaceSubscriptionId: current.id,
            revisionNumber: current.revisionNumber,
            state: "drift",
            reasonCode: drift,
            providerRequestId: input.snapshot.requestId,
            observedAt: input.now,
            correlationId: input.correlationId,
          });
          await releaseSubscriptionJob(transaction, current.id, {
            failures: 0,
            nextAttemptAt: new Date(input.now.getTime() + 5 * 60_000),
            lastErrorCode: drift,
            lastReconciledAt: null,
            now: input.now,
          });
          await recordSubscriptionAudit(transaction, current, {
            eventType: "billing.subscription.drift_detected",
            evidence: { reasonCode: drift },
            now: input.now,
          });
          return;
        }
        let revisionNumber = current.revisionNumber;
        if (current.providerDataSha256 !== input.providerDataSha256) {
          revisionNumber += 1;
          await insertSubscriptionRevision(transaction, {
            id: input.revisionId,
            workspaceSubscriptionId: current.id,
            revisionNumber,
            providerBindingId: current.providerBindingId,
            planVersionId: current.planVersionId,
            snapshot: input.snapshot,
            providerDataSha256: input.providerDataSha256,
            observedAt: input.now,
            correlationId: input.correlationId,
          });
          await transaction
            .update(workspaceBillingSubscriptions)
            .set({
              currentRevisionNumber: revisionNumber,
              updatedAt: input.now,
            })
            .where(eq(workspaceBillingSubscriptions.id, current.id));
        }
        await insertObservation(transaction, {
          id: input.observationId,
          workspaceSubscriptionId: current.id,
          revisionNumber,
          state: "matched",
          reasonCode: null,
          providerRequestId: input.snapshot.requestId,
          observedAt: input.now,
          correlationId:
            current.providerDataSha256 === input.providerDataSha256
              ? input.correlationId
              : crypto.randomUUID(),
        });
        await releaseSubscriptionJob(transaction, current.id, {
          failures: 0,
          nextAttemptAt: new Date(
            input.now.getTime() + subscriptionPollMilliseconds,
          ),
          lastErrorCode: null,
          lastReconciledAt: input.now,
          now: input.now,
        });
        await recordSubscriptionAudit(transaction, current, {
          eventType:
            revisionNumber === current.revisionNumber
              ? "billing.subscription.reconciled"
              : "billing.subscription.changed",
          evidence: {
            revisionNumber,
            status: input.snapshot.status,
            changed: revisionNumber !== current.revisionNumber,
          },
          now: input.now,
        });
      });
    },

    failSubscriptionReconciliation(input) {
      return database.transaction(async (transaction) => {
        const current = await lockSubscriptionForReconciliation(
          transaction,
          input,
        );
        const failures = Math.min(5, current.failures + 1);
        await insertObservation(transaction, {
          id: input.observationId,
          workspaceSubscriptionId: current.id,
          revisionNumber: current.revisionNumber,
          state: "failed",
          reasonCode: input.errorCode,
          providerRequestId: input.providerRequestId,
          observedAt: input.now,
          correlationId: input.correlationId,
        });
        await releaseSubscriptionJob(transaction, current.id, {
          failures,
          nextAttemptAt: new Date(
            input.now.getTime() +
              (input.retryable ? Math.min(900, 2 ** failures * 15) : 3_600) *
                1_000,
          ),
          lastErrorCode: input.errorCode,
          lastReconciledAt: null,
          now: input.now,
        });
        await recordSubscriptionAudit(transaction, current, {
          eventType: "billing.subscription.reconciliation_failed",
          evidence: {
            errorCode: input.errorCode,
            failures,
            providerRequestId: input.providerRequestId,
          },
          now: input.now,
        });
      });
    },
  };
}

async function readSubscriptionRegistry(
  database: Database,
  subscription: {
    readonly id: string;
    readonly provider: string;
    readonly currentRevisionNumber: number;
  },
) {
  const [revisionRows, observationRows, jobs] = await Promise.all([
    readSubscriptionRevisions(database, subscription.id),
    database
      .select()
      .from(billingSubscriptionObservations)
      .where(
        eq(
          billingSubscriptionObservations.workspaceSubscriptionId,
          subscription.id,
        ),
      )
      .orderBy(
        desc(billingSubscriptionObservations.observedAt),
        desc(billingSubscriptionObservations.id),
      )
      .limit(observationHistoryLimit + 1),
    database
      .select()
      .from(billingSubscriptionReconciliationJobs)
      .where(
        eq(
          billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
          subscription.id,
        ),
      )
      .limit(1),
  ]);
  const revisions = revisionRows
    .slice(0, subscriptionHistoryLimit)
    .map(toSubscriptionRevision);
  const current = revisions.find(
    (item) => item.revisionNumber === subscription.currentRevisionNumber,
  );
  if (!current)
    throw new Error("billing_subscription_current_revision_missing");
  const observations = observationRows
    .slice(0, observationHistoryLimit)
    .map((row) => ({
      id: row.id,
      subscriptionRevisionNumber: row.subscriptionRevisionNumber,
      state: row.state,
      reasonCode: row.reasonCode,
      providerRequestId: row.providerRequestId,
      observedAt: row.observedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  const latest = observations[0];
  const job = jobs[0];
  return {
    id: subscription.id,
    provider: "stripe" as const,
    current,
    history: revisions,
    historyTruncated: revisionRows.length > subscriptionHistoryLimit,
    reconciliationState:
      latest && latest.subscriptionRevisionNumber === current.revisionNumber
        ? latest.state
        : ("pending" as const),
    reconciliationReasonCode:
      latest && latest.subscriptionRevisionNumber === current.revisionNumber
        ? latest.reasonCode
        : null,
    lastReconciledAt: job?.lastReconciledAt?.toISOString() ?? null,
    nextReconciliationAt: job?.nextAttemptAt.toISOString() ?? null,
    observations,
    observationsTruncated: observationRows.length > observationHistoryLimit,
  };
}

async function readSubscriptionRevisions(
  database: Database,
  subscriptionId: string,
) {
  return database
    .select({
      id: workspaceBillingSubscriptionRevisions.id,
      revisionNumber: workspaceBillingSubscriptionRevisions.revisionNumber,
      planVersionId: workspaceBillingSubscriptionRevisions.planVersionId,
      planDisplayName: commercialPlanVersions.displayName,
      providerSubscriptionId:
        billingProviderSubscriptionBindings.providerSubscriptionId,
      checkoutRequestId: billingProviderSubscriptionBindings.checkoutRequestId,
      providerCustomerId:
        workspaceBillingSubscriptionRevisions.providerCustomerId,
      status: workspaceBillingSubscriptionRevisions.status,
      quantity: workspaceBillingSubscriptionRevisions.quantity,
      cancelAtPeriodEnd:
        workspaceBillingSubscriptionRevisions.cancelAtPeriodEnd,
      currentPeriodStart:
        workspaceBillingSubscriptionRevisions.currentPeriodStart,
      currentPeriodEnd: workspaceBillingSubscriptionRevisions.currentPeriodEnd,
      trialEnd: workspaceBillingSubscriptionRevisions.trialEnd,
      providerCreatedAt:
        workspaceBillingSubscriptionRevisions.providerCreatedAt,
      observedAt: workspaceBillingSubscriptionRevisions.observedAt,
    })
    .from(workspaceBillingSubscriptionRevisions)
    .innerJoin(
      billingProviderSubscriptionBindings,
      eq(
        billingProviderSubscriptionBindings.id,
        workspaceBillingSubscriptionRevisions.providerBindingId,
      ),
    )
    .innerJoin(
      commercialPlanVersions,
      eq(
        commercialPlanVersions.id,
        workspaceBillingSubscriptionRevisions.planVersionId,
      ),
    )
    .where(
      eq(
        workspaceBillingSubscriptionRevisions.workspaceSubscriptionId,
        subscriptionId,
      ),
    )
    .orderBy(desc(workspaceBillingSubscriptionRevisions.revisionNumber))
    .limit(subscriptionHistoryLimit + 1);
}

function toSubscriptionRevision(row: {
  readonly id: string;
  readonly revisionNumber: number;
  readonly planVersionId: string;
  readonly planDisplayName: string;
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly status: BillingSubscriptionRevision["status"];
  readonly quantity: number;
  readonly cancelAtPeriodEnd: boolean;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly trialEnd: Date | null;
  readonly providerCreatedAt: Date;
  readonly observedAt: Date;
}): BillingSubscriptionRevision {
  return {
    ...row,
    currentPeriodStart: row.currentPeriodStart.toISOString(),
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    trialEnd: row.trialEnd?.toISOString() ?? null,
    providerCreatedAt: row.providerCreatedAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
  };
}

function toCheckoutEntry(
  row: {
    readonly id: string;
    readonly planVersionId: string;
    readonly planDisplayName: string;
    readonly provider: string;
    readonly state: BillingCheckoutRequestEntry["state"];
    readonly checkoutUrl: string | null;
    readonly expiresAt: Date | null;
    readonly failures: number;
    readonly lastErrorCode: string | null;
    readonly requestedByOperatorId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
  now: Date,
): BillingCheckoutRequestEntry {
  const expired =
    row.state === "ready" && row.expiresAt !== null && row.expiresAt <= now;
  return {
    id: row.id,
    planVersionId: row.planVersionId,
    planDisplayName: row.planDisplayName,
    provider: "stripe",
    state: expired ? "expired" : row.state,
    checkoutUrl: expired || row.state !== "ready" ? null : row.checkoutUrl,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failures: row.failures,
    lastErrorCode: row.lastErrorCode,
    requestedByOperatorId: row.requestedByOperatorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function lockCheckoutPlan(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  planVersionId: string,
) {
  const [plan] = await transaction
    .select({
      planLifecycle: commercialPlanVersions.lifecycle,
      productLifecycle: commercialProductRevisions.lifecycle,
      pricingModel: commercialPlanVersions.pricingModel,
      billingInterval: commercialPlanVersions.billingInterval,
      providerPriceReference: commercialPlanVersions.providerPriceReference,
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

async function workspaceHasPlanEntitlements(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  workspaceId: string,
  planVersionId: string,
) {
  const [row] = await transaction
    .select({ id: workspaceEntitlementAssignments.id })
    .from(workspaceEntitlementAssignments)
    .innerJoin(
      workspaceEntitlementSnapshots,
      and(
        eq(
          workspaceEntitlementSnapshots.assignmentId,
          workspaceEntitlementAssignments.id,
        ),
        eq(
          workspaceEntitlementSnapshots.revisionNumber,
          workspaceEntitlementAssignments.currentRevisionNumber,
        ),
      ),
    )
    .where(
      and(
        eq(workspaceEntitlementAssignments.environment, environment),
        eq(workspaceEntitlementAssignments.workspaceSourceId, workspaceId),
        eq(workspaceEntitlementSnapshots.planVersionId, planVersionId),
      ),
    )
    .limit(1)
    .for("share", { of: workspaceEntitlementAssignments });
  return row !== undefined;
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

async function lockCurrentSubscription(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  workspaceId: string,
) {
  const [current] = await transaction
    .select({
      id: workspaceBillingSubscriptions.id,
      revisionNumber: workspaceBillingSubscriptions.currentRevisionNumber,
      providerBindingId: workspaceBillingSubscriptions.currentProviderBindingId,
      status: workspaceBillingSubscriptionRevisions.status,
      providerCustomerId:
        workspaceBillingSubscriptionRevisions.providerCustomerId,
    })
    .from(workspaceBillingSubscriptions)
    .innerJoin(
      workspaceBillingSubscriptionRevisions,
      and(
        eq(
          workspaceBillingSubscriptionRevisions.workspaceSubscriptionId,
          workspaceBillingSubscriptions.id,
        ),
        eq(
          workspaceBillingSubscriptionRevisions.revisionNumber,
          workspaceBillingSubscriptions.currentRevisionNumber,
        ),
      ),
    )
    .where(
      and(
        eq(workspaceBillingSubscriptions.environment, environment),
        eq(workspaceBillingSubscriptions.workspaceSourceId, workspaceId),
      ),
    )
    .limit(1)
    .for("update", { of: workspaceBillingSubscriptions });
  return current;
}

async function lockCheckoutLease(
  transaction: Transaction,
  input: {
    readonly environment: "development" | "production" | "test";
    readonly requestId: string;
    readonly leaseToken: string;
    readonly now: Date;
  },
) {
  const [row] = await transaction
    .select()
    .from(billingCheckoutRequests)
    .where(
      and(
        eq(billingCheckoutRequests.id, input.requestId),
        eq(billingCheckoutRequests.environment, input.environment),
        eq(billingCheckoutRequests.leaseToken, input.leaseToken),
        sql`${billingCheckoutRequests.leaseExpiresAt} > ${input.now}`,
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new Error("billing_checkout_lease_lost");
  return row;
}

async function settleCheckoutTerminal(
  database: Database,
  input: {
    readonly environment: "development" | "production" | "test";
    readonly requestId: string;
    readonly leaseToken: string;
    readonly now: Date;
  },
  state: "expired",
) {
  return database.transaction(async (transaction) => {
    const row = await lockCheckoutLease(transaction, input);
    if (row.state !== "ready")
      throw new Error("billing_checkout_state_conflict");
    const [updated] = await transaction
      .update(billingCheckoutRequests)
      .set({
        state,
        checkoutUrl: null,
        nextAttemptAt: input.now,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(billingCheckoutRequests.id, input.requestId),
          eq(billingCheckoutRequests.leaseToken, input.leaseToken),
        ),
      )
      .returning({ id: billingCheckoutRequests.id });
    if (!updated) throw new Error("billing_checkout_lease_lost");
    await recordProviderAudit(transaction, row, {
      eventType: "billing.subscription_checkout.expired",
      evidence: {},
      now: input.now,
    });
  });
}

async function readCheckoutContract(
  transaction: Transaction,
  environment: "development" | "production" | "test",
  requestId: string,
) {
  const [row] = await transaction
    .select({
      workspaceId: billingCheckoutRequests.workspaceSourceId,
      planVersionId: billingCheckoutRequests.planVersionId,
      providerCheckoutSessionId:
        billingCheckoutRequests.providerCheckoutSessionId,
      providerPriceReference: commercialPlanVersions.providerPriceReference,
    })
    .from(billingCheckoutRequests)
    .innerJoin(
      commercialPlanVersions,
      eq(commercialPlanVersions.id, billingCheckoutRequests.planVersionId),
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
        eq(billingCheckoutRequests.id, requestId),
        eq(billingCheckoutRequests.environment, environment),
        eq(commercialProducts.environment, environment),
      ),
    )
    .limit(1);
  return row;
}

function validateCompletedSubscription(
  input: Parameters<BillingSubscriptionStore["completeCheckout"]>[0],
  contract: NonNullable<Awaited<ReturnType<typeof readCheckoutContract>>>,
) {
  const expectedLivemode = input.environment === "production";
  if (
    input.session.state !== "complete" ||
    input.session.id !== contract.providerCheckoutSessionId ||
    input.session.subscriptionId !== input.subscription.id ||
    input.session.customerId !== input.subscription.customerId ||
    input.subscription.workspaceId !== contract.workspaceId ||
    input.subscription.planVersionId !== contract.planVersionId ||
    input.subscription.checkoutRequestId !== input.requestId ||
    input.subscription.priceId !== contract.providerPriceReference ||
    input.subscription.livemode !== expectedLivemode
  )
    throw new BillingProviderError(
      "stripe_subscription_contract_drift",
      false,
      input.subscription.requestId,
    );
}

async function insertSubscriptionRevision(
  transaction: Transaction,
  input: {
    readonly id: string;
    readonly workspaceSubscriptionId: string;
    readonly revisionNumber: number;
    readonly providerBindingId: string;
    readonly planVersionId: string;
    readonly snapshot: Parameters<
      BillingSubscriptionStore["applySubscriptionSnapshot"]
    >[0]["snapshot"];
    readonly providerDataSha256: string;
    readonly observedAt: Date;
    readonly correlationId: string;
  },
) {
  await transaction.insert(workspaceBillingSubscriptionRevisions).values({
    id: input.id,
    workspaceSubscriptionId: input.workspaceSubscriptionId,
    revisionNumber: input.revisionNumber,
    providerBindingId: input.providerBindingId,
    planVersionId: input.planVersionId,
    providerCustomerId: input.snapshot.customerId,
    status: input.snapshot.status,
    quantity: input.snapshot.quantity,
    cancelAtPeriodEnd: input.snapshot.cancelAtPeriodEnd,
    currentPeriodStart: input.snapshot.currentPeriodStart,
    currentPeriodEnd: input.snapshot.currentPeriodEnd,
    trialEnd: input.snapshot.trialEnd,
    providerCreatedAt: input.snapshot.createdAt,
    providerDataSha256: input.providerDataSha256,
    observedAt: input.observedAt,
    correlationId: input.correlationId,
  });
}

async function lockSubscriptionForReconciliation(
  transaction: Transaction,
  input: {
    readonly environment: "development" | "production" | "test";
    readonly subscriptionId: string;
    readonly leaseToken: string;
    readonly now: Date;
  },
) {
  const [row] = await transaction
    .select({
      id: workspaceBillingSubscriptions.id,
      workspaceId: workspaceBillingSubscriptions.workspaceSourceId,
      revisionNumber: workspaceBillingSubscriptions.currentRevisionNumber,
      providerBindingId: workspaceBillingSubscriptions.currentProviderBindingId,
      providerSubscriptionId:
        billingProviderSubscriptionBindings.providerSubscriptionId,
      checkoutRequestId: billingProviderSubscriptionBindings.checkoutRequestId,
      providerCustomerId:
        workspaceBillingSubscriptionRevisions.providerCustomerId,
      providerDataSha256:
        workspaceBillingSubscriptionRevisions.providerDataSha256,
      planVersionId: workspaceBillingSubscriptionRevisions.planVersionId,
      providerPriceReference: commercialPlanVersions.providerPriceReference,
      failures: billingSubscriptionReconciliationJobs.failures,
    })
    .from(workspaceBillingSubscriptions)
    .innerJoin(
      workspaceBillingSubscriptionRevisions,
      and(
        eq(
          workspaceBillingSubscriptionRevisions.workspaceSubscriptionId,
          workspaceBillingSubscriptions.id,
        ),
        eq(
          workspaceBillingSubscriptionRevisions.revisionNumber,
          workspaceBillingSubscriptions.currentRevisionNumber,
        ),
      ),
    )
    .innerJoin(
      billingProviderSubscriptionBindings,
      eq(
        billingProviderSubscriptionBindings.id,
        workspaceBillingSubscriptions.currentProviderBindingId,
      ),
    )
    .innerJoin(
      commercialPlanVersions,
      eq(
        commercialPlanVersions.id,
        workspaceBillingSubscriptionRevisions.planVersionId,
      ),
    )
    .innerJoin(
      billingSubscriptionReconciliationJobs,
      eq(
        billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
        workspaceBillingSubscriptions.id,
      ),
    )
    .where(
      and(
        eq(workspaceBillingSubscriptions.id, input.subscriptionId),
        eq(workspaceBillingSubscriptions.environment, input.environment),
        eq(billingSubscriptionReconciliationJobs.leaseToken, input.leaseToken),
        sql`${billingSubscriptionReconciliationJobs.leaseExpiresAt} > ${input.now}`,
      ),
    )
    .limit(1)
    .for("update", { of: workspaceBillingSubscriptions });
  if (!row) throw new Error("billing_subscription_lease_lost");
  return row;
}

function subscriptionDriftReason(
  environment: "development" | "production" | "test",
  current: Awaited<ReturnType<typeof lockSubscriptionForReconciliation>>,
  snapshot: Parameters<
    BillingSubscriptionStore["applySubscriptionSnapshot"]
  >[0]["snapshot"],
) {
  if (snapshot.id !== current.providerSubscriptionId)
    return "provider_subscription_mismatch";
  if (snapshot.customerId !== current.providerCustomerId)
    return "provider_customer_mismatch";
  if (snapshot.workspaceId !== current.workspaceId)
    return "provider_workspace_mismatch";
  if (snapshot.planVersionId !== current.planVersionId)
    return "provider_plan_metadata_mismatch";
  if (snapshot.checkoutRequestId !== current.checkoutRequestId)
    return "provider_checkout_metadata_mismatch";
  if (snapshot.priceId !== current.providerPriceReference)
    return "provider_price_mismatch";
  if (snapshot.livemode !== (environment === "production"))
    return "provider_environment_mismatch";
  return null;
}

async function releaseSubscriptionJob(
  transaction: Transaction,
  subscriptionId: string,
  input: {
    readonly failures: number;
    readonly nextAttemptAt: Date;
    readonly lastErrorCode: string | null;
    readonly lastReconciledAt: Date | null;
    readonly now: Date;
  },
) {
  const [updated] = await transaction
    .update(billingSubscriptionReconciliationJobs)
    .set({
      failures: input.failures,
      nextAttemptAt: input.nextAttemptAt,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: input.lastErrorCode,
      ...(input.lastReconciledAt === null
        ? {}
        : { lastReconciledAt: input.lastReconciledAt }),
      updatedAt: input.now,
    })
    .where(
      eq(
        billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
        subscriptionId,
      ),
    )
    .returning({
      id: billingSubscriptionReconciliationJobs.workspaceSubscriptionId,
    });
  if (!updated) throw new Error("billing_subscription_job_missing");
}

async function insertObservation(
  transaction: Transaction,
  input: {
    readonly id: string;
    readonly workspaceSubscriptionId: string;
    readonly revisionNumber: number;
    readonly state: "matched" | "drift" | "failed";
    readonly reasonCode: string | null;
    readonly providerRequestId: string | null;
    readonly observedAt: Date;
    readonly correlationId: string;
  },
) {
  await transaction.insert(billingSubscriptionObservations).values({
    id: input.id,
    workspaceSubscriptionId: input.workspaceSubscriptionId,
    subscriptionRevisionNumber: input.revisionNumber,
    state: input.state,
    reasonCode: input.reasonCode,
    providerRequestId: input.providerRequestId,
    observedAt: input.observedAt,
    correlationId: input.correlationId,
    createdAt: input.observedAt,
  });
}

async function recordProviderAudit(
  transaction: Transaction,
  checkout: {
    readonly id: string;
    readonly workspaceSourceId: string;
    readonly planVersionId: string;
  },
  input: {
    readonly eventType: string;
    readonly evidence: Record<string, unknown>;
    readonly now: Date;
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: null,
    eventType: input.eventType,
    targetType: "billing_checkout_request",
    targetId: checkout.id,
    correlationId: crypto.randomUUID(),
    reason: "Scheduled Stripe subscription reconciliation.",
    evidence: {
      workspaceId: checkout.workspaceSourceId,
      planVersionId: checkout.planVersionId,
      ...input.evidence,
    },
    occurredAt: input.now,
  });
}

async function recordSubscriptionAudit(
  transaction: Transaction,
  subscription: {
    readonly id: string;
    readonly workspaceId: string;
    readonly planVersionId: string;
  },
  input: {
    readonly eventType: string;
    readonly evidence: Record<string, unknown>;
    readonly now: Date;
  },
) {
  await transaction.insert(auditEvents).values({
    actorId: null,
    eventType: input.eventType,
    targetType: "workspace_billing_subscription",
    targetId: subscription.id,
    correlationId: crypto.randomUUID(),
    reason: "Scheduled Stripe subscription reconciliation.",
    evidence: {
      workspaceId: subscription.workspaceId,
      planVersionId: subscription.planVersionId,
      ...input.evidence,
    },
    occurredAt: input.now,
  });
}

async function isActiveOperator(transaction: Transaction, operatorId: string) {
  const [operator] = await transaction
    .select({ id: operators.id })
    .from(operators)
    .where(and(eq(operators.id, operatorId), eq(operators.status, "active")))
    .limit(1)
    .for("share");
  return operator !== undefined;
}

function rejected(reason: string): BillingCommandResult {
  return { outcome: "rejected", reason };
}

async function recordReceipt(
  transaction: Transaction,
  input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly environment: "development" | "production" | "test";
    readonly correlationId: string;
    readonly reason: string;
    readonly now: Date;
  },
  result: Exclude<BillingCommandResult, { readonly outcome: "rejected" }>,
  command: {
    readonly name: string;
    readonly targetType: string;
    readonly targetId: string;
  },
) {
  if (!input.commandId) return;
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
