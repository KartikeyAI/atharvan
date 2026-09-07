# ADR 0024: Immutable commercial catalogue versions

Status: Accepted
Date: 2026-09-07

## Decision

Atharvan owns stable product and plan identities while recording every commercial
change as an immutable, environment-scoped version. A product update advances its
revision by exactly one. A plan update creates the next version under the same
product and plan key; existing versions are never edited or deleted.

Prices use an exact integer in ISO 4217 minor units. A fixed plan requires a
currency and monthly or yearly interval. Free plans require a zero amount and no
billing interval; contract plans require a zero catalogue amount because their
commercial terms are established separately. Provider price identifiers are
references only and cannot replace the canonical Atharvan price contract.

Lifecycle transitions move forward from `draft` to `active` or `retired`, and
from `active` to `retired`. Retired products and plans cannot be reactivated. A
plan cannot become active unless its product is active. Every successful change
requires `platform:plans:write`, recent passkey step-up, an idempotent command,
an operator reason, and atomic audit evidence.

## Consequences

- Subscription and invoice records can bind to one exact plan version without
  later catalogue edits changing historical meaning.
- Correcting a price, audience, tax treatment, trial, or provider reference
  requires a new version.
- Rollback selects or creates a valid successor version; it never rewrites
  commercial history.
- Environment-scoped stable keys prevent development catalogue entries from
  authorising production billing.
- Entitlement snapshots can be derived from explicit plan versions in the next
  delivery slice.
