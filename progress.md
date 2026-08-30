# Atharvan Progress

Last updated: 2026-08-30  
Current phase: Repository and technical foundation  
Overall status: Phase 0 in progress

## Status legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete and verified
- `[!]` Blocked
- `[-]` Deferred or out of current scope

An item may be marked complete only when its implementation, tests, operational evidence, and relevant documentation satisfy the definition of done in `SOURCE_OF_TRUTH.md`.

## Current blockers

- GitHub Actions still fails the `validate` job before assigning a runner or executing any steps, including on run `33282855327` attempt 2 on 2026-08-30. The user deferred Actions/deployment investigation until the remaining development slices are complete.
- The GitHub `development` environment now contains the database, Better Auth, verification, Super Administrator, email-from, and Cloudflare secrets shown by the user. Their values remain unreadable and operationally unverified because Actions cannot allocate a runner.
- Resend is the first replaceable transactional-email adapter. Live OTP delivery remains fail-closed until `RESEND_API_KEY` is added to the `development` environment and the sender domain is verified. Development and production public origins also remain placeholders until deployment configuration resumes.
- The dedicated `atharvan-development` Neon project is provisioned and migrations `0000`, `0001`, and `0002` are live. Better Auth's five isolated auth tables, the unique operator identity link, and the Drizzle history hash were verified on PostgreSQL 18.
- Rendered browser sign-off is pending: the Cloudflare Vite development/preview runtime cannot start in this container because network-interface enumeration fails, and the hosted browser blocks loopback URLs. Source validation, route generation, and production builds are unaffected.

## Phase 0 — Product and repository foundation

- [x] Draft canonical `SOURCE_OF_TRUTH.md`.
- [x] Approve canonical product scope.
- [x] Define canonical technology stack in `tech.md`.
- [x] Commit `SOURCE_OF_TRUTH.md` to `main`.
- [x] Commit `tech.md` to `main`.
- [x] Commit `progress.md` to `main`.
- [x] Inspect repository defaults, branches, and existing contents.
- [x] Define monorepo structure and package boundaries.
- [~] Add coding, testing, migration, and security conventions.
- [x] Configure CI for formatting, migration validation, type-checking, tests, and production builds.
- [x] Define the boot-only environment and secret bootstrap contract.
- [x] Record initial architecture decision records.

### Phase 0 exit evidence

- [x] Approved source-of-truth commit SHA recorded: `522ff93953bd3461c40bc982312a5f018e998c11`.
- [ ] CI passes on `main`.
- [ ] Local development and test setup reproduced from a clean checkout.
- [x] No plaintext credentials or production secrets are stored in the repository.

## Phase 1 — Safe administrative foundation

### Operator identity and access

- [x] Implement operator identity domain.
- [x] Implement the singleton Super Administrator invariant and `platform:*` authority.
- [x] Enforce hard customer-private data denies outside the platform wildcard namespace.
- [~] Implement capability-based permissions and default role bundles.
- [~] Enforce server-side authorisation on every operator command.
- [~] Implement organisation email-domain allowlist administration.
- [x] Reject invitations and activation when the email domain is not allowed.
- [x] Implement invited-to-active first-login email verification code flow.
- [ ] Add mandatory strong MFA/passkey policy.
- [~] Add step-up authentication for sensitive actions.
- [ ] Add break-glass grant lifecycle with expiry and review.

### Configuration and secrets

- [ ] Implement versioned platform configuration registry.
- [ ] Implement configuration precedence and validation.
- [ ] Implement secret-reference abstraction.
- [ ] Implement credential create/rotate/revoke flows without read-back.
- [ ] Define boot-only environment configuration.

### Audit and command foundation

- [ ] Implement named/versioned command envelope.
- [~] Implement immutable operator audit events.
- [~] Add reason, correlation, approval, and evidence fields.
- [ ] Add audit search and export.
- [ ] Verify audit coverage for all Phase 1 mutations.

### Users and workspaces

- [ ] Implement user/workspace search and inspection.
- [ ] Display memberships and effective permissions.
- [ ] Implement granular restrictions and restoration.
- [ ] Implement controlled ownership recovery/transfer contracts.
- [ ] Implement internal notes and risk markers.

### Models, integrations, and flags

- [ ] Implement model/provider catalogue and health.
- [ ] Implement model routing, fallback, maintenance, and kill switches.
- [ ] Implement platform integration and OAuth application registry.
- [ ] Implement adapter lifecycle and capability registry.
- [ ] Implement feature flags with targeting, ownership, expiry, and history.

