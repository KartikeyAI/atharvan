# ADR 0001: Operator authentication boundary

- Status: Accepted
- Date: 2026-08-30
- Owners: Atharvan platform engineering

## Context

Atharvan needs invitation-only operator authentication, a singleton Super Administrator, immediate suspension enforcement, and a hard boundary from Arth customer-private data. The existing onboarding commands already own invitations, domain policy, operator status, capabilities, and audit evidence. Better Auth is the approved identity and session system.

Maintaining a separate custom verification endpoint alongside Better Auth would create two competing code, user, and session lifecycles.

## Decision

- Better Auth owns email OTP verification, auth users, sessions, accounts, and rate-limit state in the dedicated PostgreSQL `auth` schema.
- Atharvan owns operator eligibility, invitations, domain allowlisting, activation, capabilities, suspension, and audit events in its platform tables.
- The only public first-login path is Better Auth email OTP. The previous custom challenge application commands remain internal and are not exposed as Worker routes.
- OTP issuance returns a generic success response for ineligible identities without storing or delivering a code.
- Better Auth user creation rechecks Atharvan eligibility. Session creation invokes the transactional Atharvan activation/link command.
- Protected platform requests validate the Better Auth database session and then resolve the active operator and current capabilities from PostgreSQL. Cookie-cached sessions are disabled.
- `platform:*` remains incapable of matching any `customer-private:*` capability.
- Better Auth's tables have no connection to Arth's database or customer-owned data.

## Consequences

- There is one login code and one session authority.
- Domain removal, invitation expiry, suspension, and deactivation are enforced server-side.
- A Better Auth session alone never grants platform authority; it must resolve to an active Atharvan operator.
- Email delivery is replaceable behind `@atharvan/email`. The first adapter is Resend and remains fail-closed until its API key is configured.
- Passkeys, strong MFA policy, step-up sessions, and default role bundles remain later Phase 1 slices.
