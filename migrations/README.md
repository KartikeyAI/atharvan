# Atharvan database migrations

This directory is the ordered, immutable PostgreSQL migration history owned by `@atharvan/db`.

## Rules

- Generate migrations from `packages/db/src/schema.ts` with `pnpm --filter @atharvan/db migration:generate`.
- Review generated SQL before committing it. Never use schema push in shared environments.
- Never edit a migration after it has been applied outside a disposable development database. Add a forward migration instead.
- `pnpm db:migrate` obtains the Atharvan PostgreSQL advisory lock before applying outstanding migrations and records history in `atharvan_migrations.history`.
- CI migrates an empty PostgreSQL database and verifies critical tables and partial unique indexes.
- Deployment applies migrations before application code. Material changes must follow expand, migrate, contract sequencing.

## Baseline recovery

`0000_operator_onboarding.sql` only creates the initial Atharvan-owned types, tables, constraints, and indexes; it does not modify Arth or any customer database.

`0001_atomic_operator_onboarding.sql` adds audit correlation to verification challenges and prevents the singleton Super Administrator designation from being held by an inactive operator. Its nullable-add/backfill/not-null sequence keeps upgrades safe when challenge rows already exist.

Before its first production application, rollback is deletion of the disposable Atharvan database or restoration of its pre-migration snapshot. After production data exists, do not drop these tables as a rollback. Restore from the provider snapshot when data recovery is required, or ship a reviewed forward-fix migration.
