# ADR 0012: Reconciled customer access restrictions

Status: Accepted  
Date: 2026-08-30

## Context

Atharvan must let authorised operators restrict and restore individual customer capabilities without direct database edits. Arth remains authoritative for customer identity, workspace membership, and enforcement. Recording an Atharvan command is therefore not proof that Arth has applied the deny or restoration.

## Decision

User and workspace restrictions are environment-scoped controls keyed by the stable Arth source identifier and one explicit capability: login, new executions, provider mutations, production deployments, integrations, runner access, or all access. Workspace login restrictions are invalid because login belongs to an identity.

Every change appends an immutable desired-state revision. Restrict and restore commands require the matching user/workspace restriction capability, a recent step-up assertion, a reason, an idempotency key through the shared command envelope, and exact `RESTRICT <target>` or `RESTORE <target>` confirmation. A target must exist in the bounded customer-directory projection, but the command does not rewrite that projection.

Atharvan reports a new revision as `pending`. Arth reconciliation appends a monotonic source observation against the desired revision. The projected state becomes `applied` only when the observation matches the desired state, `drifted` when it conflicts, and `failed` when Arth reports failure. Restoration is explicit and cannot be requested for a capability with no active restricted revision.

The Security Operator role gains the exact customer-directory read and user/workspace restriction capabilities in version 2. Source-reconciliation observations remain restricted to the singleton Super Administrator with recent step-up until a dedicated workload identity is introduced.

## Consequences

- Atharvan never presents recorded intent as enforcement evidence.
- Restriction history and reconciliation observations cannot be updated or deleted.
- Arth can consume desired revisions and report observations idempotently and out of order; older source revisions are ignored.
- The first live restriction remains operationally pending until the Arth consumer is connected.
- Ownership recovery, transfer, internal notes, risk markers, and privileged support access remain separate workflows.
