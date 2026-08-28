# Atharvan

Atharvan is the private, audited operator control plane for running Arth.

The canonical product, technical, and delivery contracts are:

- [`SOURCE_OF_TRUTH.md`](./SOURCE_OF_TRUTH.md)
- [`tech.md`](./tech.md)
- [`progress.md`](./progress.md)

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
packages/db     PostgreSQL/Drizzle provider boundary
packages/ui     Shared shadcn configuration and UI source
```

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Copy `.env.example` to a local, ignored environment file only when exercising provider-backed features. Never commit credentials.