### Platform overview

- [ ] Implement health projections from real telemetry.
- [ ] Implement runner, workflow, model, integration, and incident summaries.
- [~] Implement unknown/partial/degraded data states.
- [ ] Add operational alerts for critical foundation failures.

### Phase 1 exit evidence

- [ ] Routine configuration changes require no redeployment.
- [ ] Routine operator actions require no direct database edits.
- [ ] Secret values cannot be retrieved through Atharvan.
- [ ] Every material mutation is authorised and audited.
- [ ] Critical capabilities have tested kill switches.

## Phase 2 — Commercial and execution operations

### Plans, entitlements, and billing

- [ ] Implement products and immutable plan versions.
- [ ] Implement entitlement snapshots and custom enterprise grants.
- [ ] Implement subscriptions and billing-provider reconciliation.
- [ ] Implement invoices, payments, refunds, disputes, and credits.
- [ ] Add signed webhook receivers and replay protection.

### Usage, quotas, and costs

- [ ] Define the canonical meter catalogue.
- [ ] Implement append-only usage ingestion and aggregation.
- [ ] Implement workspace/project attribution.
- [ ] Implement soft limits, hard limits, alerts, and enforcement.
- [ ] Implement AI, runner, preview, storage, and network cost reporting.

### Runners and workflows

- [ ] Implement managed runner pool inventory and health.
- [ ] Implement private runner registration and revocation.
- [ ] Verify runtime isolation, egress, secret scope, and resource limits.
- [ ] Implement drain, disable, capacity, and certificate rotation operations.
- [ ] Implement workflow/queue/dead-letter inspection and safe commands.

### Environments and deployments

- [ ] Implement environment and release inventory.
- [ ] Implement deployment status, policy blocks, rollout, and rollback visibility.
- [ ] Implement preview expiry and idle shutdown.
- [ ] Implement orphan/resource cleanup and reconciliation.
- [ ] Implement provider outage and drift visibility.

### Phase 2 exit evidence

- [ ] Meter totals reconcile against provider/source records.
- [ ] Billing webhook replay and out-of-order delivery are tested.
- [ ] Limits are enforced consistently under concurrency.
- [ ] Runner isolation and cleanup canaries pass in an operated environment.
- [ ] Deployment rollback and provider reconciliation are verified live.

## Phase 3 — Production governance and support

### Support and privileged access

- [ ] Implement support cases and escalation.
- [ ] Implement customer-consented, scoped, expiring support access.
- [ ] Implement redacted diagnostic bundles.
- [ ] Implement safe account recovery.
- [ ] Link support cases to platform entities and incidents.

### Security and abuse

- [ ] Implement structured security cases and evidence.
- [ ] Implement granular identity, workspace, integration, provider, and execution restrictions.
- [ ] Integrate authentication, rate-limit, runner, malware, and secret-leak signals.
- [ ] Implement investigation retention and review workflows.
- [ ] Verify tenant-isolation evidence and alerting.

### Incidents and production evidence

- [ ] Implement incident declaration, roles, timeline, containment, and recovery.
- [ ] Implement customer-visible status and maintenance communication.
- [ ] Implement production-control evidence records.
- [ ] Implement passed/failed/skipped/waived status with expiring waivers.
- [ ] Implement post-incident review and action tracking.

### Enterprise governance

- [ ] Implement SSO/SCIM administration.
- [ ] Implement advanced approvals and separation of duties.
- [ ] Implement data export, retention, deletion, and legal holds.
- [ ] Implement residency and private-runner operations.
- [ ] Implement compliance evidence export.

### Phase 3 exit evidence

- [ ] Privileged support access automatically expires and is fully audited.
- [ ] A representative incident is exercised end-to-end.
- [ ] Production readiness is generated only from deterministic evidence.
- [ ] Data export and deletion are tested against all owned stores/providers.
- [ ] Break-glass access is tested and post-event review is enforced.

## Cross-cutting quality gates

- [x] No fake data, placeholder metrics, or mock operational success states in the foundation operator shell.
- [x] No client-side-only authorisation in implemented routes.
- [x] No plaintext authentication code, secret storage, or read-back.
- [ ] No ad hoc database mutation path for routine operations.
- [ ] No high-impact external mutation without idempotency and reconciliation.
- [ ] No production-affecting command without audit and recovery/containment.
- [ ] Accessibility checks pass for operator-critical workflows.
- [~] Loading, empty, partial, failure, retry, and success states are tested.
- [ ] Schema migrations are forward-safe and have rollback/recovery procedures.
- [ ] Operational dashboards and alerts are backed by real telemetry.

