# ADR 0011: Disposable customer directory projection and purpose-bound inspection

- Status: Accepted
- Date: 2026-08-30

## Context

Atharvan operators need to locate Arth users and workspaces, inspect memberships, and see the permissions Arth has already resolved. Atharvan is not the system of record for customer identity or authorisation, and broad replication would create an unnecessary store for customer-private data.

Search and inspection also expose personal and tenant metadata. Treating those reads as ordinary unaudited list operations would leave no durable evidence of why an operator accessed a customer identity.

## Decision

Arth remains the source of truth. Atharvan stores a bounded, environment-scoped projection containing only:

- user identity, display, lifecycle, verification, and creation metadata;
- workspace identity, organisation, display, lifecycle, and creation metadata;
- membership identity, role label, lifecycle, and Arth-resolved granted, denied, and effective permission sets;
- one monotonic Arth source revision and observation timestamp.

The snapshot mutation accepts at most 500 users, 500 workspaces, and 5,000 memberships. It requires the dedicated sync capability, the singleton Super Administrator, and recent step-up authentication. It enters the shared command envelope. A higher source revision atomically replaces the preceding projection; older or duplicate revisions are ignored. Atharvan never infers effective permissions from role names.

The projection has no columns or request paths for customer code, conversations, prompts, generated output, secrets, tokens, integration credentials, repository contents, or environment values. It is disposable and may be rebuilt from Arth.

The status API reports `unknown` until the first snapshot, `current` for observations no older than 15 minutes, and `stale` afterward. Catalogue presence never implies freshness.

Every search and entity inspection requires an explicit reason and the appropriate user or workspace read capability. The immutable audit event records scope, result counts, source checkpoint, and a normalized-query SHA-256 fingerprint. It does not record the raw query. Inspection records the projected entity ID and whether it was found.

## Consequences

- Operators can inspect memberships and exact effective permissions without direct access to Arth's primary database.
- Search availability depends on a real Arth snapshot producer; Atharvan shows an honest empty `unknown` state until one is connected.
- A full snapshot is intentionally bounded. Pagination or an event-stream reconciler is required before directories exceed those limits.
- Snapshot synchronization initially uses the guarded operator command boundary. A workload identity can replace the actor later without changing the monotonic store contract.
- Restrictions, ownership recovery, internal notes, risk markers, and privileged support access remain separate, later workflows.
