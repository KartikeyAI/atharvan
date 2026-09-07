# Deployment readiness

## Signals

`/health/live` confirms only that the Worker can execute. `/health/ready` checks
the full runtime configuration and canonical Neon boundary without mutating
state. A successful response includes `status: ready`, the environment,
`schemaVersion: 29`, `checkedAt`, and a request ID.

A `503 readiness_check_failed` response intentionally combines configuration,
connectivity, migration, trigger, read-only, and privilege failures. Use Worker
telemetry and the release job to identify the failing boundary without returning
infrastructure details to the caller.

## Promotion

Configure `ATHARVAN_CONTROL_PLANE_ORIGIN` as a protected GitHub environment
variable containing the deployed Worker's public HTTPS origin. The deploy job:

1. applies the reviewed migration history;
2. synchronizes runtime configuration;
3. deploys the Worker;
4. retries readiness across propagation and transient network failures;
5. validates the expected environment and schema version;
6. deploys the console only after success.

If the gate fails, leave the console release unchanged. Confirm the environment
variable points to the Worker, check that migration `0029` is the recorded head,
run the migration contract against the destination, and confirm the runtime
database role is writable with the required table privileges. Apply a forward
fix for schema problems; do not forge migration history or weaken the readiness
contract.

## Migration updates

Every new migration must update the version, journal timestamp, and file hash in
`packages/db/src/readiness.ts`, plus both deployment expectations. The static
migration check rejects a mismatch before deployment.
