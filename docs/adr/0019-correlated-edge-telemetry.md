# ADR 0019: Correlated edge telemetry

Status: accepted, 2026-09-05.

## Decision

Every HTTP request accepts a valid W3C version-00 `traceparent` or creates a new
trace, creates a local span, and returns `traceparent` plus `x-request-id`.
Structured completion and failure records contain timestamp, service,
environment, request ID, trace/span identity, method, route template, status,
outcome, and duration. They exclude headers, queries, bodies, credential values,
error messages, and stack traces.

Every scheduled trigger creates a run ID and root span. Each durable task emits a
child-span completion or categorical failure record, followed by the trigger
result. Queue state remains canonical in PostgreSQL; logs support correlation but
do not replace durable audit, observation, or delivery evidence.

## Consequences

Operators can join an API response, command/audit correlation UUID, Worker log,
and scheduled task without exposing request content. Distributed exporters may
consume the W3C identifiers later without changing the public trace contract.
