# Operator session security

Open **Security** (`/security`) after signing in with a passkey. The page shows
only your active sessions. Browser strings are device-reported and must not be
treated as trusted device identity. The snapshot can become stale; refresh it
before reviewing a suspected unfamiliar session.

To revoke another session, choose **Revoke session**, enter an 8–500 character
reason, and confirm. Passkey verification from the last five minutes is required;
the existing step-up page may ask you to verify and return. Review and submit the
selection again after returning. Use **Sign out** for the current session.

Success ends future authenticated access for the revoked token. Requests already
in progress can finish. If revocation cannot be confirmed due to a network error,
refresh before retrying. Missing/expired/foreign sessions return the same unchanged
result. No session was changed when that result is displayed.

## API and auditing

- `GET /v1/platform/authentication/sessions`: current-first active inventory,
  maximum 100 entries, with an explicit truncation flag and observation time.
- `POST /v1/platform/authentication/sessions/:sessionId/revoke`: reason required;
  identity comes from the authenticated request. An idempotency key uses the
  normal command envelope. The current session cannot be revoked through it.
- Both responses are non-cacheable. Session tokens are omitted from inventory,
  command payloads, and revocation audit evidence.
- The immutable `platform.operator.session_revoked` event is inserted atomically
  with deletion and correlated with `operator.session.revoke` command records.
- Native `/api/auth/list-sessions`, `/revoke-session`, `/revoke-sessions`, and
  `/revoke-other-sessions` are disabled. Normal sign-out remains available.

If the list is truncated, revoke unused sessions and refresh to review older
entries. This is self-service security, not a cross-operator termination tool.
The [architecture decision](../adr/0016-owner-scoped-session-management.md)
documents the intrinsic self-service authority and transaction boundary.

## Validation

Normal validation uses `pnpm test`, `pnpm typecheck`, and `pnpm build`.
When testing resumes, the database scenario requires an isolated, disposable
Neon branch with all current migrations; never point it at the application
database. Supply `ATHARVAN_TEST_DATABASE_URL` securely in the process environment
and set `ATHARVAN_TEST_DATABASE_DISPOSABLE=1`. The legacy
`.env.session-qa.local` file is no longer loaded. To run this scenario alone:

```powershell
$env:ATHARVAN_RUN_SESSION_DB_TESTS = '1'
pnpm --filter @atharvan/db exec vitest run src/operator-sessions.integration.test.ts
Remove-Item Env:ATHARVAN_RUN_SESSION_DB_TESTS
```

The scenario creates random fixture identities, verifies ownership and proof
checks, revokes a fixture session, and forces an audit-write failure to prove
atomic rollback. All fixtures and the failure-injection trigger are rolled back.
The full required suite runs with `pnpm test:integration`; its onboarding scenario
requires a fresh disposable database because it retains its fixture records.
Testing of the current Phase 1 changes is deferred by user instruction; the
evidence below belongs to the earlier session-management slice.

Local evidence on 2026-09-04: 237 normal tests passed, plus this isolated PostgreSQL
scenario. Desktop 1440×1000 and mobile 390×844 browser fixture checks passed failed
read recovery, current-session protection, required reason, cancellation,
confirmation, and post-revocation refresh with no unexpected browser errors or
horizontal overflow. The fixture uses the real component with synthetic session
responses; no real operator session was revoked. Browser plugin not available;
bundled Playwright and installed Chrome were used. Live anonymous `/security`
redirect and API `401` passed. Real passkey onboarding and an authenticated browser
session remain unverified while local email delivery is unconfigured.

An isolated QA branch, `codex-session-security-20260904`
(`br-round-forest-awtq0w1e`, project `restless-lake-36810942`), was created for this
verification. Existing repository migrations were applied there only. The branch
is retained for repeat testing with its compute suspended; its temporary local
connection file was removed.
