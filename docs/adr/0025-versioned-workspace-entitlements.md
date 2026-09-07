# ADR 0025: Versioned workspace entitlement authority

Status: Accepted
Date: 2026-09-07

## Decision

Each immutable commercial plan version may have one sealed entitlement set.
Entitlements are typed as boolean capabilities or quantity allowances, with an
explicit unit and overage policy for quantities. Sealed plan values cannot be
edited or deleted.

Assigning a plan version to a workspace creates an immutable, monotonically
versioned snapshot. A snapshot records its complete plan and enterprise-grant
layers, including grant validity windows, so enforcement can resolve the current
value deterministically and fall back to the plan when a grant expires.

Enterprise grants are bounded to 128 keys per workspace, require a contract
reference, reason, start, and expiry, and have immutable revisions. Revocation is
terminal. Every assignment or grant change atomically advances the workspace
snapshot, records audit and idempotency evidence, and enqueues a signed Arth
command. Atharvan reports reconciliation separately from desired authority.

## Consequences

- Historical subscription authority remains explainable from exact snapshots.
- Plan changes never silently rewrite existing workspace authority.
- Arth applies only monotonic snapshot revisions and acknowledges success or
  failure as immutable observations.
- Grant expiry needs no database mutation because the signed snapshot includes
  validity windows and the plan fallback.
- Restoring a revoked grant requires a new entitlement key or a reviewed future
  contract change; revoked history is never reopened.
