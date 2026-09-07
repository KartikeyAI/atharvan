import {
  CreditCardIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

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
import { apiRequest } from "@/lib/api";
import type {
  CommercialProductEntry,
  WorkspaceBillingRegistry,
} from "@atharvan/domain";

interface CheckoutPlan {
  readonly id: string;
  readonly label: string;
}

/** Operate Stripe Checkout and inspect immutable provider reconciliation evidence. */
export function SubscriptionOperations({
  products,
}: Readonly<{ products: ReadonlyArray<CommercialProductEntry> }>) {
  const plans = checkoutPlans(products);
  const [workspaceId, setWorkspaceId] = useState("");
  const [planVersionId, setPlanVersionId] = useState("");
  const [checkoutReason, setCheckoutReason] = useState("");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [registry, setRegistry] = useState<WorkspaceBillingRegistry | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function inspect(preserveMessage = false) {
    const workspace = workspaceId.trim();
    if (!workspace) {
      setMessage("Enter a workspace ID.");
      return null;
    }
    setPending(true);
    if (!preserveMessage) setMessage(null);
    try {
      const nextRegistry = await apiRequest<WorkspaceBillingRegistry>(
        `/api/platform/billing/workspaces/${encodeURIComponent(workspace)}`,
        { cache: "no-store" },
      );
      setRegistry(nextRegistry);
      return nextRegistry;
    } catch (error) {
      setRegistry(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Workspace billing could not be loaded.",
      );
      return null;
    } finally {
      setPending(false);
    }
  }

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const result = await apiRequest<{
        readonly outcome: string;
        readonly state: string;
        readonly checkoutUrl: string | null;
      }>(
        `/api/platform/billing/workspaces/${encodeURIComponent(workspaceId.trim())}/checkout`,
        {
          method: "POST",
          body: JSON.stringify({ planVersionId, reason: checkoutReason }),
        },
      );
      setCheckoutReason("");
      const nextRegistry = await inspect(true);
      const ready = nextRegistry?.checkoutRequests.some(
        (request) => request.state === "ready" && request.checkoutUrl !== null,
      );
      const latestState =
        nextRegistry?.checkoutRequests[0]?.state ?? result.state;
      setMessage(
        ready
          ? "Checkout is ready. Open the secure Stripe page to continue."
          : latestState === "pending"
            ? "Checkout is pending; provider recovery will continue automatically."
            : `Checkout is ${latestState}. Review its evidence before starting another request.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Checkout could not be started.",
      );
    } finally {
      setPending(false);
    }
  }

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await apiRequest(
        `/api/platform/billing/workspaces/${encodeURIComponent(workspaceId.trim())}/reconcile`,
        {
          method: "POST",
          body: JSON.stringify({ reason: reconciliationReason }),
        },
      );
      setReconciliationReason("");
      await inspect(true);
      setMessage("Stripe subscription evidence was reconciled.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Subscription reconciliation did not complete.",
      );
    } finally {
      setPending(false);
    }
  }

  const readyCheckout = registry?.checkoutRequests.find(
    (request) => request.state === "ready" && request.checkoutUrl !== null,
  );

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Subscriptions</p>
          <h2>Stripe subscription lifecycle</h2>
          <p>
            Start hosted Checkout and verify provider state against the assigned
            workspace plan.
          </p>
        </div>
      </div>
      {message ? <Alert>{message}</Alert> : null}
      <Card>
        <CardHeader>
          <span className="section-icon">
            <SearchIcon aria-hidden="true" />
          </span>
          <div>
            <CardTitle>Inspect workspace billing</CardTitle>
            <CardDescription>
              Loads current subscription, Checkout attempts, and reconciliation
              evidence.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel htmlFor="billing-workspace-id">Workspace ID</FieldLabel>
            <Input
              id="billing-workspace-id"
              maxLength={200}
              onChange={(event) => setWorkspaceId(event.target.value)}
              value={workspaceId}
            />
          </Field>
        </CardContent>
        <CardFooter>
          <Button
            disabled={pending}
            onClick={() => void inspect()}
            type="button"
          >
            <RefreshCwIcon data-icon="inline-start" />
            {pending ? "Loading…" : "Inspect billing"}
          </Button>
        </CardFooter>
      </Card>

      {registry ? (
        <>
          {!registry.providerConfigured ? (
            <Alert variant="destructive">
              Stripe billing is not configured for this environment.
            </Alert>
          ) : null}
          <div className="model-editor-grid">
            <Card>
              <CardHeader>
                <span className="section-icon">
                  <CreditCardIcon aria-hidden="true" />
                </span>
                <div>
                  <CardTitle>Start subscription Checkout</CardTitle>
                  <CardDescription>
                    The selected plan must match the workspace entitlement
                    snapshot.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <form id="subscription-checkout-form" onSubmit={startCheckout}>
                  <FieldGroup className="admin-form">
                    <Field className="field-span">
                      <FieldLabel htmlFor="subscription-checkout-plan">
                        Active recurring plan
                      </FieldLabel>
                      <select
                        className="input"
                        id="subscription-checkout-plan"
                        onChange={(event) =>
                          setPlanVersionId(event.target.value)
                        }
                        required
                        value={planVersionId}
                      >
                        <option value="">Select a Stripe-backed plan</option>
                        {plans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field className="field-span">
                      <FieldLabel htmlFor="subscription-checkout-reason">
                        Audit reason
                      </FieldLabel>
                      <Input
                        id="subscription-checkout-reason"
                        minLength={8}
                        onChange={(event) =>
                          setCheckoutReason(event.target.value)
                        }
                        required
                        value={checkoutReason}
                      />
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
              <CardFooter>
                <Button
                  disabled={
                    pending ||
                    !registry.providerConfigured ||
                    plans.length === 0
                  }
                  form="subscription-checkout-form"
                  type="submit"
                >
                  Start secure Checkout
                </Button>
                {readyCheckout?.checkoutUrl ? (
                  <a
                    className="button button-outline"
                    href={readyCheckout.checkoutUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <ExternalLinkIcon data-icon="inline-start" /> Open Stripe
                  </a>
                ) : null}
              </CardFooter>
            </Card>
            <SubscriptionCard
              onReconcile={reconcile}
              pending={pending}
              reason={reconciliationReason}
              registry={registry}
              setReason={setReconciliationReason}
            />
          </div>
          <CheckoutHistory registry={registry} />
        </>
      ) : null}
    </section>
  );
}

function SubscriptionCard({
  registry,
  reason,
  pending,
  setReason,
  onReconcile,
}: Readonly<{
  registry: WorkspaceBillingRegistry;
  reason: string;
  pending: boolean;
  setReason: (value: string) => void;
  onReconcile: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  const subscription = registry.subscription;
  return (
    <Card>
      <CardHeader className="table-card-header">
        <div>
          <CardTitle>Current subscription</CardTitle>
          <CardDescription>{registry.workspaceName}</CardDescription>
        </div>
        <Badge
          variant={
            subscription?.reconciliationState === "matched"
              ? "success"
              : subscription
                ? "warning"
                : "neutral"
          }
        >
          {subscription?.reconciliationState ?? "none"}
        </Badge>
      </CardHeader>
      <CardContent>
        {subscription ? (
          <>
            <dl className="configuration-values">
              <div>
                <dt>Status</dt>
                <dd>{subscription.current.status}</dd>
              </div>
              <div>
                <dt>Plan</dt>
                <dd>{subscription.current.planDisplayName}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>{subscription.current.quantity}</dd>
              </div>
              <div>
                <dt>Current period ends</dt>
                <dd>
                  {new Date(
                    subscription.current.currentPeriodEnd,
                  ).toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Provider subscription</dt>
                <dd>{subscription.current.providerSubscriptionId}</dd>
              </div>
              <div>
                <dt>Last reconciled</dt>
                <dd>{formatOptionalDate(subscription.lastReconciledAt)}</dd>
              </div>
            </dl>
            {subscription.reconciliationReasonCode ? (
              <Alert variant="destructive">
                Reconciliation requires attention:{" "}
                {subscription.reconciliationReasonCode}
              </Alert>
            ) : null}
            <form id="subscription-reconcile-form" onSubmit={onReconcile}>
              <Field>
                <FieldLabel htmlFor="subscription-reconcile-reason">
                  Reconciliation reason
                </FieldLabel>
                <Input
                  id="subscription-reconcile-reason"
                  minLength={8}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  value={reason}
                />
              </Field>
            </form>
          </>
        ) : (
          <div className="inline-empty">No provider subscription recorded.</div>
        )}
      </CardContent>
      {subscription ? (
        <CardFooter>
          <Button
            disabled={pending || !registry.providerConfigured}
            form="subscription-reconcile-form"
            type="submit"
            variant="outline"
          >
            Reconcile with Stripe
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function CheckoutHistory({
  registry,
}: Readonly<{ registry: WorkspaceBillingRegistry }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checkout history</CardTitle>
        <CardDescription>
          Durable provider attempts for {registry.workspaceName}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {registry.checkoutRequests.length === 0 ? (
          <div className="inline-empty">No Checkout requests recorded.</div>
        ) : (
          <div className="model-list">
            {registry.checkoutRequests.map((request) => (
              <article className="model-row" key={request.id}>
                <div className="model-row-heading">
                  <div>
                    <strong>{request.planDisplayName}</strong>
                    <code>{request.id}</code>
                  </div>
                  <Badge
                    variant={
                      request.state === "completed"
                        ? "success"
                        : request.state === "failed"
                          ? "critical"
                          : request.state === "ready"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {request.state}
                  </Badge>
                </div>
                <p>
                  Created {new Date(request.createdAt).toLocaleString()}
                  {request.lastErrorCode ? ` · ${request.lastErrorCode}` : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function checkoutPlans(products: ReadonlyArray<CommercialProductEntry>) {
  return products.flatMap((product) =>
    product.plans.flatMap((plan) =>
      plan.versions.flatMap((version) =>
        product.lifecycle === "active" &&
        version.lifecycle === "active" &&
        version.pricingModel === "fixed" &&
        version.billingInterval !== null &&
        version.providerPriceReference !== null
          ? [
              {
                id: version.id,
                label: `${product.displayName} · ${plan.key} v${version.versionNumber}`,
              } satisfies CheckoutPlan,
            ]
          : [],
      ),
    ),
  );
}

function formatOptionalDate(value: string | null) {
  return value === null ? "Not yet" : new Date(value).toLocaleString();
}
