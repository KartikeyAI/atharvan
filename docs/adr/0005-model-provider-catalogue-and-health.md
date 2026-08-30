# ADR 0005: Versioned model catalogue and evidence-backed health

- Status: Accepted
- Date: 2026-08-30

## Context

Arth model providers, model identifiers, capabilities, context limits, prices, regions, and data-classification policy cannot remain environment variables or code constants. Atharvan also must not display a provider as healthy merely because it is configured.

Provider credential material is already owned by the platform secret provider. PostgreSQL contains only Atharvan's metadata reference and lifecycle evidence.

## Decision

Atharvan stores an environment-scoped provider identity and an immutable sequence of provider revisions. A revision contains non-secret connection metadata, adapter kind, an optional active secret-reference identifier, region availability, lifecycle, and maximum permitted data classification.

Each provider owns stable model identities with immutable model revisions. Model revisions contain capabilities, kind, token limits, integer USD microunit prices per one million tokens, regions, lifecycle, and data-classification limits. Identical commands are no-ops and do not create a revision.

Catalogue mutations require `platform:models:write` and recent step-up proof. PostgreSQL rechecks that the actor is active. A referenced credential must be active and belong to the same Atharvan environment when a provider revision is created.

Provider health is a separate append-only observation stream. An observation contains only bounded structured evidence: reported state, source, latency, HTTP status, error code, observation time, and expiry. It expires after five minutes. The read projection reports:

- `unknown` when no observation exists;
- the reported state while evidence is fresh;
- `stale` after evidence expires.

Atharvan never derives `healthy` from catalogue presence. The current operator-probe source is an authenticated ingestion boundary; scheduled probes and provider webhooks may be added as distinct sources after service identity is implemented.

## Consequences

- Normal provider and model metadata changes require no deployment or direct database edit.
- Historical metadata and health evidence cannot be updated or deleted through routine commands.
- Credential values and Cloudflare provider locators are absent from catalogue responses.
- Pricing avoids floating-point storage and has an explicit currency.
- Routing, fallback order, maintenance mode, rollout percentages, and kill switches remain separate policy state and are not implied by catalogue lifecycle.
- Live operational verification remains pending until migration `0006` and real provider observations run in the development environment.
