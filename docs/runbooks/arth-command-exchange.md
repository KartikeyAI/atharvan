# Arth command exchange

Status: bidirectional implementation is present in Atharvan and the local Arth
checkout; migrations through Atharvan `0021` and Arth `0062` are not applied.
End-to-end verification is deferred.

## Purpose

Atharvan owns operator intent. Arth owns customer identity and enforcement. A
successful Atharvan write creates an immutable desired-state revision, its
outbox command, and its replay receipt in one PostgreSQL transaction. The console continues to show the
request as pending until a signed Arth acknowledgement creates monotonic
observation evidence in the same transaction that completes the outbox record.

The exchange carries customer access restriction revisions, workspace ownership
transfers, model routing controls, integration controls, and adapter release
controls. Payloads contain stable identifiers and the minimum enforcement state.
They contain no customer code, prompts, credentials, tokens, provider secrets,
operator reasons, or approval evidence.

## Endpoints

- `POST /v1/internal/arth/commands/claim` claims one due command for 60 seconds.
  An empty queue returns `204`. A successful claim returns the command payload,
  its SHA-256 digest, an attempt number, and an opaque lease token.
- `POST /v1/internal/arth/commands/{commandId}/acknowledgement` accepts
  `leaseToken`, `outcome`, `sourceRevision`, `observedAt`, and an optional bounded
  message. Outcomes are `applied`, `rejected`, or `retryable_failure`.
- `POST /v1/internal/arth/customer-directory/snapshot` accepts Arth's signed,
  monotonic customer-directory projection. Atharvan records the workload key,
  request nonce, body digest, counts, source revision, and reconciliation outcome
  in immutable ingestion history.

The consumer must apply a command idempotently using the Atharvan command ID as
its operation key. It must persist the effect before acknowledging `applied`.
An acknowledgement lost after commit can be replayed byte-for-byte and returns
the existing terminal result. A different terminal acknowledgement is rejected.

Retryable failures use bounded exponential delay. Ten failed claims or an age of
seven days moves the command to `dead_letter`. Expired leases can be reclaimed;
an active or stale lease token cannot complete another claimant's work.
The protected platform overview reports current backlog, recent rejections,
recent dead letters, missing exchange configuration, and health-read failures.

## Workload authentication

Every request includes:

- `x-atharvan-key-id`
- `x-atharvan-timestamp` as Unix seconds
- `x-atharvan-nonce` as a UUID
- `x-atharvan-content-sha256` as lowercase hexadecimal
- `x-atharvan-signature` as `v1=<lowercase HMAC-SHA256>`

The canonical signed value is the following newline-delimited UTF-8 text:

```text
v1
<UPPERCASE METHOD>
<PATH AND QUERY>
<CONTENT SHA-256>
<UNIX TIMESTAMP>
<NONCE>
<CONFIGURED AUDIENCE>
```

Atharvan accepts 60 seconds of clock skew, limits signed bodies to 1 MiB, checks
the content digest before the signature, and consumes each nonce once in
PostgreSQL. Current and previous keys may overlap during rotation, but their key
identifiers must differ. Configure the current key ID, shared secret and audience
together. Remove the previous pair after every Arth instance has adopted the new
current key.

## Deployment order

1. Review and apply migrations through `0021_arth_platform_controls.sql`.
2. Configure the current key ID, shared secret and exact audience in Atharvan.
3. Deploy Atharvan while the Arth consumer remains disabled; commands queue.
4. Configure the matching values and Atharvan origin in Arth.
5. Deploy one Arth consumer and directory publisher instance, verify snapshot
   ingestion and claim/apply/ack telemetry, then
   scale it. Do not enable enforcement claims before Arth's local receipt and
   policy tables are migrated.
6. Exercise restriction, restoration, ownership transfer, retry, lease expiry,
   replay rejection and key rotation in the authorised test environment.

Never copy the shared secret into configuration tables, logs, command payloads,
audit evidence, support tickets, or this repository.
