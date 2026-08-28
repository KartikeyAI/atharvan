# Atharvan — Source of Truth

Version: 0.2  
Status: Approved canonical baseline  
Repository: `KartikeyAI/atharvan`  
Relationship: Internal management and operations control plane for Arth

## 1. Purpose

Atharvan is the secure internal control plane used by authorised Arth personnel to configure, operate, support, secure, commercialise, and govern the Arth platform without relying on routine code changes, database edits, or environment-variable changes.

Atharvan exists because Arth cannot be operated safely in production when pricing, entitlements, model routing, integration availability, quotas, feature rollout, incident response, and customer support depend on deployments or manual intervention.

Atharvan is not the customer-facing Arth workspace or project settings experience. Customer administration remains part of Arth. Atharvan manages Arth itself.

## 2. Canonical product statement

> Atharvan is the audited operator control plane for running Arth as a secure, reliable, commercially manageable production platform.

## 3. Relationship to Arth

Arth is an AI-native, Git-native software engineering and delivery control plane. Atharvan is the internal system through which the Arth team operates that platform.

The boundaries are:

| Surface                       | Users                              | Responsibility                                                                                                     |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Atharvan                      | Authorised Arth operators          | Platform-wide configuration, operations, support, security, billing, governance, and incident response             |
| Arth workspace administration | Customer workspace owners/admins   | Members, workspace policies, budgets, integrations, models, runners, billing, and approvals within their workspace |
| Arth project administration   | Customer project admins/developers | Repositories, environments, secrets, deployments, adapters, checks, observability, and project autonomy            |

Atharvan may inspect or affect customer resources only through explicit, permission-checked operator workflows. It must never bypass Arth's tenant isolation or authorisation model.

## 4. Product principles

1. **No unaudited material action.** Every sensitive read and every state mutation must produce an immutable audit record.
2. **No routine database editing.** Operators use versioned domain commands and durable workflows, never ad hoc production SQL.
3. **No plaintext secret retrieval.** Atharvan stores and displays secret references and metadata; existing secret values cannot be read back.
4. **Least privilege by default.** Staff receive narrowly scoped roles. One singleton Super Administrator exists for platform ownership and recovery, but daily operation must use narrower roles.
5. **Step-up security for sensitive actions.** High-impact operations require recent strong authentication and, where policy requires, a second approver.
6. **Support access is exceptional.** Access to customer code, logs, executions, or configuration requires a reason, scope, expiry, ticket reference, and audit trail. Customer approval can be required by policy.
7. **Configuration is versioned.** Material configuration changes retain previous values, actor, reason, rollout, and rollback information.
8. **External mutations are durable and idempotent.** Provider, billing, deployment, and integration operations use retry-safe workflows with reconciliation.
9. **Evidence precedes claims.** Health and production-readiness states must be backed by deterministic evidence, not model confidence or cosmetic UI status.
10. **Environment variables only bootstrap the platform.** Ordinary commercial and operational configuration belongs in the control plane.
11. **Separation of duties.** Billing, security, runtime, support, models, releases, and auditing can be independently authorised.
12. **Reversibility is mandatory.** Production-affecting actions require rollback, recovery, containment, or an explicit irreversible-action approval flow.
13. **Customer-private data is outside wildcard authority.** No platform role, including Super Administrator, inherits access to customer chats, repositories/code, customer integration connections or credentials, secrets, environment variables, or environment contents.

## 5. Non-goals

Atharvan will not:

- replace the customer-facing Arth application;
- become a general-purpose database editor;
- expose stored secrets to operators;
- provide silent user impersonation;
- bypass workspace or project authorisation;
- place generated application execution inside the operator web process;
- treat feature flags as permanent configuration storage;
- report fake, inferred, or placeholder operational metrics;
- allow arbitrary mutation of workflow or billing history;
- make production/provider changes without audit and policy evaluation;
- become a second source of truth for customer-owned code or infrastructure.

