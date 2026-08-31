# ADR 0015: Phishing-resistant operator passkeys

Status: accepted  
Date: 2026-08-31

## Context

Atharvan operators can change platform-wide controls and exercise narrowly bounded emergency authority. Email OTP is suitable for invited-account bootstrap but is not phishing-resistant and must not establish durable platform access or satisfy recent-authentication requirements.

## Decision

- Better Auth owns WebAuthn registration and authentication in the isolated `auth` schema. Atharvan requires discoverable credentials and user verification during registration and authentication, and rejects either ceremony when the server result does not report a verified user.
- Email OTP is invitation bootstrap only. A bootstrap session may reach the authentication-assurance endpoint and passkey registration UI, but no platform data or command. Once the operator has a passkey, Atharvan no longer issues sign-in OTPs for that identity.
- Every protected platform request resolves current operator authority and passkey enrollment from PostgreSQL. Platform access requires a session created by successful passkey authentication; cookie-cached authority remains disabled.
- The session records its authentication method and strong-authentication timestamp. A valid passkey session provides platform access for its normal session lifetime, while only proof no older than five minutes is propagated as step-up evidence to sensitive domain commands.
- The console routes an invited operator to passkey enrollment, an OTP or otherwise insufficient session to passkey verification, and a stale sensitive command to a dedicated verification ceremony.
- PostgreSQL audits passkey enrollment, rename, removal, and linked session creation. Credential identifiers remain unique, counters cannot move backward, credential history cannot be rewritten, and concurrent removal is serialized so an active operator cannot remove the final passkey.
- Operators should enroll a second passkey before removing one. Complete authenticator loss has no OTP downgrade or self-service bypass; access remains fail-closed until a separately reviewed account-recovery capability is designed.

## Consequences

- Possession of an email inbox cannot establish platform authority after bootstrap.
- A generic session creation timestamp is never treated as strong or recent authentication.
- Suspension and capability changes continue to take effect on every request, independently of WebAuthn session state.
- The development deployment can verify contracts and routing, but a real authenticator ceremony requires an approved operator identity and browser authenticator.
