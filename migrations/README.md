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

`0002_operator_sessions.sql` creates Better Auth's isolated `auth` schema and links an Atharvan operator to one auth user. It remains additive and does not grant access to Arth or customer-private data.

`0003_operator_roles.sql` adds immutable, versioned operator-role definitions, audited role assignments, and an optional invitation-to-role reference. It seeds only system role definitions; it does not grant a role to any operator or broaden the Super Administrator wildcard. Existing activated invitations continue to resolve their immutable capability snapshots until an explicit role assignment replaces that legacy path.

`0004_platform_configuration_registry.sql` adds typed non-secret configuration definitions, append-only revisions, and current platform/environment bindings. It seeds declared operational defaults but no overrides. A PostgreSQL trigger rejects revision updates or deletion, while current bindings may move forward only through the audited command path. Secret-like keys are rejected by both application validation and a database constraint.

`0005_platform_secret_references.sql` adds provider-neutral secret-reference and version metadata. It stores provider identifiers and lifecycle evidence only; no credential value, ciphertext, digest, or preview exists in PostgreSQL. Delete triggers preserve lifecycle history.

`0006_model_provider_catalogue.sql` adds environment-scoped providers, immutable provider/model revisions, integer model pricing, data-classification limits, and append-only expiring provider-health observations. Provider credentials are foreign-key references to secret metadata and never embedded in catalogue revisions. Delete triggers preserve all catalogue and health history.

`0007_model_routing_operations.sql` adds immutable routing-policy revisions and ordered targets, deterministic rollout weights, and explicit provider/model operational controls. Maintenance windows expire safely, while kill switches remain disabled until an audited re-enable revision.

`0008_platform_integration_registry.sql` adds environment-scoped platform integrations, immutable OAuth/application metadata revisions, secret-reference bindings, declared adapter capabilities and scopes, bounded maintenance controls, and append-only expiring health evidence. It contains no customer installation, access token, repository, code, environment, or secret material.

`0009_platform_adapter_registry.sql` adds environment-scoped adapter releases and immutable review/control revisions. Every release declares the complete eight-capability maturity matrix, permissions, typed configuration fields, commands, supported environments, compatibility, required secret purposes, health checks, package digest, signing evidence, security review, channel, lifecycle, and deprecation/block state. A trigger prevents a package name or digest from changing under an existing semantic version.

`0010_platform_feature_flags.sql` adds owned, environment-scoped feature flags with immutable revisions, bounded typed targeting rules, review and expiry metadata, and emergency containment state.

`0011_platform_command_audit.sql` adds named/versioned command envelopes, secret-safe payload and idempotency fingerprints, optional approval/evidence references, append-only terminal results, and command linkage on audit events. PostgreSQL triggers reject updates and deletion across command, result, and audit history. The migration is additive: historical audit rows remain valid with a null command reference.

`0012_customer_directory_projection.sql` adds disposable, environment-scoped projections of Arth users, workspaces, and memberships plus a monotonic source checkpoint. Projected permissions are copied from Arth rather than inferred, sensitive searches and inspections are audited without retaining search terms, and no customer code, chats, credentials, secrets, environment values, or integration tokens are stored.

`0013_customer_access_restrictions.sql` adds immutable capability-scoped customer restriction intent and append-only Arth reconciliation observations. Atharvan never reports a restriction as applied until the source observation matches the desired revision.

`0014_customer_operations.sql` adds explicit projected workspace ownership, controlled ownership-transfer requests and observations, append-only internal notes, and immutable risk-marker revisions. It stores operational metadata only and rejects secret-like note content before PostgreSQL.

Before its first production application, rollback is deletion of the disposable Atharvan database or restoration of its pre-migration snapshot. After production data exists, do not drop these tables as a rollback. Restore from the provider snapshot when data recovery is required, or ship a reviewed forward-fix migration.
