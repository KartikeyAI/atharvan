# Platform API and event contracts

Status: Versioned platform contract. The TypeScript domain types and migration
constraints are canonical; this document defines compatibility and transport
rules for clients and workloads.

## Public operator API

All operator endpoints are under `/v1/platform`. Requests use HTTPS and the
passkey-backed Better Auth session. Reads require the documented capability and
return `Cache-Control: no-store` for sensitive/current state. Mutations also
require `Idempotency-Key`; when absent the request correlation UUID is used.
Every response returns `x-request-id` and a W3C `traceparent`. A valid incoming
version-00 trace is continued with a new local span; invalid input starts a new
trace. Request correlation IDs remain the durable command/audit identity.

Every mutation creates a named, versioned command envelope containing actor,
environment, canonical target, expected revision where applicable, safe redacted
payload, correlation ID, reason, and optional approval/evidence references. The
domain effect, immutable audit event, and terminal response commit atomically.
An exact retry returns the stored status/body. Reusing the key for different
input returns `409 idempotency_key_conflict`; concurrent processing returns
`409 command_in_progress`.

Errors use this bounded shape:

```json
{
  "code": "stable_machine_code",
  "message": "Safe operator-facing text.",
  "requestId": "uuid",
  "reason": "optional_bounded_reason"
}
```

`GET /health/live` is process liveness only. `GET /health/ready` returns `200`
with `status`, `environment`, `schemaVersion`, `checkedAt`, and `requestId` after
runtime configuration and the exact writable database schema are verified. All
readiness failures return generic `503 readiness_check_failed` with
`Retry-After: 30`; infrastructure error details are excluded.

The API exposes authentication assurance and sessions; overview and delivery
health; approvals and audit; operator/domain/role/break-glass lifecycle;
configuration and feature flags; secret references; model catalogue/routing;
integrations and adapter releases; commercial products and plan versions;
customer directory projections, restrictions, notes, risk markers, and ownership
transfers. Adding an optional response field
is backward compatible. Removing/renaming a field, changing meaning, loosening an
authority check, or changing an enum requires a new endpoint/command version and
a rolling-deployment compatibility plan.

Audit export bodies remain event-per-line NDJSON. Successful responses include
schema version `1`, environment, generation/range timestamps, byte length, item
count, truncation, lowercase SHA-256, standard `Content-Digest`, and an ETag. The
digest covers the exact UTF-8 response body. The body is limited to 5,000 events
and 16 MiB. Atharvan records an immutable
`platform.audit.exported` event before releasing the response; the event belongs
to the next audit snapshot because selection precedes access recording.

### Commercial catalogue contract

`GET /v1/platform/commercial-catalogue` requires `platform:plans:read` and
returns bounded, environment-scoped products with their current product revision,
plans, current immutable plan version, and recent version history. The response
includes `truncated`; each plan includes `historyTruncated`. Clients must display
these states and cannot infer that omitted records do not exist.

`PUT /v1/platform/commercial-products/{productKey}` and
`PUT /v1/platform/commercial-products/{productId}/plans/{planKey}` require
`platform:plans:write`, recent passkey step-up, a reason, and an idempotency key.
Product changes advance one immutable revision. Plan changes create the next
immutable version; callers do not supply a version number. Lifecycle transitions
are forward-only, and an active plan requires an active parent product.

Fixed prices use a safe integer `unitAmountMinor`, an uppercase three-letter ISO
currency, and `month` or `year`. Free and contract catalogue entries use zero and
no billing interval. A provider price reference is opaque, bounded metadata and
never grants provider authority. The command effect, stable pointer, immutable
version/revision, audit event, and terminal command receipt commit atomically.

`POST /v1/platform/email-recipient-suppressions/{suppressionId}/restore`
requires `platform:security:write`, the active Super Administrator, recent
passkey step-up, a reason, and an idempotency key. It restores eligibility only
for future email and returns the standard atomic command receipt. The delivery
projection exposes active suppression IDs, provider reason, time, and source
delivery identity without recipient address or fingerprint.

### Scheduled health probe contract

Provider and integration revisions may include `healthProbe` with `url`, `GET`
or `HEAD` method, an explicit `expectedStatusCodes` array, `timeoutMs`, and
`intervalSeconds`. Null disables scheduling. The URL is public HTTPS without
credentials, query parameters, or fragments. The Worker does not follow
redirects.

Automated observations add the source value `scheduled_probe`; their
`recordedByOperatorId` is null and their correlation UUID is the durable probe
job ID. `operator_probe` observations continue to require a non-null active
operator. Consumers must tolerate both source values before the scheduler is
deployed.

