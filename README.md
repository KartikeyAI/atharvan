# Atharvan

Atharvan is the private, audited operator control plane for running Arth.

The canonical product, technical, and delivery contracts are:

- [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md)
- [`tech.md`](./tech.md)
- [`progress.md`](./progress.md)

Remaining work and phase acceptance gates are compiled in the
[three-phase production delivery plan](docs/production-delivery-plan.md).

Phase 1 operational contracts are maintained in the
[threat model](docs/security/threat-model.md),
[platform interface contract](docs/contracts/platform-interfaces.md),
[deployment environment runbook](docs/runbooks/deployment-environments.md),
[deployment readiness runbook](docs/runbooks/deployment-readiness.md), and
[service/recovery objectives](docs/runbooks/service-level-objectives.md). See the
[audit export runbook](docs/runbooks/audit-exports.md) for evidence integrity and
access recording.

## Branch policy

- `main` contains approved production releases.
- `dev` contains active development and receives a development deployment after each verified slice.

No other long-lived or short-lived repository branches are used.

## Workspace

```text
apps/console    TanStack Start operator console
apps/worker     Hono service and webhook boundary on Cloudflare Workers
packages/config Typed bootstrap configuration
packages/domain Domain contracts, capabilities, and policy
packages/auth   Operator onboarding application commands and persistence ports
packages/commercial Commercial catalogue commands and persistence ports
packages/db     PostgreSQL/Drizzle provider boundary
packages/email  Provider-neutral transactional email boundary
packages/ui     Shared shadcn configuration and UI source
```

## Local development with Neon

Use Node 24+ and the repository-pinned pnpm version. Copy `.env.example` to
`.env.local` in the repository root and enter the dedicated Atharvan development
Neon connection string and authentication settings. Docker is not required.

```bash
pnpm install --frozen-lockfile
pnpm local:check
pnpm dev
```

`local:check` validates settings and verifies existing database schema contracts
in a read-only transaction. It does not migrate, seed, or send email.

`dev` starts the console at `ATHARVAN_PUBLIC_ORIGIN` (normally
`http://localhost:3000`) and the Worker at `http://127.0.0.1:8787`, with the
development service binding. Ctrl+C stops both. At least 256 MiB must be free on
the repository and temporary-file drives; additional space may be needed for
dependencies and builds.

Resend can remain unset while developing. Real invitation/OTP delivery and
first-time activation require its key. Passkey and permission requirements
remain enforced. Secrets Store settings are optional and must be supplied as a
complete set when enabled.

See [the local development runbook](docs/runbooks/local-development.md) for
credential handling, troubleshooting, and database-test boundaries.

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm migration:check
pnpm typecheck
pnpm test
pnpm build
```

The normal test and migration commands do not automatically load `.env.local`.
The opt-in [overview read-only check](docs/runbooks/platform-overview.md) loads it
explicitly and uses SELECT-only fixtures inside a read-only transaction.
Never commit credentials or run the stateful integration scenario against a
shared development or production database.

With a disposable PostgreSQL database configured, validate the executable migration path with:

```bash
pnpm db:migrate
pnpm migration:verify
```