## Decision log

| Date       | Decision                                                                                                                                       | Status   | Reference                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------- |
| 2026-08-28 | Atharvan will be the internal operator control plane for Arth, separate from customer workspace/project administration.                        | Accepted | `SOURCE_OF_TRUTH.md`            |
| 2026-08-28 | Environment variables will bootstrap the platform; normal operational and commercial configuration will live in versioned control-plane state. | Accepted | `SOURCE_OF_TRUTH.md`            |
| 2026-08-28 | The initial implementation will use a modular control-plane monolith with explicit domain boundaries.                                          | Accepted | `SOURCE_OF_TRUTH.md`            |
| 2026-08-28 | Atharvan will use a separate Neon-hosted PostgreSQL database through a provider-neutral database package.                                      | Accepted | `tech.md`                       |
| 2026-08-28 | TanStack Start and shadcn/ui blocks/components are the application and UI foundation.                                                          | Accepted | `tech.md`                       |
| 2026-08-28 | Exactly one Super Administrator may hold `platform:*`; customer-private resources remain outside that wildcard.                                | Accepted | `SOURCE_OF_TRUTH.md`, `tech.md` |
| 2026-08-28 | Operator membership is invitation-only, domain-allowlisted, and activated by a first-login email verification code.                            | Accepted | `tech.md`                       |

## Work log

| Date       | Work completed                                                                                                                                                                                                | Verification                                                                                                                                                                                   | Commit/PR                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026-08-28 | Drafted, approved, and committed the initial source-of-truth.                                                                                                                                                 | User approval and GitHub commit                                                                                                                                                                | `522ff93953bd3461c40bc982312a5f018e998c11` |
| 2026-08-28 | Defined and committed the technical stack and privileged-access boundaries.                                                                                                                                   | GitHub commit                                                                                                                                                                                  | `3ebf7d3cf4f3326de98d711571437a3425b09e8b` |
| 2026-08-28 | Built the initial monorepo, operator shell, platform worker, database boundary, CI, and branch-driven deployment workflow.                                                                                    | Formatting, type-check, 9 tests, and production builds                                                                                                                                         | `6364d34f3c3ecd2fb609d241627c0d661152d87c` |
| 2026-08-28 | Published the first development slice and removed duplicate/reusable workflow coordination as failure variables.                                                                                              | Exactly `dev` and `main`; GitHub run `33204688336` failed before runner allocation                                                                                                             | `4425a46daa51951facbf3fa7849865539445b9a2` |
| 2026-08-28 | Added operator allowlist, invitation, verification-code, email-adapter, transactional Neon, and immutable migration foundations.                                                                              | Formatting, migration history check, 28 tests, 7-workspace type-check, and production builds                                                                                                   | `f1e85ebc793382dc57dda4cc86137fc90379428f` |
| 2026-08-28 | Implemented onboarding application commands and the PostgreSQL transactional adapter for bootstrap, domain changes, invitation, challenge issuance/delivery tracking, attempt locking, and atomic activation. | Formatting, migration history check, 39 local tests, 8-workspace type-check, production builds, and one PostgreSQL concurrency test wired for CI                                               | `1a0fcc83197232b4dba83f56676d3917ccfbe77e` |
| 2026-08-30 | Provisioned the separate `atharvan-development` Neon PostgreSQL 18 project and applied immutable migrations `0000` and `0001`.                                                                                | Six live tables, both Drizzle migration hashes, singleton Super Administrator index, active-state constraint, and pending-challenge index verified through Neon                                | External development environment           |
| 2026-08-30 | Added Better Auth email-OTP sessions, policy-gated user/session hooks, server-side protected routes, Resend delivery, the operator identity link, and ADR 0001.                                               | Formatting, migration consistency, 51 local tests, 8-workspace type-check, both production bundles, and live Neon migration `0002` verification                                                | `4126c821a74ad055292b574622342228deff9723` |
| 2026-08-30 | Added the first usable operator-administration surface: same-origin service-binding proxy, sign-in UI, operator directory/invitations, domain rules, safe read projections, and audited mutations.            | Formatting, migration consistency, 55 local tests, 8-workspace type-check, TanStack route generation, and both production bundles; rendered QA remains blocked by local preview infrastructure | `0aec0bc999c707339e23503baf47eec35788808b` |