## 6. Primary operator roles

| Role                 | Intended authority                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Super Administrator  | Singleton platform-owner account with `platform:*`; hard-denied from customer-private data and customer-side resources |
| Platform Viewer      | Read non-sensitive operational state                                                                                   |
| Support Agent        | Account and billing support without customer code or secret access                                                     |
| Support Engineer     | Time-limited, scoped diagnostic access                                                                                 |
| Billing Operator     | Plans, subscriptions, invoices, credits, and billing reconciliation                                                    |
| Integration Operator | OAuth applications, webhooks, adapters, and provider connection health                                                 |
| Model Operator       | Model catalogue, provider health, routing, pricing, and availability                                                   |
| Runtime Operator     | Runner fleets, queues, previews, execution capacity, and cleanup                                                       |
| Security Operator    | Abuse controls, restrictions, investigations, and security incidents                                                   |
| Release Manager      | Platform releases, feature rollouts, maintenance, and rollback                                                         |
| Auditor              | Read audit events, policy results, and compliance evidence                                                             |
| Break-glass Operator | Time-bound emergency authority requiring strong authentication and post-event review                                   |

Permissions are capability based. Role names are default bundles, not hard-coded authorisation shortcuts. The Super Administrator is the only exception to ordinary role bundling: exactly one active account may hold it, enforced by the database and command layer. Its wildcard covers Atharvan and Arth platform administration only. Customer-private capabilities are a separate namespace and are never matched by `platform:*`.

Any consent-based customer support access is an explicit, scoped, expiring grant. It is not inherited from Super Administrator or any other platform role.

## 7. Functional scope

### 7.1 Platform overview

Atharvan provides real-time and historical visibility into:

- user, workspace, and project growth;
- agent executions and ChangeSets;
- workflow queue depth, failures, retries, and dead letters;
- runner capacity, health, utilisation, and isolation verification;
- previews and deployments;
- model latency, availability, errors, tokens, and spend;
- integration and webhook health;
- usage, revenue, outstanding payments, and cost exposure;
- security, abuse, and tenant-isolation signals;
- incidents and degraded platform capabilities;
- production-readiness evidence.

Dashboard data must come from canonical or reconciled operational sources. Unknown data is displayed as unknown, never replaced with generated sample data.

### 7.2 Users, organisations, and workspaces

Operators can:

- search and inspect users, organisations, workspaces, memberships, and effective permissions;
- inspect lifecycle, verification, plan, entitlement, usage, integration, and security state;
- restrict individual capabilities or suspend and restore an account/workspace;
- handle ownership recovery and controlled workspace transfer;
- initiate export, retention, deletion, and legal-hold workflows where authorised;
- attach internal support notes and risk markers;
- open a consent-based, time-limited support session.

Restrictions are granular: login, new executions, provider mutations, production deployments, integrations, runner access, or the entire workspace can be independently controlled.

### 7.3 Plans, pricing, subscriptions, and entitlements

Atharvan manages:

- products and plan versions;
- monthly, annual, enterprise, and grandfathered commercial terms;
- currencies, taxes, trials, coupons, credits, and negotiated contracts;
- included seats, AI allowance, runner minutes, preview hours, storage, retention, deployments, governance, private runners, and premium adapters;
- overage and enforcement policies;
- subscriptions, invoices, payments, refunds, disputes, and webhook reconciliation.

Plan, entitlement, usage, limit, and credit are separate domain concepts. Assigning a plan creates a versioned entitlement snapshot. Editing a plan must not silently rewrite existing customer contracts.

### 7.4 Usage, quotas, and cost controls

Metering covers:

- model tokens, calls, embeddings, and agent runs;
- runner CPU, memory, duration, and concurrency;
- previews and browser/E2E minutes;
- storage, artifacts, retention, and network use;
- deployments and provider operations;
- indexing and observability ingestion.

