# ADR 0007: Platform integration and OAuth registry

- Status: Accepted
- Date: 2026-08-30

## Context

Arth depends on provider applications such as GitHub, GitLab, Vercel, database providers, identity providers, observability systems, and billing systems. Their OAuth client metadata, adapter compatibility, scopes, callbacks, secret bindings, lifecycle, and operational status cannot remain hidden in environment variables or source code.

Atharvan is an internal platform control plane. It must configure Arth's provider applications without creating a path into a customer's installed connections, tokens, repositories, code, secrets, integrations, or environments.

## Decision

Atharvan stores one stable, environment-scoped integration identity and an immutable sequence of metadata revisions. A revision declares:

- protocol and connection mode;
- adapter package and semantic version;
- supported capability classes;
- public OAuth client ID, authorization/token endpoints, exact callback URLs, and required/optional scopes;
- references to active client-secret and webhook-secret metadata;
- lifecycle and explicit operational state;
- a bounded maintenance expiry when maintenance is selected;
- actor, reason, correlation, and creation evidence.

Credential values remain exclusively in the configured secret provider. PostgreSQL stores only foreign-key references to their lifecycle metadata. The API has no secret read-back operation.

Registry mutations require `platform:integrations:write`; metadata revisions require recent step-up authentication. Reads require `platform:integrations:read`. Operational health observations are append-only, expire after five minutes, and remain `unknown` until evidence exists. An expired observation is `stale`, not healthy.

The registry does not store customer installations, authorization grants, access or refresh tokens, provider resources, repository identifiers, source code, deployment environments, or customer integration configuration. Those resources remain outside Atharvan's platform wildcard and require separate customer-authorized systems.

## Consequences

- Provider applications can be revised without deployment while preserving complete audit history.
- Development, test, and production registrations cannot accidentally share identity or secret bindings.
- OAuth scopes and callbacks are reviewable, exact, and versioned.
- Maintenance automatically expires; a disabled kill switch remains disabled until a new audited revision enables it.
- Catalogue presence does not claim provider availability.
- Provider-specific OAuth exchanges, webhook receivers, installation reconciliation, and automatic probes remain separate follow-up work and must not be represented as complete by this registry.