The protected overview also returns current scheduled-queue alerts. A job older
than two minutes is delayed; a job that exhausts five recoveries is a critical
execution failure for 15 minutes. Terminal jobs record `observation_recorded`,
`target_revision_changed`, or `retry_exhausted` as their bounded outcome.

`PlatformOverview.history` contains separate model-provider and integration
series. Each available series has exactly 24 rolling hourly points ordered
oldest first. A point contains its boundary time, derived status, and mutually
exclusive aggregate counts. A source read failure is `points: null`; clients
must not interpret it as an empty registry. These samples describe stored
evidence at each boundary and do not represent continuous uptime.

### Operational retention contract

The scheduled Worker creates at most one `operational_retention_runs` record per
environment and UTC hour. A claimant increments the attempt, owns a one-minute
lease, and applies at most 1,000 deletions per category. Cleanup and the terminal
run/audit evidence commit atomically. Five failed attempts make the window
terminal. Completed and failed rows are immutable.

`PlatformOverview.operationalRetention` returns the latest run state, latest
successful completion and aggregate category counts, batch saturation, and the
versioned policy inventory. It contains no deleted identifiers, recipient
fingerprints, provider message IDs, or error text. Missing/read-failed evidence,
late execution, terminal failure, and saturation produce current alerts.

## Transactional email provider webhook

`POST /v1/webhooks/resend` is public and authenticates the exact raw request with
the Resend/Svix `svix-id`, `svix-timestamp`, and `svix-signature` headers. The
body limit is 64 KiB and envelope skew is five minutes. Successful, duplicate,
and authenticated unmatched events return `204`; malformed or unauthenticated
requests return a generic `400`; missing configuration returns `503`.

Supported events are `email.sent`, `email.delivered`,
`email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`,
and `email.suppressed`. The durable identity is provider plus event ID. The
provider message ID may match exactly one environment-bound OTP or operational
alert delivery. Raw payload, headers and recipient addresses are outside the
persistence and audit contracts.

## Arth workload API

The internal endpoints are:

- `POST /v1/internal/arth/commands/claim`
- `POST /v1/internal/arth/commands/{commandId}/acknowledgement`
- `POST /v1/internal/arth/customer-directory/snapshot`

Every request is signed using the `v1` HMAC contract in
[`arth-command-exchange.md`](../runbooks/arth-command-exchange.md). The signed
path includes the query string. Bodies are limited to 1 MiB; timestamps permit
60 seconds of skew; UUID nonces are consumed once in PostgreSQL. Authentication
failure is `401`, unconfigured exchange is `503`, a stale/conflicting domain
transition is `409`, an empty claim is `204`, and a successful claim/acknowledgment
is JSON.

Command payloads are a discriminated union with `kind` and positive monotonic
`revisionNumber`:

| Kind                               | Aggregate identity | Enforced state                                    |
| ---------------------------------- | ------------------ | ------------------------------------------------- |
| `customer_restriction`             | `restrictionId`    | Target/capability restricted or restored          |
| `workspace_ownership_transfer`     | `transferId`       | Exact current owner and successor                 |
| `model_routing_control`            | `controlId`        | Provider/model enabled, maintenance, or disabled  |
| `platform_integration_control`     | `integrationId`    | Lifecycle and operational availability            |
| `platform_adapter_release_control` | `releaseId`        | Version, channel, signature/review, and lifecycle |

A claim returns `commandId`, `environment`, payload, SHA-256 payload digest,
opaque lease token, lease expiry, and attempt number. Arth persists the effect and
its local command receipt before acknowledging. Acknowledgement includes the exact
lease token, `applied|rejected|retryable_failure`, source revision, observation
time, and optional safe message. Delivery is at least once; consumers must be
idempotent. No payload may include credentials, prompts, source code, customer
content, operator reasons, approval evidence, or session data.

Directory snapshots are complete, monotonic projections for one environment and
source. Their canonical digest covers users, workspaces, memberships, ownership,
counts, source revision, and source observation time. A duplicate identical
revision is idempotent; a changed duplicate, stale revision, invalid owner, or
cross-environment source is rejected.

## Schema and compatibility ownership

Atharvan owns command/event schemas; Arth owns enforcement implementation. A
producer change lands first with consumers able to ignore optional fields. A new
required field or enum value requires Arth support before Atharvan emits it.
During rollback, the older producer must remain able to read all persisted rows
created by the newer schema. Migration rollback never deletes command, audit,
approval, occurrence, delivery, or observation evidence.
