import {
  BadgeDollarSignIcon,
  BoxesIcon,
  HistoryIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { EntitlementOperations } from "@/components/entitlement-operations";
import { SubscriptionOperations } from "@/components/subscription-operations";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  apiRequest,
  type CommercialCatalogueResponse,
  useApiResource,
} from "@/lib/api";
import type {
  CommercialPlanEntry,
  CommercialPricingModel,
  CommercialProductEntry,
} from "@atharvan/domain";

export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
});

function BillingPage() {
  const catalogue = useApiResource<CommercialCatalogueResponse>(
    "/api/platform/commercial-catalogue",
  );
  const registry =
    catalogue.state.status === "success" ? catalogue.state.data : null;

  return (
    <OperatorShell title="Billing">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Commercial catalogue</h1>
            <p>
              Environment-scoped products and immutable plan versions for paid
              platform contracts.
            </p>
          </div>
          <Button onClick={catalogue.reload} type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" /> Refresh
          </Button>
        </section>

        <Alert>
          <ShieldCheckIcon aria-hidden="true" />
          Every plan change creates a new version. Existing subscriptions will
          remain bound to their original version when billing is connected.
        </Alert>

        <div className="model-editor-grid">
          <ProductEditor onChanged={catalogue.reload} />
          <PlanEditor
            onChanged={catalogue.reload}
            products={registry?.items ?? []}
          />
        </div>

        {catalogue.state.status === "loading" ? (
          <Card className="loading-card">
            <RefreshCwIcon aria-hidden="true" /> Loading commercial catalogue…
          </Card>
        ) : null}
        {catalogue.state.status === "error" ? (
          <Alert variant="destructive">
            <span>{catalogue.state.error.message}</span>
            <Button onClick={catalogue.reload} type="button" variant="outline">
              Retry
            </Button>
          </Alert>
        ) : null}
        {registry?.truncated ? (
          <Alert variant="destructive">
            The catalogue exceeds the safe response limit. Narrow the catalogue
            before relying on this view for a complete inventory.
          </Alert>
        ) : null}
        {registry !== null ? (
          registry.items.length === 0 ? (
            <Card className="empty-card">
              <BoxesIcon aria-hidden="true" />
              <h2>No products configured</h2>
              <p>Create the first product before publishing plan versions.</p>
            </Card>
          ) : (
            <div className="provider-grid">
              {registry.items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )
        ) : null}
        <EntitlementOperations products={registry?.items ?? []} />
        <SubscriptionOperations products={registry?.items ?? []} />
      </div>
    </OperatorShell>
  );
}

function ProductEditor({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [lifecycle, setLifecycle] = useState("draft");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(`/api/platform/commercial-products/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({ displayName, description, lifecycle, reason }),
      });
      setReason("");
      setMessage(
        `Product ${result.outcome}; revision ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The product was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <BoxesIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Set product revision</CardTitle>
          <CardDescription>
            Stable product keys group related contract plans.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="commercial-product-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <TextField
              id="commercial-product-key"
              label="Product key"
              onChange={setKey}
              value={key}
            />
            <TextField
              id="commercial-product-name"
              label="Display name"
              onChange={setDisplayName}
              value={displayName}
            />
            <Field className="field-span">
              <FieldLabel htmlFor="commercial-product-description">
                Description
              </FieldLabel>
              <textarea
                className="input"
                id="commercial-product-description"
                minLength={8}
                onChange={(event) => setDescription(event.target.value)}
                required
                rows={3}
                value={description}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-product-lifecycle">
                Lifecycle
              </FieldLabel>
              <select
                className="input"
                id="commercial-product-lifecycle"
                onChange={(event) => setLifecycle(event.target.value)}
                value={lifecycle}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="retired">Retired</option>
              </select>
            </Field>
            <TextField
              className="field-span"
              id="commercial-product-reason"
              label="Audit reason"
              minLength={8}
              onChange={setReason}
              value={reason}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button disabled={pending} form="commercial-product-form" type="submit">
          {pending ? "Saving…" : "Set product revision"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PlanEditor({
  products,
  onChanged,
}: Readonly<{
  products: ReadonlyArray<CommercialProductEntry>;
  onChanged: () => void;
}>) {
  const [productId, setProductId] = useState("");
  const [key, setKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("public");
  const [pricingModel, setPricingModel] =
    useState<CommercialPricingModel>("fixed");
  const [billingInterval, setBillingInterval] = useState("month");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [taxBehavior, setTaxBehavior] = useState("exclusive");
  const [trialDays, setTrialDays] = useState("0");
  const [providerPriceReference, setProviderPriceReference] = useState("");
  const [lifecycle, setLifecycle] = useState("draft");
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    toLocalDateTime(new Date()),
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changePricingModel(value: CommercialPricingModel) {
    setPricingModel(value);
    if (value === "fixed") {
      setBillingInterval("month");
    } else {
      setBillingInterval("");
      setAmount("0");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const amountMinor = parseMinorUnits(amount, currency);
      const effective = new Date(effectiveFrom);
      if (!Number.isFinite(effective.getTime()))
        throw new Error("Choose a valid effective time.");
      const result = await apiRequest<{
        readonly outcome: string;
        readonly revisionNumber: number;
      }>(
        `/api/platform/commercial-products/${encodeURIComponent(productId)}/plans/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayName,
            description,
            audience,
            pricingModel,
            billingInterval: pricingModel === "fixed" ? billingInterval : null,
            currency,
            amountMinor,
            taxBehavior,
            trialDays: Number(trialDays),
            providerPriceReference: providerPriceReference || null,
            lifecycle,
            effectiveFrom: effective.toISOString(),
            reason,
          }),
        },
      );
      setReason("");
      setMessage(
        `Plan ${result.outcome}; version ${result.revisionNumber} is current.`,
      );
      onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The plan version was not saved.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <span className="section-icon">
          <BadgeDollarSignIcon aria-hidden="true" />
        </span>
        <div>
          <CardTitle>Publish plan version</CardTitle>
          <CardDescription>
            Money is stored in exact minor units and prior versions stay
            immutable.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {message ? <Alert>{message}</Alert> : null}
        <form id="commercial-plan-form" onSubmit={submit}>
          <FieldGroup className="admin-form">
            <Field>
              <FieldLabel htmlFor="commercial-plan-product">Product</FieldLabel>
              <select
                className="input"
                id="commercial-plan-product"
                onChange={(event) => setProductId(event.target.value)}
                required
                value={productId}
              >
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.displayName} ({product.lifecycle})
                  </option>
                ))}
              </select>
            </Field>
            <TextField
              id="commercial-plan-key"
              label="Plan key"
              onChange={setKey}
              value={key}
            />
            <TextField
              id="commercial-plan-name"
              label="Display name"
              onChange={setDisplayName}
              value={displayName}
            />
            <Field>
              <FieldLabel htmlFor="commercial-plan-audience">
                Audience
              </FieldLabel>
              <select
                className="input"
                id="commercial-plan-audience"
                onChange={(event) => setAudience(event.target.value)}
                value={audience}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="grandfathered">Grandfathered</option>
              </select>
            </Field>
            <Field className="field-span">
              <FieldLabel htmlFor="commercial-plan-description">
                Contract description
              </FieldLabel>
              <textarea
                className="input"
                id="commercial-plan-description"
                minLength={8}
                onChange={(event) => setDescription(event.target.value)}
                required
                rows={3}
                value={description}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-pricing-model">
                Pricing model
              </FieldLabel>
              <select
                className="input"
                id="commercial-pricing-model"
                onChange={(event) =>
                  changePricingModel(
                    event.target.value as CommercialPricingModel,
                  )
                }
                value={pricingModel}
              >
                <option value="fixed">Fixed</option>
                <option value="free">Free</option>
                <option value="contract">Contract</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-billing-interval">
                Billing interval
              </FieldLabel>
              <select
                className="input"
                disabled={pricingModel !== "fixed"}
                id="commercial-billing-interval"
                onChange={(event) => setBillingInterval(event.target.value)}
                required={pricingModel === "fixed"}
                value={billingInterval}
              >
                <option value="month">Monthly</option>
                <option value="year">Annual</option>
              </select>
            </Field>
            <TextField
              id="commercial-currency"
              label="Currency"
              maxLength={3}
              onChange={setCurrency}
              value={currency}
            />
            <Field>
              <FieldLabel htmlFor="commercial-amount">Price</FieldLabel>
              <Input
                disabled={pricingModel !== "fixed"}
                id="commercial-amount"
                min={minorUnitStep(currency)}
                onChange={(event) => setAmount(event.target.value)}
                required={pricingModel === "fixed"}
                step={minorUnitStep(currency)}
                type="number"
                value={amount}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-tax">Tax behavior</FieldLabel>
              <select
                className="input"
                id="commercial-tax"
                onChange={(event) => setTaxBehavior(event.target.value)}
                value={taxBehavior}
              >
                <option value="exclusive">Exclusive</option>
                <option value="inclusive">Inclusive</option>
                <option value="unspecified">Unspecified</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-trial-days">
                Trial days
              </FieldLabel>
              <Input
                id="commercial-trial-days"
                max={365}
                min={0}
                onChange={(event) => setTrialDays(event.target.value)}
                required
                type="number"
                value={trialDays}
              />
            </Field>
            <TextField
              id="commercial-provider-price"
              label="Provider price reference (optional)"
              onChange={setProviderPriceReference}
              required={false}
              value={providerPriceReference}
            />
            <Field>
              <FieldLabel htmlFor="commercial-plan-lifecycle">
                Lifecycle
              </FieldLabel>
              <select
                className="input"
                id="commercial-plan-lifecycle"
                onChange={(event) => setLifecycle(event.target.value)}
                value={lifecycle}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="retired">Retired</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="commercial-effective-from">
                Effective from
              </FieldLabel>
              <Input
                id="commercial-effective-from"
                onChange={(event) => setEffectiveFrom(event.target.value)}
                required
                type="datetime-local"
                value={effectiveFrom}
              />
            </Field>
            <TextField
              className="field-span"
              id="commercial-plan-reason"
              label="Audit reason"
              minLength={8}
              onChange={setReason}
              value={reason}
            />
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button
          disabled={pending || products.length === 0}
          form="commercial-plan-form"
          type="submit"
        >
          {pending ? "Publishing…" : "Publish immutable version"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function ProductCard({
  product,
}: Readonly<{ product: CommercialProductEntry }>) {
  return (
    <Card className="provider-card">
      <CardHeader className="table-card-header">
        <div>
          <CardTitle>{product.displayName}</CardTitle>
          <CardDescription>{product.key}</CardDescription>
        </div>
        <Badge variant={product.lifecycle === "active" ? "success" : "neutral"}>
          {product.lifecycle}
        </Badge>
      </CardHeader>
      <CardContent>
        <p>{product.description}</p>
        <dl className="configuration-values">
          <div>
            <dt>Product revision</dt>
            <dd>{product.revisionNumber}</dd>
          </div>
          <div>
            <dt>Plan count</dt>
            <dd>{product.plans.length}</dd>
          </div>
        </dl>
        {product.plans.length === 0 ? (
          <div className="inline-empty">No plan versions published.</div>
        ) : (
          <div className="model-list">
            {product.plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanRow({ plan }: Readonly<{ plan: CommercialPlanEntry }>) {
  const current = plan.current;
  return (
    <article className="model-row">
      <div className="model-row-heading">
        <div>
          <strong>{current.displayName}</strong>
          <code>{plan.key}</code>
        </div>
        <div className="model-badges">
          <Badge>{current.audience}</Badge>
          <Badge
            variant={current.lifecycle === "active" ? "success" : "neutral"}
          >
            {current.lifecycle}
          </Badge>
        </div>
      </div>
      <p>{current.description}</p>
      <dl className="model-metrics">
        <div>
          <dt>Price</dt>
          <dd>{formatPlanPrice(current)}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{current.versionNumber}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{new Date(current.effectiveFrom).toLocaleString()}</dd>
        </div>
      </dl>
      <details>
        <summary>
          <HistoryIcon aria-hidden="true" /> Version history
        </summary>
        <div className="capability-list">
          {plan.versions.map((version) => (
            <code key={version.id}>
              v{version.versionNumber} · {version.lifecycle} ·{" "}
              {formatPlanPrice(version)}
            </code>
          ))}
          {plan.historyTruncated ? <code>Older versions omitted</code> : null}
        </div>
      </details>
    </article>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  className,
  minLength = 2,
  maxLength,
  required = true,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}>) {
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        maxLength={maxLength}
        minLength={minLength}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        value={value}
      />
    </Field>
  );
}

function parseMinorUnits(value: string, currency: string) {
  const fractionDigits = currencyFractionDigits(currency, true);
  const pattern =
    fractionDigits === 0
      ? /^\d+$/
      : new RegExp(`^\\d+(?:\\.\\d{1,${fractionDigits}})?$`);
  if (!pattern.test(value))
    throw new Error(
      `Enter a price with no more than ${fractionDigits} decimal places.`,
    );
  const [units = "0", fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fractionDigits);
  const amount =
    BigInt(units) * scale + BigInt(fraction.padEnd(fractionDigits, "0"));
  if (amount > 9_000_000_000_000n)
    throw new Error("The price is outside the supported range.");
  return Number(amount);
}

function minorUnitStep(currency: string) {
  const fractionDigits = currencyFractionDigits(currency, false);
  return fractionDigits === 0 ? "1" : `0.${"0".repeat(fractionDigits - 1)}1`;
}

function currencyFractionDigits(currency: string, strict: boolean): number {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    if (strict) throw new Error("Enter a three-letter ISO currency code.");
    return 2;
  }
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: normalized,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    if (strict) throw new Error("Enter a supported ISO currency code.");
    return 2;
  }
}

function toLocalDateTime(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatPlanPrice(value: {
  readonly pricingModel: CommercialPricingModel;
  readonly amountMinor: number;
  readonly currency: string;
  readonly billingInterval: "month" | "year" | null;
}) {
  if (value.pricingModel === "free") return "Free";
  if (value.pricingModel === "contract") return "Contract";
  const fractionDigits = currencyFractionDigits(value.currency, false);
  const amount = value.amountMinor / 10 ** fractionDigits;
  const formatted = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: value.currency,
  }).format(amount);
  return `${formatted} / ${value.billingInterval}`;
}
