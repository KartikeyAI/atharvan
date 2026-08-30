# ADR 0013: Reconciled customer ownership and append-only operator context

Status: accepted  
Date: 2026-08-30

## Context

Atharvan operators need to recover or transfer workspace ownership and retain internal operational context without copying customer-private data or turning the control plane into a second source of customer identity truth.

## Decision

- Arth supplies the explicit current workspace owner in the disposable customer-directory projection. Atharvan never infers ownership from a role label or effective permissions.
- Ownership-transfer requests require `platform:workspaces:transfer`, a recent step-up assertion, an exact confirmation, a reason, and an approval reference. The successor must be an active, verified projected user with an active membership in the workspace.
- Transfer requests and Arth observations are append-only. A request remains pending until a monotonic observation reports the successor as owner; mismatches are drift, and source failures remain visible.
- Internal notes are append-only, bounded operational metadata. Domain validation rejects common secret-material shapes before persistence, and the UI explicitly prohibits customer code, prompts, tokens, secrets, and environment contents.
- Risk markers use a stable identity with immutable revisions for category, severity, summary, active/resolved state, actor, reason, and time.
- Customer inspection returns Arth projections and Atharvan-owned operational context in one purpose-bound, audited transaction.

## Consequences

- Ownership recovery cannot proceed while the Arth projection reports an unknown owner.
- Atharvan records transfer intent but cannot claim enforcement before Arth reconciliation.
- Notes and risk history cannot be edited or deleted through normal or direct mutation paths; corrections are new records or revisions.
- The schema contains no customer code, chat, prompt, credential, token, environment value, or private execution content.
