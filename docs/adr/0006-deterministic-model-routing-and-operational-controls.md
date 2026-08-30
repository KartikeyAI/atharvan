# ADR 0006: Deterministic model routing and operational controls

- Status: Accepted
- Date: 2026-08-30

## Context

The model catalogue describes available provider and model metadata, but catalogue presence must not imply that a model is safe or eligible for traffic. Arth needs task-specific defaults, gradual rollouts, ordered fallbacks, maintenance containment, and immediate provider/model kill switches without a deployment or direct database edit.

Routing must also remain explainable. An operator needs to know whether a candidate was rejected because of lifecycle state, explicit controls, stale health, credentials, capabilities, region, data classification, or rollout targeting.

## Decision

Atharvan stores environment-scoped routing policies as stable identities with immutable revisions. Each revision owns an immutable ordered target chain. Target order is fallback order; rollout allocation is stored in integer basis points from 1 to 10,000.

The routing bucket is derived deterministically from the policy revision, target identity, and caller-supplied stable routing key. The same policy revision and stable key therefore produce the same rollout evaluation.

Provider and model operational controls are separately versioned. Both targets must have an explicit effective `enabled` control before they can receive traffic. `maintenance` requires an expiry and becomes effectively enabled after that expiry. `disabled` has no automatic expiry and requires an audited re-enable revision.

A candidate is eligible only when:

- provider and model catalogue revisions are active;
- provider and model operational controls are effectively enabled;
- provider health evidence is fresh and healthy, or explicitly allowed degraded evidence is fresh;
- a non-self-hosted provider has an active credential reference;
- model capabilities satisfy policy and request requirements;
- provider, model, policy, region, and data-classification limits are compatible; and
- the deterministic bucket falls within the target rollout.

The resolver returns structured candidate evaluations. Fallback is therefore observable and never silent. Routing policies, targets, and control revisions are protected from update and deletion by PostgreSQL triggers.

## Consequences

- Catalogue metadata cannot accidentally activate traffic.
- Operators can contain one model or an entire provider immediately without deployment.
- Canary allocation remains stable until a new policy revision is published.
- Maintenance windows recover automatically, while kill switches require deliberate recovery.
- Arth callers must supply a stable non-secret routing key and correctly classified request context.
- A new provider/model remains unroutable until both explicit controls and fresh health evidence exist.
