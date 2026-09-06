# Local development with hosted PostgreSQL

## Start and stop

1. Install Node 24+ and run `pnpm install --frozen-lockfile`.
2. Copy the root `.env.example` to `.env.local` and populate the required fields.
3. Set `ATHARVAN_ENVIRONMENT=development` and a loopback public origin, normally `http://localhost:3000`.
4. Run `pnpm local:check` to validate configuration, database connectivity, and migrated schema contracts.
5. Run `pnpm dev`. The console and Worker start together; Ctrl+C stops both.

Neon is the configured PostgreSQL provider. No local Docker service is needed.
The loopback origin is used for authentication and WebAuthn, so the console must
use that exact hostname and port. A conflicting port is an error, not permission
to silently choose another origin. The Worker listens on port 8787, with a
separate inspector on 9230.

## Credential boundary

The launcher reads the explicit root `.env.local`, validates it with the existing
authentication schema, omits blank optional provider settings, and ignores
unknown keys. Ambient application/cloud credentials are not inherited by either
child process. Only OS, certificate, and proxy settings needed by local tools
are retained. The console does not receive database or authentication secrets.

Validated Worker bindings are written to a unique ignored `.wrangler/local`
session directory with owner-only file permissions on POSIX and inherited user
directory permissions on Windows. Wrangler receives the file path through
`--env-file`; credential values never appear in command arguments. The launcher
removes the session file after normal shutdown or startup failure. A forced
process termination or power loss may leave a session directory behind; remove
only abandoned session directories after confirming no development process is
using them. Never inspect or paste their contents into logs or reports.

Local `.dev.vars*` files are also ignored. The managed launcher explicitly selects
its Worker bindings rather than relying on app-directory dotenv precedence.
Avoid separate app-directory environment files when using the managed launcher.

Cloudflare's [environment-variable documentation](https://developers.cloudflare.com/workers/local-development/environment-variables/)
describes the underlying dotenv loading and secret masking behavior.

## Provider readiness

- `DATABASE_URL`: dedicated Atharvan development Neon database, including the provider's SSL settings.
- `BETTER_AUTH_SECRET` and `ATHARVAN_VERIFICATION_HMAC_SECRET`: separate random strings of at least 32 characters.
- `ATHARVAN_SUPER_ADMIN_EMAIL`: approved operator identity; not a fabricated test user.
- `ATHARVAN_EMAIL_FROM`: configured sender identity.
- `RESEND_API_KEY`: optional until exercising email verification. Missing delivery configuration does not bypass activation or passkey policy.
- `RESEND_WEBHOOK_SECRET`: optional until exercising signed provider feedback. Keep it independent from the API and auth secrets.
- Secrets Store account, store, and API token: all three or none. Presence is not evidence that provider permissions work.

The read-only check queries schema metadata inside `BEGIN READ ONLY`, with
connection/query timeouts and connection cleanup. It does not bootstrap an
operator, apply migrations, inspect customer records, test email delivery, or
verify secret-provider permissions. Errors do not print raw connection details.

The running application retains its normal operator bootstrap behavior when
authentication endpoints are accessed. Local requests operate on the configured
development database; stopping the server does not revert legitimate application
actions.

## Test and migration boundaries

`pnpm test` runs the normal suite. `pnpm test:integration` is the required uncached
database suite in CI. Set `ATHARVAN_TEST_DATABASE_URL` explicitly and acknowledge
the target with `ATHARVAN_TEST_DATABASE_DISPOSABLE=1`. Use a fresh, fully migrated,
disposable Neon branch/database: the onboarding scenario retains fixtures and
must not run against a shared database. The guard rejects reuse of the application
host recorded in `.env.local`, including Neon pooled/direct endpoint aliases.
The runner does not load `.env.local` credentials into tests or use `DATABASE_URL`
as a mutation target. It enables the individual database scenarios itself.
Neither `pnpm dev` nor `pnpm local:check` exports credentials into future shell
commands or runs the integration scenario automatically.

Testing is currently deferred at the user's request. Migration
`0017_scoped_approvals.sql` and `0018_verification_email_outbox.sql` must be applied
in a dedicated verification environment before exercising the new controls and
OTP delivery. They have not been applied
to the configured development database in this implementation execution.

Existing `pnpm db:migrate` and `pnpm migration:verify` commands retain their
explicit process-environment contract for CI. The reusable migration verifier
also uses a read-only transaction. Migrations remain a separate deliberate step.

## Troubleshooting

- Missing/invalid settings: fix the named fields in root `.env.local` and restart.
- Database check failure: check Neon availability, network access, connection details, and existing migration state. Never paste the connection string into diagnostics.
- Low disk space / `SQLITE_FULL`: local Workers still need scratch storage even with hosted PostgreSQL. Free space on both the repository and temporary-file drives. The launcher refuses startup below 256 MiB.
- Port unavailable: stop the conflicting local process or change the console origin to another allowed loopback port; do not change the hostname only in the browser.
- Missing email key: unit tests and non-email development remain available; invitation/OTP delivery cannot complete.
- Failed child process: the launcher stops its sibling and cleans up its temporary bindings. Re-run after correcting the reported cause.

## Verification evidence — 2026-09-04

The supplied Neon database passed read-only schema verification. The local
settings tests cover optional providers, origin validation, secret-safe errors,
credential serialization, and isolation from ambient cloud/Vite settings.
An initial Windows startup failed with `SQLITE_FULL`; sibling shutdown and
temporary binding cleanup completed. After cache cleanup restored more than
14 GiB of free space, both local servers started successfully. HTTP smoke checks
verified Worker liveness `200`, console login HTML `200`, anonymous protected
overview `401` through the service binding, and session resolution `200` with
`null`. Rendered browser interaction and end-to-end authentication remain
unverified; email delivery is still deferred.