Each meter declares its unit, source, aggregation period, attribution, pricing rule, soft threshold, hard threshold, and enforcement behaviour. Corrections and credits are additive records; historical usage is not silently overwritten.

### 7.5 Models and AI providers

Atharvan manages:

- provider records and secret references;
- model catalogue and lifecycle;
- capabilities, context/output limits, regions, pricing, and rate limits;
- task suitability and default routing;
- fallback chains and circuit breakers;
- allowed data classifications and private-processing requirements;
- health, maintenance, staged rollout, and global disablement;
- platform-supplied credentials and workspace BYOK policy.

Every AI output retains model and provider provenance. Workspace and project policies may narrow the platform model policy but cannot expand it.

### 7.6 Integrations and adapter registry

Atharvan operates platform OAuth applications, webhooks, and adapters for source control, cloud, deployment, databases, authentication, observability, payments, and other providers.

For each integration it tracks:

- environment-specific client registration;
- callback and webhook configuration;
- declared scopes and permissions;
- secret and signing-key references;
- token refresh and revocation health;
- installation/connection counts;
- adapter version and capability declaration;
- health checks, maintenance, rollout, and kill switches.

Adapters require signed packages, permission declarations, configuration schemas, compatibility data, security review, versioning, and deprecation policy before activation.

### 7.7 Runners and execution infrastructure

Atharvan manages:

- managed runner pools and private runner registrations;
- regions, runtime types, OCI images, and resource classes;
- capacity, queue depth, concurrency, and execution limits;
- sandbox isolation and RuntimeClass verification;
- egress policies, network isolation, and secret scoping;
- preview expiry and idle shutdown;
- cleanup canaries and orphan detection;
- runner identities, certificate rotation, drain, disable, and revocation;
- structured execution failures and artefact retention.

Execution remains in Arth's isolated execution plane. Atharvan controls and observes it; Atharvan does not execute customer code in its application process.

### 7.8 Workflows and jobs

Operators can inspect queued, scheduled, running, approval-blocked, retrying, failed, cancelled, dead-lettered, and completed workflows.

Authorised commands include retry, cancel, pause a workflow class, drain a queue, replay an idempotent event, reconcile provider state, and repair derived projections. Commands do not directly rewrite workflow state.

### 7.9 Environments, deployments, and releases

Atharvan provides platform-wide visibility into:

- preview, staging, and production environments;
- deployments, releases, rollouts, rollbacks, and drift;
- provider and regional status;
- blocked production changes and their policy evidence;
- orphaned or expired resources;
- cleanup and reconciliation failures.

Production-affecting operator commands require reason, authorisation, evidence, confirmation, and a rollback or containment strategy.

### 7.10 Feature flags and configuration rollout

Flags can target environment, region, plan, workspace, user, internal staff, beta cohort, or percentage rollout. Every flag has an owner, purpose, default, targeting rules, creation time, review/expiry time, audit history, and kill switch.

Flags control rollout; they are not a substitute for durable product configuration. Stale flags are automatically reported.

### 7.11 Security, trust, and abuse

Atharvan surfaces and controls:

- authentication and authorisation anomalies;
- rate-limit violations and automated abuse;
- runner misuse, malware, and resource theft indicators;
- secret leakage and redaction failures;
- integration scope changes and webhook signature failures;
- tenant-isolation test results;
- IP, identity, workspace, provider, and execution restrictions;
- security findings, investigations, and incidents.

Security actions use structured case records, evidence, retention, and review—not free-form hidden flags alone.

### 7.12 Audit, policy, and production evidence

Every material event records actor, effective role, target, command, prior/resulting state or references, reason, request/correlation ID, session and network metadata, approval, timestamp, evidence, automation provenance, and rollback/compensating action where relevant.

Production controls are reported as passed, failed, skipped, or waived. Waivers require an authorised approver, reason, scope, evidence, and expiry. Browser appearance and model confidence are never accepted as deterministic evidence.

