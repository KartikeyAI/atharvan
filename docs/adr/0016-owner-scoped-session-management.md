# ADR 0016: Owner-scoped operator session management

Date: 2026-09-04
Status: Accepted for local implementation

## Decision

Every active, passkey-authenticated operator can inspect their own active sessions
and revoke another owned session. The authenticated Worker context grants the
intrinsic `platform:authentication:sessions:self` capability after resolving the
active operator. This authority applies only to self-service session commands;
it does not permit selecting another user or administering another operator.
Roles and the platform wildcard cannot expand the SQL ownership boundary.

The authenticated request supplies both the user ID and current session ID.
Neither identity is accepted from request parameters or JSON. The inventory
projects only IDs, timestamps, sign-in method, and bounded device/IP metadata;
session tokens are never returned by the new inventory or written to its audit
events. Device metadata is untrusted display text. Inventory reads are bounded
to 100 entries with current-first ordering and explicit truncation.

Revocation requires a reason and recent passkey proof, enters the existing named
command/idempotency envelope, and protects the requesting session. A PostgreSQL
data-modifying CTE rechecks ownership, active operator linkage, current-session
existence/expiry, and the five-minute passkey proof before deleting the target.
The same statement inserts `platform.operator.session_revoked` audit evidence.
If that insert fails, deletion rolls back. Missing, expired, foreign, or otherwise
unavailable targets all produce `unchanged`; responses do not reveal ownership.

Native Better Auth list/revoke/revoke-all/revoke-other-session HTTP endpoints are
disabled so clients cannot bypass the projection and audit contract. Normal
sign-out and authentication remain supported. Cookie session caching remains
disabled; subsequent authenticated requests consult the session store. Requests
already authorized before revocation may finish.

## Consequences

No migration is needed: the implementation uses existing auth/session, operator,
command, and audit tables. Command completion and the mutation audit are separate
records using the existing command framework; the deletion-specific audit is
atomic even if envelope completion later fails. Retrying the target is safe.

The Security page requires confirmation and a reason, supports passkey step-up,
and refreshes after revocation. An uncertain network result instructs the operator
to refresh. It does not promise remote device control or immediate cancellation
of in-flight work. Administrative cross-operator session termination is outside
this slice and must not reuse the self-service authority.

## Verification

API tests cover identity derivation, limited-role self-service, anonymous/OTP
denial, recent-proof enforcement, current-session protection, validation, and
command-envelope use. Native auth endpoint tests verify those routes are disabled.
The isolated PostgreSQL contract verifies foreign-session isolation, stale/absent
proof rejection, repeat-safe revocation, and rollback after a forced audit failure.
All its fixtures and temporary trigger changes roll back.
