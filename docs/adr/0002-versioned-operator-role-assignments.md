# ADR 0002: Versioned operator-role assignments

- Status: Accepted
- Date: 2026-08-30

## Context

Atharvan needs named staff roles that can be administered without editing code or copying raw capability strings into invitations. Role changes must remain explainable after a role definition evolves, and normal role administration must never mint the singleton Super Administrator or cross the customer-private boundary.

## Decision

Operator roles are immutable, versioned capability bundles stored in PostgreSQL. A role key may have many historical versions but only one active version. Assignments reference an exact definition version, preserving the capability set that was granted.

Invitations select an active role key on the server. The invitation stores the selected role-definition identifier and an immutable capability snapshot. Activation creates the corresponding assignment in the same transaction as operator activation. Older invitations that predate role definitions retain their capability snapshot as a compatibility path until an administrator explicitly replaces the operator's assignments.

The effective authority of a normal operator is the union of active assignments. Replacing assignments is an atomic, audited command that requires the singleton Super Administrator, the `platform:operators:roles:write` capability, a recent step-up authentication event, a reason, and a correlation identifier.

The singleton Super Administrator is not represented by an assignable role definition. Role administration cannot target that account, accept `platform:*`, or grant any capability in the customer-private namespace.

## Consequences

- Role-definition changes create a new version instead of rewriting historical grants.
- Invitations no longer accept client-supplied capability arrays.
- Every assignment and revocation retains actor, reason, correlation, and timestamp evidence.
- Removing all roles is rejected; deactivation is a separate lifecycle command.
- Existing capability-snapshot invitations remain valid during the migration and can be converted through an explicit audited role replacement.
- The database remains provider-neutral PostgreSQL; Neon is the current managed provider.