### 7.13 Support and incident operations

Atharvan includes:

- support cases and internal notes;
- safe account recovery;
- customer-consented diagnostic access;
- redacted diagnostic bundles;
- linkage to users, workspaces, executions, ChangeSets, releases, and incidents;
- customer-visible incident state where appropriate;
- credits, refunds, and escalation workflows;
- incident command, containment, recovery, and post-incident evidence.

### 7.14 Notifications and platform communication

Operators can manage:

- transactional notification templates and versions;
- operational alert routing;
- incident and maintenance communication;
- in-product announcements;
- recipient policy and delivery health;
- localisation and rollback of template changes.

Marketing campaigns are outside Atharvan's initial scope.

## 8. Configuration model

Configuration precedence is explicit:

1. secure deployment bootstrap;
2. platform configuration;
3. plan entitlements;
4. workspace policy;
5. project policy;
6. environment configuration;
7. execution-scoped override.

Lower levels may choose among or narrow higher-level allowances. They cannot bypass platform security, commercial entitlements, or mandatory policy.

Only boot-critical values remain in deployment configuration:

- database bootstrap connection;
- secret-manager/KMS bootstrap identity;
- encryption-root reference;
- service-to-service identity;
- deployment environment name;
- immutable platform bindings and public service origins;
- telemetry bootstrap destination;
- initial operator/bootstrap recovery mechanism.

Models, prices, limits, adapter availability, routing, feature rollout, and normal operational policies must be changeable without redeploying Atharvan or Arth.

## 9. Security architecture

Atharvan requires:

- separate operator authentication and session policy;
- mandatory phishing-resistant MFA/passkeys for privileged users;
- capability-based RBAC with explicit deny support;
- step-up authentication for sensitive operations;
- optional IP and device restrictions;
- short-lived support access grants;
- two-person approval for configured critical actions;
- CSRF, replay, and session fixation protection;
- signed webhooks and short-lived provider credentials;
- field-level redaction and purpose-bound access;
- append-only audit export;
- encrypted data in transit and at rest;
- rate limiting, abuse protection, and anomaly alerting;
- tested break-glass access with automatic expiry and review.

Atharvan is closed to public registration. An operator account can be created only through an authorised invitation to an email whose domain is on the active organisation-domain allowlist. The allowlist is enforced when an invitation is created, when it is accepted, and when the first session is activated.

An invited account begins in `invited` state. On its first sign-in attempt, Atharvan sends a short-lived, single-use verification code to the exact invited address. The account becomes `active` only after successful code verification. Codes are hashed at rest, rate-limited, attempt-limited, non-reusable, and protected from account enumeration. Subsequent privileged access requires the configured strong-authentication policy.

No frontend route, hidden URL, client-provided role, or database flag is an authorisation boundary. Every command is authorised by the Hono control-plane API.

## 10. Technical architecture

Atharvan follows the established Arth architecture:

- TanStack Start operator application deployed on Cloudflare Workers;
- Hono API/control-plane modules on Cloudflare Workers;
- Neon PostgreSQL for canonical transactional state;
- dedicated secret-management system for secret material;
- durable workflow system for long-running and external mutations;
- object storage for evidence and diagnostic artefacts;
- structured events and observability for operational projections;
- independent Arth runner/execution plane;
- monorepo with explicit module boundaries.

Suggested logical modules:

- operator identity and access;
- platform configuration;
- users and workspaces;
- plans and entitlements;
- billing and payments;
- usage and quotas;
- models and routing;
- integrations and adapters;
- runners and capacity;
- workflows and jobs;
- deployments and environments;
- releases and feature flags;
- security and abuse;
- support and incidents;
- audit and evidence;
- notifications;
- observability and reporting.

A modular control-plane monolith is preferred initially. Modules may share deployment and database infrastructure, but domain ownership and interfaces must remain explicit.

## 11. Command and event model

All material mutations use named, versioned commands. Examples:

