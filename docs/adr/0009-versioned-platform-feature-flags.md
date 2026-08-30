# ADR 0009: Versioned platform feature flags

- Status: Accepted
- Date: 2026-08-30

## Context

Arth needs staged rollouts that can target environment, plan, opaque workspace
or user identity, region, internal staff, account age, beta cohort, and stable
percentage allocation. Environment variables and mutable database rows cannot
provide safe ownership, expiry, history, or emergency containment.

Feature flags are temporary rollout controls. They must not become an alternate
store for durable platform configuration, entitlements, customer content, or
secrets.

## Decision

Atharvan stores a stable environment-scoped flag identity and append-only
revisions. Every revision contains:

- a named active operator owner and purpose;
- draft, active, or terminal archived lifecycle;
- an explicit default result;
- ordered targeting rules;
- a review date and optional later expiry;
- an emergency-disabled state;
- actor, reason, correlation, and timestamp evidence.

Rules are evaluated in order and combine their declared conditions with AND.
The first matching rule decides the result. Percentage targeting uses a stable
non-cryptographic hash of flag key, rule id, and an opaque routing key to
produce a deterministic basis-point bucket. Atharvan does not persist preview
routing identities.

Evaluation fails closed when a flag is missing, inactive, expired, or emergency
disabled. The kill switch precedes all targeting. Changes require the
`platform:feature-flags:write` capability and recent step-up authentication;
previews and registry reads require `platform:feature-flags:read`.

PostgreSQL enforces unique environment-scoped keys, revision uniqueness,
ownership references, expiry ordering, bounded JSON rule arrays, and immutable
revision rows. Application validation enforces the complete typed rule shape.
Recent registry history is capped in SQL to avoid unbounded database egress.

## Consequences

- Routine rollouts and emergency containment no longer require deployment or
  direct database edits.
- Arth consumers can reproduce decisions using the same revision and stable
  routing key.
- Archived flags are terminal and stale review/expiry states are surfaced.
- Durable settings remain in the platform configuration registry rather than
  accumulating as permanent flags.
