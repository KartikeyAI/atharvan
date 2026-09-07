# Workspace entitlement operations

Plan entitlement templates and workspace snapshots define the authority that
Arth enforces. They do not meter usage or create billing-provider subscriptions.

## Access and operating sequence

- Reads require `platform:plans:read`.
- Sealing templates, assigning plans, and changing enterprise grants require
  `platform:plans:write`, recent passkey step-up, a reason, and idempotency.
- Seal a typed entitlement template only after reviewing every key, allowance,
  unit, and overage policy. A plan version can be sealed once.
- Assign only an active plan under an active product to an existing,
  non-archived workspace.
- Use an enterprise grant only with an approved contract reference and explicit
  validity window. Revoke it when the commercial authority ends early.
- Inspect the workspace after each change. `pending` means desired authority is
  queued; `applied` or `failed` reflects Arth's latest signed acknowledgement.

## Failure and recovery

Exact idempotent retries return the stored result. Changed retries are rejected.
Snapshot revisions cannot skip or move backward. If persistence, audit, receipt,
or outbox creation fails, the transaction rolls back in full.

For a failed Arth observation, fix the enforcement or delivery cause and redrive
the existing command according to the Arth command exchange runbook. Never edit a
snapshot or observation. A replacement plan or grant revision creates the next
snapshot. Expired grants automatically cease to win during resolution.

## Deployment and verification

Migration `0030_entitlement_snapshots` adds sealed plan sets, assignment pointers,
immutable snapshots and layers, enterprise grant revisions, and reconciliation
observations. Production readiness requires schema version 30 and verifies the
snapshot table, immutable trigger, and runtime privileges.

Before promotion, verify sealing, plan assignment, exact retry, concurrent
revision rejection, grant scheduling/expiry/revocation, signed delivery,
out-of-order acknowledgement rejection, and plan fallback against a disposable
database and an Arth test environment.
