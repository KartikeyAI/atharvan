# Atharvan — Technical Contract

Version: 1.0  
Status: Accepted technology baseline  
Repository: `KartikeyAI/atharvan`

## 1. Purpose

This file records the binding technology and implementation decisions for Atharvan. It complements `SOURCE_OF_TRUTH.md`:

- `SOURCE_OF_TRUTH.md` defines what Atharvan is and what it must do.
- `tech.md` defines how Atharvan is built.
- `progress.md` records what has actually been completed and verified.

Changes to this contract require an explicit decision-log entry. Convenience alone is not sufficient reason to bypass a boundary recorded here.

## 2. Stack summary

| Area | Selected technology | Contract |
| --- | --- | --- |
| Language | TypeScript | Strict mode; no untyped domain boundaries |
| Package manager | pnpm | Workspace lockfile is committed and CI uses frozen installs |
| Repository | pnpm workspace + Turborepo | Modular monorepo with explicit application/package boundaries |
| Full-stack framework | TanStack Start (React) | Routing, layouts, server functions, server routes, and middleware |
| Deployment runtime | Cloudflare Workers | Primary production runtime for web and control-plane edges |
| Platform API | Hono | Explicit service/API boundary for Arth and operator commands |
| UI system | shadcn/ui | Components and blocks are stored as application source |
| Styling | Tailwind CSS with semantic design tokens | No raw one-off colours for product state |
| Forms | TanStack Form + Zod | Typed form state plus server-side schema validation |
| Server state | TanStack Query | Query caching, invalidation, loading, partial, and error states |
| Tables | TanStack Table | Large operational datasets, sorting, filtering, and pagination |
| Charts | shadcn Chart/Recharts | Operational charts use accessible, reusable chart configuration |
| Database provider | Neon | A dedicated Atharvan Neon project/database, separate from Arth |
| Database engine | PostgreSQL | Atharvan depends on PostgreSQL capabilities, not Neon-only product APIs |
| Database layer | `@atharvan/db` with Drizzle ORM | Provider-neutral PostgreSQL schema, queries, transactions, and migrations |
| Neon runtime driver | `@neondatabase/serverless` | Hidden behind the database package connection adapter |
| Portable driver contract | `pg`/node-postgres compatible adapter | Allows another PostgreSQL provider without domain-layer rewrites |
| Authentication | Better Auth | App-owned sessions and identity data in Atharvan PostgreSQL |
| First-login verification | Better Auth email OTP flow plus Atharvan invitation policy | Single-use code activates an invited operator |
| Privileged authentication | Passkeys/WebAuthn plus step-up policy | Required for privileged operator access after activation |
| Validation | Zod | Inputs, configuration, environment bootstrap, events, and API contracts |
| Unit/integration tests | Vitest | Domain, policy, database, and server tests |
| Browser/E2E tests | Playwright | Authentication and critical operator workflows |
| Observability | OpenTelemetry | Traces, metrics, structured logs, and correlation IDs |
| Code quality | ESLint + Prettier | Deterministic CI enforcement |

Versions are pinned in the lockfile when implementation begins. This document intentionally records technology choices rather than fast-aging version numbers.

## 3. Repository architecture

The initial monorepo layout is:

```text
atharvan/
├── apps/
│   ├── console/            # TanStack Start operator application
│   └── worker/             # Hono service/API and Workers event entrypoints
├── packages/
│   ├── auth/               # Better Auth configuration and Atharvan access policy
│   ├── config/             # Typed bootstrap and versioned configuration contracts
│   ├── db/                 # PostgreSQL schema, adapters, queries, and migrations
│   ├── domain/             # Domain entities, commands, policies, and events
│   ├── email/              # Transactional email interface and provider adapter
│   ├── observability/      # Logs, traces, metrics, audit correlation
│   ├── ui/                 # Shared shadcn components, blocks, and tokens
│   └── testkit/            # Factories, fixtures, policy and integration helpers
├── migrations/             # Ordered PostgreSQL migrations owned by @atharvan/db
├── docs/
│   ├── adr/                # Architecture decision records
│   └── runbooks/           # Operated recovery and incident procedures
├── SOURCE_OF_TRUTH.md
├── tech.md
└── progress.md
```

