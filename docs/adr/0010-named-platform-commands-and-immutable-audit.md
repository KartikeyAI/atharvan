# ADR 0010: Named platform commands and immutable audit evidence

- Status: Accepted
- Date: 2026-08-30

## Context

Atharvan already authorises domain mutations and writes domain-specific audit events, but the HTTP mutation boundary did not have one durable command identity, version, idempotency contract, terminal response, or searchable evidence projection. That gap makes safe retries, coverage review, and later durable workflow orchestration inconsistent.

Storing raw command payloads would create an unnecessary credential and personal-data exposure path. Treating logs as audit evidence would also make operational history dependent on retention and redaction settings intended for diagnostics.

## Decision

Every material platform API mutation enters a named, versioned command envelope before domain execution. The envelope records:

- actor, environment, target, command name and version;
- optional expected target version;
- reason and correlation ID;
- optional approval and evidence references;
- a canonical SHA-256 fingerprint of a deliberately safe payload;
- a SHA-256 fingerprint of the idempotency key;
- request time and one append-only terminal result.

Plaintext idempotency keys and raw request payloads are not stored. Secret material is replaced before payload canonicalisation, so neither the secret nor a reusable digest of it reaches PostgreSQL.

The uniqueness boundary is environment, actor, command name/version, and idempotency fingerprint. Reuse with the same envelope replays the stored response after completion, reports an in-progress command before completion, and rejects different input as a conflict.

Command acceptance, completion, and replay append audit events. Existing domain-specific audit events remain authoritative domain evidence and correlate through the request correlation ID. PostgreSQL triggers reject updates and deletion of command envelopes, terminal results, and audit events.

Audit search uses bounded keyset pagination. NDJSON export requires `platform:audit:export`, recent step-up authentication, explicit start/end timestamps, and a maximum 31-day range. Exports report truncation rather than silently presenting a partial file as complete.

## Consequences

- Existing material Worker mutations share one command and retry boundary.
- Domain stores remain responsible for atomic domain state and domain-specific evidence.
- A crash after a domain commit but before command completion may leave an in-progress envelope. This slice fails closed; durable recovery and reconciliation will be added with the workflow foundation rather than guessing success.
- Historical audit rows remain readable without a command reference.
- The command service is provider-neutral and can later back durable workflows without changing the external envelope contract.
