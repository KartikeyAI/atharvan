import {
  Globe2Icon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { OperatorShell } from "@/components/operator-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  apiRequest,
  type MembershipDomainResponse,
  useApiResource,
} from "@/lib/api";

export const Route = createFileRoute("/membership-domains")({
  component: MembershipDomainsPage,
});

function MembershipDomainsPage() {
  const { state, reload } = useApiResource<MembershipDomainResponse>(
    "/api/platform/membership-domains",
  );
  const [showAdd, setShowAdd] = useState(false);

  return (
    <OperatorShell title="Email domains">
      <div className="page">
        <section className="page-heading">
          <div>
            <h1>Organization email domains</h1>
            <p>
              Only invited addresses matching an active rule can become Atharvan
              operators.
            </p>
          </div>
          <Button
            onClick={() => setShowAdd((visible) => !visible)}
            type="button"
          >
            <PlusIcon aria-hidden="true" /> Add domain
          </Button>
        </section>

        <Alert className="security-notice">
          <ShieldCheckIcon aria-hidden="true" />
          <span>
            <strong>Fail-closed membership boundary.</strong> Domain rules never
            grant access by themselves; an invitation and verified sign-in are
            also required.
          </span>
        </Alert>

        {showAdd ? (
          <AddDomain
            onCreated={() => {
              setShowAdd(false);
              reload();
            }}
          />
        ) : null}
        {state.status === "loading" ? (
          <Card className="loading-card">
            <span className="spinner" /> Loading canonical domain rules…
          </Card>
        ) : null}
        {state.status === "error" ? (
          <DomainError
            code={state.error.code}
            message={state.error.message}
            reload={reload}
          />
        ) : null}
        {state.status === "success" ? (
          <DomainDirectory items={state.data.items} reload={reload} />
        ) : null}
      </div>
    </OperatorShell>
  );
}

function DomainDirectory({
  items,
  reload,
}: Readonly<{ items: MembershipDomainResponse["items"]; reload: () => void }>) {
  if (items.length === 0) {
    return (
      <Card className="empty-card">
        <Globe2Icon />
        <h2>No domain rules found</h2>
        <p>No organization can onboard until a rule is established.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="table-card-header">
        <div>
          <h2>Membership rules</h2>
          <p>Exact domain matching is the default.</p>
        </div>
        <Badge>{items.filter((item) => item.isActive).length} active</Badge>
      </CardHeader>
      <CardContent className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Matching</th>
              <th>Status</th>
              <th>Reason</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((domain) => (
              <tr key={domain.id}>
                <td>
                  <strong>{domain.domain}</strong>
                  <span>
                    Added {new Date(domain.createdAt).toLocaleDateString()}
                  </span>
                </td>
                <td>
                  {domain.includeSubdomains
                    ? "Domain + subdomains"
                    : "Exact domain only"}
                </td>
                <td>
                  <Badge variant={domain.isActive ? "success" : "critical"}>
                    {domain.isActive ? "Active" : "Disabled"}
                  </Badge>
                </td>
                <td>{domain.reason}</td>
                <td>
                  {domain.isActive ? (
                    <DisableDomain domain={domain.domain} onDisabled={reload} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function AddDomain({ onCreated }: Readonly<{ onCreated: () => void }>) {
  const [domain, setDomain] = useState("");
  const [includeSubdomains, setIncludeSubdomains] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/platform/membership-domains", {
        method: "POST",
        body: JSON.stringify({ domain, includeSubdomains, reason }),
      });
      onCreated();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The domain was not added.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="action-card">
      <CardHeader>
        <div className="section-icon">
          <Globe2Icon />
        </div>
        <div>
          <h2>Add an organization domain</h2>
          <p>A fresh verified session is required for this sensitive change.</p>
        </div>
      </CardHeader>
      <CardContent>
        {error ? <Alert variant="destructive">{error}</Alert> : null}
        <form className="admin-form" onSubmit={submit}>
          <div className="field-stack">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="organization.com"
              required
              value={domain}
            />
          </div>
          <label className="checkbox-row compact-check">
            <input
              checked={includeSubdomains}
              onChange={(event) => setIncludeSubdomains(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Include subdomains</strong>
              <small>Allow addresses such as user@team.organization.com.</small>
            </span>
          </label>
          <div className="field-stack field-span">
            <Label htmlFor="domain-reason">Audit reason</Label>
            <Input
              id="domain-reason"
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              required
              value={reason}
            />
          </div>
          <div className="form-actions field-span">
            <Button disabled={pending} type="submit">
              {pending ? "Adding domain…" : "Add domain"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function DisableDomain({
  domain,
  onDisabled,
}: Readonly<{ domain: string; onDisabled: () => void }>) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(
        `/api/platform/membership-domains/${encodeURIComponent(domain)}/disable`,
        {
          method: "POST",
          body: JSON.stringify({ membershipLockdown: false, reason }),
        },
      );
      onDisabled();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The domain was not disabled.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        aria-label={`Disable ${domain}`}
        onClick={() => setConfirming(true)}
        type="button"
        variant="ghost"
      >
        <ShieldOffIcon /> Disable
      </Button>
    );
  }

  return (
    <form className="inline-confirmation" onSubmit={disable}>
      <Label htmlFor={`disable-${domain}`}>Audit reason</Label>
      <Input
        id={`disable-${domain}`}
        minLength={8}
        onChange={(event) => setReason(event.target.value)}
        required
        value={reason}
      />
      {error ? <small className="form-error">{error}</small> : null}
      <div>
        <Button disabled={pending} type="submit" variant="destructive">
          {pending ? "Disabling…" : "Confirm"}
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setReason("");
            setError(null);
          }}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DomainError({
  code,
  message,
  reload,
}: Readonly<{ code: string; message: string; reload: () => void }>) {
  return (
    <Alert variant="destructive">
      <strong>
        {code === "authentication_required"
          ? "Sign in required"
          : "Domain rules unavailable"}
      </strong>
      <span>{message}</span>
      {code === "authentication_required" ? (
        <Link className="button button-outline" to="/login">
          Go to sign in
        </Link>
      ) : (
        <Button onClick={reload} type="button" variant="outline">
          <RefreshCwIcon /> Retry
        </Button>
      )}
    </Alert>
  );
}