- `workspace.restrict-execution`
- `workspace.restore-execution`
- `entitlement.assign`
- `credit.grant`
- `model.disable`
- `integration.enter-maintenance`
- `runner.drain`
- `workflow.retry`
- `deployment.request-rollback`
- `support-access.grant`
- `incident.declare`

Successful state changes emit versioned, idempotent events. Consumers must tolerate duplicates and out-of-order delivery where applicable. External provider state is reconciled rather than assumed from one API response.

## 12. Data integrity rules

- Canonical state resides in PostgreSQL; dashboard projections are disposable and rebuildable.
- Audit events, usage records, ledger entries, entitlement versions, and approval evidence are append-only.
- Financial corrections use credits, debits, reversals, or adjustments rather than history deletion.
- Secret records contain references, fingerprints, versions, scopes, and rotation metadata—not retrievable values.
- Sensitive support access and break-glass grants always expire.
- Deletion is a durable workflow with retention, provider cleanup, evidence, and recovery-window handling.
- All tenant-owned records carry and enforce tenant identity even in internal tooling.

## 13. Initial release phases

### Phase 1 — Safe administrative foundation

- repository and engineering foundation;
- operator authentication and capability-based RBAC;
- configuration registry and version history;
- secret-reference integration;
- immutable administrative audit trail;
- user/workspace inspection and lifecycle restrictions;
- feature flags and rollout rules;
- model/provider registry;
- integration/adapter registry and health;
- real system-health dashboard.

Exit condition: routine platform configuration and emergency capability restrictions no longer require direct database edits or application code changes.

### Phase 2 — Commercial and execution operations

- products, plan versions, and entitlement snapshots;
- subscriptions, billing providers, and webhook reconciliation;
- usage metering, quotas, credits, and enforcement;
- AI and runtime cost accounting;
- runner fleet and capacity management;
- workflow, queue, and dead-letter operations;
- environment, deployment, and preview operations;
- cleanup, expiry, and provider reconciliation.

Exit condition: Arth can measure, bill, limit, and operate its paid platform workloads from reconciled production data.

### Phase 3 — Production governance and support

- support cases and consent-based diagnostic access;
- incident command and status communication;
- abuse and security operations;
- evidence-backed production certification;
- advanced approvals and separation of duties;
- data export, retention, deletion, and legal holds;
- enterprise SSO/SCIM administration;
- residency, private-runner, and enterprise policy operations;
- break-glass workflow and compliance reporting.

Exit condition: Arth can be securely supported, governed, audited, and recovered as an enterprise-capable production service.

## 14. Definition of done

A capability is not complete merely because a page exists. It is complete only when:

1. domain state and invariants are defined;
2. permission checks exist at the API boundary;
3. sensitive fields are redacted;
4. the command is validated and idempotent where required;
5. an audit event is created;
6. external state is reconciled;
7. failure, retry, and cancellation behaviour is tested;
8. operator UI represents loading, empty, partial, failure, and success states using real data;
9. observability and alerts exist;
10. rollback, recovery, or containment is documented and tested;
11. automated tests pass;
12. progress and evidence are recorded in `progress.md`.

## 15. Product decision test

Before adding or changing a capability, ask:

- Does it help authorised operators run Arth safely?
- Does it preserve tenant isolation and customer ownership?
- Does it replace manual/code/env operation with an audited contract?
- Is the action permission-checked, evidence-backed, and reversible?
- Does it avoid exposing secrets or granting excessive staff access?
- Is canonical state clear and reconcilable?
- Can the capability be operated during partial provider failure?
- Does it remain within Atharvan rather than duplicating customer-facing Arth settings?

If the answer to a required safety or boundary question is no, the capability must not ship in its current form.

## 16. Canonical closing statement

Atharvan is not an admin dashboard layered over Arth's database. It is the secure, audited, policy-enforced operating system through which the Arth team runs the Arth platform.
