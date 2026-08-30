# ADR 0003: Versioned non-secret platform configuration

- Status: Accepted
- Date: 2026-08-30

## Context

Routine Arth platform behavior must be configurable without changing environment variables, deploying application code, or editing PostgreSQL manually. Configuration changes need validation, history, attribution, deterministic precedence, and an explicit separation from credentials.

## Decision

Atharvan stores a catalogue of typed, non-secret configuration definitions in PostgreSQL. Each definition declares its key, category, value type, validation constraints, default value, and mutability. Keys that imply secrets, tokens, passwords, credentials, private keys, or signing material are rejected in the application and by a database constraint.

A change inserts an immutable revision containing the exact value, scope, environment, actor, reason, correlation identifier, and timestamp. PostgreSQL rejects revision updates and deletion with a trigger. A separate binding row points to the current revision for a platform or environment scope, allowing current state to advance without rewriting history.

Resolution order is:

1. current-environment override;
2. platform override;
3. definition default.

The Worker resolves only its boot-declared environment. A development control plane cannot select and mutate production-scoped configuration through an API parameter. Writes require the singleton Super Administrator, `platform:configuration:write`, and a recent step-up authentication event. Reads require `platform:configuration:read`.

The registry exposes resolved values to operational consumers. Operator invitation enablement and lifetime are the first consumers; subsequent feature slices must use this resolver rather than duplicate constants.

## Consequences

- Normal non-secret settings gain typed validation, revision history, and deterministic precedence.
- Credentials remain boot configuration or opaque secret references and are never accepted as registry values.
- Repeating the current value is a no-op and creates neither a revision nor an audit event.
- Every material change creates one revision and one audit event in the same transaction.
- Rollback will create a new revision from a historical value; it will never repoint history silently.
- Migration `0004` is additive and can be applied before code that consumes the registry.