This is a modular control-plane monolith. Domain modules share deployment infrastructure initially, but cross-module calls use explicit interfaces. Customer code never executes inside either Atharvan application.

## 4. Database contract

### 4.1 Isolation from Arth

Atharvan uses a separate Neon project and separate PostgreSQL database from Arth. It has independent:

- credentials and secret references;
- migration history;
- backups and restore exercises;
- connection limits and pooling;
- retention and access policy;
- observability and incident handling.

There are no cross-database joins, shared schemas, shared migration histories, or direct foreign keys between Arth and Atharvan.

When Atharvan needs Arth data, it calls a versioned, authorised Arth platform API or consumes an approved event/projection. It must not connect directly to Arth's database.

### 4.2 PostgreSQL provider portability

Neon is the initial managed provider; PostgreSQL is the application contract.

All database access goes through `@atharvan/db`. Application and domain modules must not import `@neondatabase/serverless`, `pg`, or a provider SDK directly.

The package exposes application-oriented units of work and repositories, not a global unbounded SQL client. Its internal connection factory supports:

- a Neon serverless adapter for Cloudflare Workers;
- a standard PostgreSQL adapter compatible with `pg` for development, migrations, maintenance, tests, and future providers.

Provider-specific capabilities such as Neon branching may be used only behind an optional capability interface. Core correctness, migrations, backups, and production operation cannot require them.

### 4.3 ORM and migrations

Drizzle ORM defines PostgreSQL tables, relations, typed queries, and migrations.

Rules:

- PostgreSQL-compatible DDL is the source of truth.
- Migrations are ordered, immutable after production application, and recorded in the database.
- Production schema changes run through an audited migration workflow.
- Destructive changes use expand/migrate/contract sequencing.
- Application startup never performs uncontrolled schema mutation.
- Migration locks prevent concurrent application.
- CI verifies a clean database can migrate from zero and that supported upgrades succeed.
- Rollback, forward-fix, and restore procedures are documented per material migration.
- Row-level tenant identifiers remain present where data is scoped, even though Atharvan is internal.

### 4.4 Canonical versus derived data

PostgreSQL stores canonical transactional state. Search, reporting, counters, dashboards, and health summaries may use derived projections, but those projections must be rebuildable.

Audit events, financial ledger entries, usage records, entitlement versions, approval evidence, invitations, and security actions are append-only or correction-based. They are not silently rewritten.

## 5. Application and API contract

### 5.1 TanStack Start

TanStack Start is the operator console framework. It owns:

- file-based routes and nested layouts;
- authenticated and unauthenticated route groups;
- server rendering where useful;
- server functions for type-safe console interactions;
- server routes for web-facing callbacks when appropriate;
- middleware for authentication, correlation, policy context, and redaction;
- loader boundaries and route-level error handling.

No browser code is trusted to enforce permissions. Route visibility improves usability; Hono/server command authorisation provides security.

### 5.2 Hono control-plane API

Hono provides the explicit API surface for:

- commands initiated by Atharvan;
- service-to-service requests from Arth;
- provider webhooks and callbacks;
- health and readiness endpoints;
- event ingestion and reconciliation triggers;
- versioned external or automated operator contracts.

TanStack Start server functions may call domain services directly within the deployment or use Hono contracts when a stable service boundary is required. Business rules remain in shared domain modules, not duplicated between route systems.

### 5.3 Command discipline

Material mutations are named commands with:

- authenticated actor;
- effective capability set;
- target and expected version;
- validated payload;
- reason and correlation ID;
- optional approval and evidence;
- idempotency key where retry is possible;
- structured result;
- audit event and domain event.

Direct dashboard-to-database mutations are prohibited.

## 6. UI contract

### 6.1 shadcn-first implementation

