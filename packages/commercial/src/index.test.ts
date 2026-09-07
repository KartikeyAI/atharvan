import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedOperator } from "@atharvan/domain";

import {
  CommercialCatalogueCommandRejectedError,
  createCommercialCatalogueService,
  type CommercialCatalogueStore,
} from "./index";

const now = new Date("2026-09-07T04:00:00.000Z");
const actor: AuthenticatedOperator = {
  operatorId: "00000000-0000-4000-8000-000000000001",
  isSuperAdministrator: false,
  effectiveCapabilities: ["platform:plans:read", "platform:plans:write"],
  stepUpVerifiedAt: now,
};
const actorWithoutStepUp: AuthenticatedOperator = {
  operatorId: actor.operatorId,
  isSuperAdministrator: actor.isSuperAdministrator,
  effectiveCapabilities: actor.effectiveCapabilities,
};

function createStore(): CommercialCatalogueStore {
  return {
    listCatalogue: vi.fn(async ({ environment }) => ({
      environment,
      items: [],
      truncated: false,
    })),
    setProduct: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.productId,
      revisionNumber: 1,
    })),
    setPlanVersion: vi.fn(async (input) => ({
      outcome: "created" as const,
      id: input.planId,
      revisionNumber: 1,
    })),
  };
}

function createService() {
  const store = createStore();
  let sequence = 0;
  return {
    store,
    service: createCommercialCatalogueService({
      store,
      environment: "development",
      now: () => now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    }),
  };
}

describe("commercial catalogue", () => {
  it("normalizes a product and preserves an audited immutable revision input", async () => {
    const { service, store } = createService();
    await service.setProduct(actor, {
      key: " Platform ",
      displayName: " Arth Platform ",
      description: " Hosted development and execution platform. ",
      lifecycle: "active",
      reason: "Publish the initial commercial product.",
    });
    expect(store.setProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "platform",
        displayName: "Arth Platform",
        lifecycle: "active",
        environment: "development",
      }),
    );
  });

  it("converts a fixed annual plan into exact persistence input", async () => {
    const { service, store } = createService();
    await service.setPlanVersion(actor, {
      productId: "00000000-0000-4000-8000-000000000100",
      key: " Pro-Annual ",
      displayName: " Pro annual ",
      description: " Annual platform access for professional teams. ",
      audience: "public",
      pricingModel: "fixed",
      billingInterval: "year",
      currency: "usd",
      amountMinor: 24_000,
      taxBehavior: "exclusive",
      trialDays: 14,
      providerPriceReference: " price_pro_annual ",
      lifecycle: "active",
      effectiveFrom: "2026-10-01T00:00:00.000Z",
      reason: "Publish the annual professional contract.",
    });
    expect(store.setPlanVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "pro-annual",
        currency: "USD",
        amountMinor: 24_000,
        billingInterval: "year",
        providerPriceReference: "price_pro_annual",
        effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
      }),
    );
  });

  it("rejects ambiguous pricing contracts before persistence", async () => {
    const { service, store } = createService();
    await expect(
      service.setPlanVersion(actor, {
        productId: "00000000-0000-4000-8000-000000000100",
        key: "free",
        displayName: "Free",
        description: "Free access for evaluation workspaces.",
        audience: "public",
        pricingModel: "free",
        billingInterval: "month",
        currency: "USD",
        amountMinor: 0,
        taxBehavior: "unspecified",
        trialDays: 0,
        lifecycle: "draft",
        effectiveFrom: now.toISOString(),
        reason: "Create the evaluation plan contract.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommercialCatalogueCommandRejectedError>>(
        {
          reason: "billing_interval_forbidden",
        },
      ),
    );
    expect(store.setPlanVersion).not.toHaveBeenCalled();
  });

  it("requires recent passkey proof for commercial mutations", async () => {
    const { service } = createService();
    await expect(
      service.setProduct(actorWithoutStepUp, {
        key: "platform",
        displayName: "Arth Platform",
        description: "Hosted development and execution platform.",
        lifecycle: "draft",
        reason: "Create the initial commercial product.",
      }),
    ).rejects.toThrow("recent_step_up_required");
  });
});
