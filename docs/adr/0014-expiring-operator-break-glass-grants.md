# ADR 0014: Expiring operator break-glass grants with terminal review

Status: accepted  
Date: 2026-08-31

## Context

Atharvan needs a recoverable way to grant temporary platform authority during an incident without editing role assignments, delegating the platform wildcard, or leaving elevated access in place after the operational need ends.

## Decision

- Only the active singleton Super Administrator may issue or revoke a break-glass grant. Issuance and revocation require a recently verified session.
- A grant targets one active non-super operator, contains one or more exact delegable `platform:` capabilities, and lasts from 5 to 60 minutes. `platform:*` and every `customer-private:` capability remain forbidden.
- Issuance requires an audit reason, incident reference, approval reference, and exact target confirmation. An operator may have at most one unexpired, non-revoked grant at a time.
- Active grants are resolved from PostgreSQL at session-authority resolution and are combined with the operator's immutable role assignments. Expired and revoked grants contribute no authority.
- Every platform command envelope executed with temporary authority records the exact break-glass grant identifiers that contributed to the session.
- Revocation may only add terminal revocation metadata; PostgreSQL prevents edits to issuance evidence and prevents deletion. Expiry needs no mutation.
- A terminal grant requires one immutable review with `approved` or `concerns` outcome. The grantee cannot review their own grant. Security Operator and Auditor version 2 contain the dedicated review capability; existing role assignments remain pinned until explicitly replaced.

## Consequences

- A lost client connection or failed cleanup task cannot extend access past the stored expiry.
- Break-glass authority cannot mint another Super Administrator or enter the customer-private namespace.
- Existing sessions pick up or lose temporary capabilities when Atharvan resolves current operator authority; durable roles are unchanged.
- Post-event review remains visibly pending until an authorised reviewer records it.
- ADR 0015 supplies the mandatory phishing-resistant authenticator and dedicated reauthentication ceremony. Break-glass commands now receive recent proof only from a passkey-authenticated session.