Atharvan uses shadcn/ui components and ready-to-use blocks as the first choice for all interface work. This includes official or explicitly approved registry blocks for:

- dashboard shell and application sidebar;
- authentication and email-code pages;
- charts and metric cards;
- data tables and filters;
- settings and configuration forms;
- command palettes;
- alerts, empty states, skeletons, and dialogs.

Blocks are added through the shadcn CLI using the repository's package manager. Their source becomes part of `packages/ui` or the owning application, is reviewed after generation, and is adapted to Atharvan's domain without breaking composition or accessibility.

Before building custom markup, engineering must search the configured shadcn registries. Custom UI is justified only when the existing component/block set cannot express the operator workflow.

### 6.2 Composition rules

- Use shadcn primitives and complete component composition rather than styled generic elements.
- Use semantic tokens for background, foreground, border, status, warning, and destructive states.
- Use component variants before local style overrides.
- Use `FieldGroup`, `Field`, and accessible descriptions for forms.
- Use `AlertDialog` for destructive confirmations.
- Use `Skeleton`, `Empty`, `Alert`, `Badge`, `Spinner`, and `sonner` for standard states and feedback.
- Use shadcn Chart around Recharts rather than a parallel chart abstraction.
- Every dialog, drawer, and sheet has an accessible title.
- Every operational page implements loading, empty, partial, degraded, forbidden, failure, retry, and success states using real data.
- Responsive behaviour is required, but critical operator tables may use intentional horizontal scrolling rather than hiding material columns.

### 6.3 Visual direction

Atharvan is an internal operational product. The interface should be restrained, information-dense without being cramped, and optimised for trustworthy decisions.

- Reuse the selected shadcn dashboard and authentication blocks rather than designing decorative custom shells.
- Keep navigation stable and predictable.
- Prioritise state, evidence, actor, scope, time, and available action.
- Dangerous actions are visually distinct and never placed as accidental primary actions.
- Unknown and stale states are visually different from healthy states.
- Dark and light modes use the same semantic token system.
- No fake statistics, placeholder charts, decorative activity feeds, or mock success states ship.

## 7. Authentication and operator lifecycle

### 7.1 Closed membership

Atharvan has no public signup. Creating an operator requires an authorised invitation.

An invitation contains:

- exact normalised email address;
- organisation and intended role/capabilities;
- inviter;
- issue and expiry time;
- single-use token fingerprint;
- status and audit correlation;
- optional approval reference.

An unknown email cannot self-create an account by requesting an OTP.

### 7.2 Organisation email-domain allowlist

Atharvan maintains an active allowlist of organisation-controlled email domains.

Rules:

- email comparison uses a normalised exact domain, not suffix substring matching;
- the allowlist is checked at invitation creation, OTP issuance, invitation acceptance, and activation;
- personal/public email domains are denied unless explicitly and deliberately added as an organisation-controlled exception;
- subdomains are not implicitly allowed unless the parent rule explicitly includes verified subdomains;
- removing a domain prevents new invitations and activations immediately;
- existing users from a removed domain are flagged for review and handled according to the configured suspension policy;
- allowlist changes require Super Administrator authority, step-up authentication, reason, and audit;
- at least one valid domain must remain unless the system is deliberately placed in membership-lockdown mode.

Nobody can add or activate a user outside the organisation allowlist.

### 7.3 First-login verification

Operator lifecycle states are:

```text
invited -> verification_pending -> active
        -> expired
        -> revoked

active -> suspended -> active
active -> deactivated
```

On the first valid sign-in attempt for an invited address:

1. Atharvan rechecks the invitation and domain allowlist.
2. It sends a short-lived email verification code to the exact invited address.
3. Only a hash/fingerprint of the code is stored.
4. The user submits the code within the allowed time and attempt limit.
5. Verification atomically consumes the code and activates the account.
6. The activation, session, actor, invitation, device/network metadata, and policy result are audited.
7. The user enrols a passkey or other required phishing-resistant factor before privileged console access.

