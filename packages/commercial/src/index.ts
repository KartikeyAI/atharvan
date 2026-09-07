import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type CommercialBillingInterval,
  type CommercialCatalogue,
  type CommercialLifecycle,
  type CommercialPlanAudience,
  type CommercialPricingModel,
  type CommercialTaxBehavior,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";

const lifecycles = new Set<CommercialLifecycle>(["draft", "active", "retired"]);
const audiences = new Set<CommercialPlanAudience>([
  "public",
  "private",
  "grandfathered",
]);
const pricingModels = new Set<CommercialPricingModel>([
  "free",
  "fixed",
  "contract",
]);
const taxBehaviors = new Set<CommercialTaxBehavior>([
  "exclusive",
  "inclusive",
  "unspecified",
]);
const billingIntervals = new Set<Exclude<CommercialBillingInterval, null>>([
  "month",
  "year",
]);

export type CommercialCatalogueCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface CommercialCatalogueStore {
  listCatalogue(input: {
    readonly environment: PlatformConfigurationEnvironment;
  }): Promise<CommercialCatalogue>;
  setProduct(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly productId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly displayName: string;
    readonly description: string;
    readonly lifecycle: CommercialLifecycle;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CommercialCatalogueCommandResult>;
  setPlanVersion(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly planId: string;
    readonly versionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly productId: string;
    readonly key: string;
    readonly displayName: string;
    readonly description: string;
    readonly audience: CommercialPlanAudience;
    readonly pricingModel: CommercialPricingModel;
    readonly billingInterval: CommercialBillingInterval;
    readonly currency: string;
    readonly amountMinor: number;
    readonly taxBehavior: CommercialTaxBehavior;
    readonly trialDays: number;
    readonly providerPriceReference: string | null;
    readonly lifecycle: CommercialLifecycle;
    readonly effectiveFrom: Date;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CommercialCatalogueCommandResult>;
}

export class CommercialCatalogueCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("commercial_catalogue_command_rejected");
  }
}

export interface SetCommercialProductCommand {
  readonly commandId?: string;
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly lifecycle: CommercialLifecycle;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface SetCommercialPlanVersionCommand {
  readonly commandId?: string;
  readonly productId: string;
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly audience: CommercialPlanAudience;
  readonly pricingModel: CommercialPricingModel;
  readonly billingInterval: CommercialBillingInterval;
  readonly currency: string;
  readonly amountMinor: number;
  readonly taxBehavior: CommercialTaxBehavior;
  readonly trialDays: number;
  readonly providerPriceReference?: string | null;
  readonly lifecycle: CommercialLifecycle;
  readonly effectiveFrom: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export function createCommercialCatalogueService(input: {
  readonly store: CommercialCatalogueStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const clock = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  function authorize(actor: AuthenticatedOperator, now: Date) {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:plans:write",
      requireRecentStepUp: true,
      now,
    });
  }

  return {
    listCatalogue: () =>
      input.store.listCatalogue({ environment: input.environment }),

    async setProduct(
      actor: AuthenticatedOperator,
      command: SetCommercialProductCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      const result = await input.store.setProduct({
        actorId: actor.operatorId,
        ...(command.commandId === undefined
          ? {}
          : { commandId: command.commandId }),
        productId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requireKey(command.key, "product_key_invalid"),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "product_name_invalid",
        ),
        description: requireText(
          command.description,
          8,
          1_000,
          "product_description_invalid",
        ),
        lifecycle: requireOneOf(
          command.lifecycle,
          lifecycles,
          "product_lifecycle_invalid",
        ),
        reason: requireText(command.reason, 8, 500, "reason_invalid"),
        correlationId: command.correlationId ?? randomId(),
        now,
      });
      return unwrap(result);
    },

    async setPlanVersion(
      actor: AuthenticatedOperator,
      command: SetCommercialPlanVersionCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      const pricingModel = requireOneOf(
        command.pricingModel,
        pricingModels,
        "plan_pricing_model_invalid",
      );
      const billingInterval = requireBillingInterval(
        command.billingInterval,
        pricingModel,
      );
      const amountMinor = requireInteger(
        command.amountMinor,
        0,
        9_000_000_000_000,
        "plan_amount_invalid",
      );
      if (pricingModel === "free" && amountMinor !== 0)
        reject("free_plan_amount_invalid");
      if (pricingModel === "fixed" && amountMinor === 0)
        reject("fixed_plan_amount_invalid");
      if (pricingModel === "contract" && amountMinor !== 0)
        reject("contract_plan_amount_invalid");

      const effectiveFrom = new Date(command.effectiveFrom);
      if (!Number.isFinite(effectiveFrom.getTime()))
        reject("effective_from_invalid");

      const result = await input.store.setPlanVersion({
        actorId: actor.operatorId,
        ...(command.commandId === undefined
          ? {}
          : { commandId: command.commandId }),
        planId: randomId(),
        versionId: randomId(),
        environment: input.environment,
        productId: requireUuid(command.productId, "product_id_invalid"),
        key: requireKey(command.key, "plan_key_invalid"),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "plan_name_invalid",
        ),
        description: requireText(
          command.description,
          8,
          1_000,
          "plan_description_invalid",
        ),
        audience: requireOneOf(
          command.audience,
          audiences,
          "plan_audience_invalid",
        ),
        pricingModel,
        billingInterval,
        currency: requireCurrency(command.currency),
        amountMinor,
        taxBehavior: requireOneOf(
          command.taxBehavior,
          taxBehaviors,
          "tax_behavior_invalid",
        ),
        trialDays: requireInteger(
          command.trialDays,
          0,
          365,
          "trial_days_invalid",
        ),
        providerPriceReference: requireOptionalReference(
          command.providerPriceReference ?? null,
        ),
        lifecycle: requireOneOf(
          command.lifecycle,
          lifecycles,
          "plan_lifecycle_invalid",
        ),
        effectiveFrom,
        reason: requireText(command.reason, 8, 500, "reason_invalid"),
        correlationId: command.correlationId ?? randomId(),
        now,
      });
      return unwrap(result);
    },
  };
}

function unwrap(result: CommercialCatalogueCommandResult) {
  if (result.outcome === "rejected") reject(result.reason);
  return result;
}

function requireKey(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) reject(reason);
  return normalized;
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  )
    reject(reason);
  return normalized;
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    reject(reason);
  return normalized;
}

function requireInteger(
  value: number,
  minimum: number,
  maximum: number,
  reason: string,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    reject(reason);
  return value;
}

function requireCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) reject("currency_invalid");
  return normalized;
}

function requireOptionalReference(value: string | null) {
  if (value === null || value.trim() === "") return null;
  return requireText(value, 2, 200, "provider_price_reference_invalid");
}

function requireBillingInterval(
  value: CommercialBillingInterval,
  pricingModel: CommercialPricingModel,
): CommercialBillingInterval {
  if (pricingModel === "fixed") {
    if (value === null || !billingIntervals.has(value))
      reject("billing_interval_required");
    return value;
  }
  if (value !== null) reject("billing_interval_forbidden");
  return null;
}

function requireOneOf<Value>(
  value: Value,
  allowed: ReadonlySet<Value>,
  reason: string,
) {
  if (!allowed.has(value)) reject(reason);
  return value;
}

function reject(reason: string): never {
  throw new CommercialCatalogueCommandRejectedError(reason);
}
