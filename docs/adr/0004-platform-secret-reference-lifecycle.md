# ADR 0004: Platform secret-reference lifecycle

- Status: Accepted
- Date: 2026-08-30

## Context

Atharvan must operate provider credentials, signing material, and other platform secrets without storing their values in PostgreSQL or returning existing values to an operator. Secret changes are external mutations: a provider request and the canonical control-plane metadata cannot be committed in one database transaction.

## Decision

Atharvan uses a provider-neutral `@atharvan/secrets` boundary. The initial management adapter targets Cloudflare Secrets Store, while application services and PostgreSQL use only Atharvan contracts.

PostgreSQL stores:

- an environment-scoped logical key and purpose;
- an opaque provider name and provider identifier;
- lifecycle and version status;
- actor, reason, correlation, and timestamps;
- append-only audit evidence.

PostgreSQL never stores a secret value, ciphertext, digest, preview, or recoverable fragment. Atharvan exposes no secret read method through its administration service, Worker API, or console.

Create, rotate, and revoke require the singleton Super Administrator, `platform:secrets:write`, and recent step-up authentication. Revocation additionally requires explicit `REVOKE` confirmation at the API boundary.

Each mutation reserves canonical state before calling the provider outside the database transaction. Success advances the active metadata; failure records a fail-closed lifecycle state and audit event. A failed rotation does not retire the previous version metadata. Interrupted or ambiguous provider outcomes remain visible for later reconciliation instead of being presented as successful.

The initial provider is configured only when all three boot values are present:

- `CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID`;
- `CLOUDFLARE_SECRETS_STORE_ID`;
- `CLOUDFLARE_SECRETS_STORE_API_TOKEN`.

The API token must be dedicated to Secrets Store administration and must not be reused as a general deployment credential.

## Consequences

- Operators can replace and revoke values but cannot recover existing material.
- Provider locators remain server-only metadata and are not returned to the console.
- Provider failures are sanitized before they reach API responses or logs.
- Lifecycle metadata cannot be deleted; later reconciliation work can use its status and correlation evidence.
- A future secret provider can implement the same port without changing domain, API, or database contracts.
- Consumption of secrets by models, integrations, and runners will use a separate internal resolution boundary; this administration API will not gain a read-back operation.