Codes are single-use, expire quickly, have attempt and resend limits, and cannot be replayed. Responses do not reveal whether an arbitrary email is invited. Email delivery uses the `@atharvan/email` adapter so the transactional provider can be changed without authentication-domain rewrites.

### 7.4 Sessions

Better Auth stores identity and session state in Atharvan PostgreSQL through the database boundary.

- Cookies are secure, HTTP-only, same-site, and narrowly scoped.
- Session rotation follows authentication and privilege changes.
- Role, restriction, domain, and user-status changes invalidate or re-evaluate active sessions.
- Privileged commands require a recent step-up assertion.
- Session and OTP endpoints are rate-limited by identity and network signals.
- Recovery is operator-controlled, audited, and cannot bypass domain membership.

## 8. Singleton Super Administrator

### 8.1 Invariant

Exactly one active operator account holds the Super Administrator designation.

It is enforced in both places:

- the PostgreSQL schema uses a singleton ownership record/constraint so a second active holder cannot be committed;
- the domain command layer rejects creation, assignment, deletion, deactivation, or transfer that would produce zero or multiple active holders.

The initial Super Administrator is established through a one-time deployment bootstrap. After bootstrap, ordinary environment changes cannot silently replace it. Transfer is an explicit, step-up-authenticated, audited workflow that atomically activates the successor and removes the predecessor's designation.

### 8.2 Authority

The account receives wildcard authority over the platform namespace:

```text
platform:*
```

This includes Atharvan configuration, staff, models, provider applications, plans, billing administration, runners, releases, flags, incidents, and platform security.

### 8.3 Hard privacy boundary

`platform:*` does not match the customer-private namespace. The Super Administrator has no inherited permission to read or retrieve:

- customer chats or prompts;
- customer repositories, branches, diffs, or source code;
- customer integration connections, tokens, or connected-account contents;
- customer environment variables or secret values;
- customer environment files, runtime contents, database contents, or private logs;
- model context containing customer-private content;
- private execution artefacts.

This boundary is enforced in APIs, queries, projections, exports, logs, and observability—not only by hiding UI routes.

When a legitimate support case requires private customer access, a separate customer-consented, purpose-bound, scoped, expiring support grant is used. Super Administrator status does not auto-approve or inherit that grant.

### 8.4 Operational protection

- The singleton account must use a passkey/security key and recovery controls.
- Sensitive actions require step-up authentication and may still require a second operator approval.
- The account cannot disable its own audit trail, privacy boundary, or singleton invariant.
- Daily work should use a narrower operator account; the singleton exists for platform ownership, high-level configuration, and recovery.
- All Super Administrator reads and writes of sensitive platform metadata are audited.

## 9. Secrets and configuration

Deployment configuration contains only boot-critical values. Normal product and operational configuration is versioned control-plane state.

Boot values include:

- Atharvan database URL/reference;
- secret-manager/KMS bootstrap identity;
- encryption-root reference;
- initial Super Administrator email/bootstrap token;
- runtime environment and service identity;
- immutable public origins and service bindings;
- telemetry bootstrap destination.

Rules:

- Secrets are stored in a dedicated secret manager; PostgreSQL stores references and metadata.
- Existing secret plaintext is never returned through UI or API.
- Client bundles never receive server-only environment values.
- Zod validates boot configuration before the application becomes ready.
- Configuration changes use versioning, actor, reason, rollout, and rollback metadata.
- Provider credentials are scoped per environment and purpose.

## 10. Durable work and provider operations

External mutations and long-running tasks use durable, idempotent workflows. This includes billing reconciliation, OAuth rotation, runner lifecycle, deployment rollback, data deletion, exports, support grants, and incident actions.

Every workflow has:

- durable state;
- idempotency and deduplication;
- retry classification and bounded backoff;
- cancellation or containment behaviour;
- approval waits where required;
- structured failure data;
- audit/event correlation;
- provider-state reconciliation;
- dead-letter handling and safe replay.

## 11. Observability

OpenTelemetry is the common instrumentation boundary.

- Every request, command, workflow, event, and provider call carries a correlation ID.
- Logs are structured and redact secrets, codes, tokens, and customer-private payloads.
- Metrics distinguish healthy, degraded, partial, unknown, and stale states.
- Traces record service timing without capturing customer-private content by default.
- Audit events are domain evidence, not a substitute for application logs; logs are not a substitute for audit events.
- Readiness checks cover database, migrations, configuration, secret manager, event/workflow infrastructure, and required provider dependencies.

## 12. Testing contract

### 12.1 Required layers

- Unit tests for domain invariants, policies, capability matching, and redaction.
- PostgreSQL integration tests against a real ephemeral PostgreSQL database.
- Migration tests from clean state and supported prior versions.
- API contract tests for Hono routes and TanStack server functions.
- Authentication tests for invitation, allowlist, OTP, activation, passkeys, sessions, suspension, and recovery.
- Property/concurrency tests for singleton Super Administrator and one-time code consumption.
- Webhook tests for signature, replay, duplication, and out-of-order events.
- Playwright E2E tests for critical operator workflows.
- Accessibility tests for authentication, navigation, forms, tables, dialogs, and destructive actions.
- Operated canaries for runner isolation, cleanup, revocation, and provider reconciliation.

### 12.2 Mandatory security cases

Tests must prove that:

- a second Super Administrator cannot be created, including under concurrency;
- the singleton cannot be accidentally removed without a successful transfer;
- `platform:*` does not grant customer-private permissions;
- customer-private data cannot appear in list/search/detail projections or logs;
- an uninvited email cannot create an account or obtain a usable code;
- a disallowed domain cannot be invited, verified, or activated;
- an OTP cannot be reused or raced successfully;
- expired, revoked, or over-attempt codes fail safely;
- suspension and capability changes affect existing sessions;
- client-side route manipulation cannot bypass server authorisation;
- secret values cannot be read back.

## 13. Dependency and implementation rules

- Prefer stable, documented APIs and pin resolved versions in `pnpm-lock.yaml`.
- Framework and provider SDKs do not enter domain modules.
- No direct database driver imports outside `@atharvan/db`.
- No direct transactional email SDK imports outside `@atharvan/email`.
- No direct secret-provider SDK imports outside the secrets adapter.
- No generated shadcn block is accepted without reading and reviewing the added source.
- No raw SQL in route or UI modules.
- No `any` at security, command, event, database, or provider boundaries.
- No hidden environment-dependent authorisation decisions.
- No mock operational data in production bundles.
- No production feature is marked complete without tests, telemetry, recovery behaviour, and `progress.md` evidence.

## 14. Provider-switch tests

Database portability is considered real only when CI can run the core database contract against:

1. Neon through the Neon serverless adapter; and
2. standard PostgreSQL through the portable adapter.

The contract suite covers migrations, transactions, constraints, pagination, locking/concurrency behaviour, JSON and timestamp handling, error mapping, and critical repositories. Optional Neon capabilities are tested separately and cannot be required by core domain tests.

## 15. Technical decision test

Before accepting a new dependency or architectural exception, ask:

- Does it preserve the PostgreSQL provider boundary?
- Does it run correctly on the selected Cloudflare/TanStack execution model?
- Does it keep provider SDKs outside domain logic?
- Does it preserve server-side authorisation and customer privacy?
- Does shadcn already provide the required UI primitive or block?
- Can it be tested deterministically?
- Can it be observed, operated, upgraded, and removed?
- Does it introduce a second source of truth?

If a required boundary is violated, record and approve an ADR before implementation.

## 16. Canonical closing statement

Atharvan is built as a TypeScript, TanStack Start, shadcn/ui, Cloudflare Workers control plane with its own Neon-hosted PostgreSQL database behind a provider-neutral database package. Its singleton Super Administrator owns the platform plane, never the customer's private software-development plane, and every other operator enters through organisation-domain allowlisting, invitation, first-login email verification, and strong privileged authentication.

