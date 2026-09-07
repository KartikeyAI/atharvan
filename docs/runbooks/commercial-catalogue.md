# Commercial catalogue operations

The commercial catalogue is the source of product identity, plan identity, and
versioned commercial terms. It does not create subscriptions, charge customers,
or call a billing provider.

## Access and safety

- Read access requires `platform:plans:read`.
- Product and plan changes require `platform:plans:write` and recent passkey
  step-up.
- Every mutation requires a reason and an idempotency key.
- Prices are entered as exact major currency units and persisted as integer minor
  units. Operators must verify the currency before activating a fixed plan.
- Provider price references identify an external object; they contain no API key
  or credential.

## Operating sequence

1. Create a draft product with a stable key and operator-facing name.
2. Activate the product only after its ownership and commercial scope are agreed.
3. Create a draft plan version under that product. Select its audience, pricing
   model, exact amount, currency, tax behaviour, trial policy, effective time,
   and optional provider price reference.
4. Review the new immutable version in the catalogue history.
5. Activate the plan only while the parent product is active.
6. Retire obsolete plans and products after downstream subscription and
   entitlement reconciliation confirms they are no longer offered.

Changing any plan term creates the next version. Retired entries are terminal.
Use a new stable key when the commercial identity itself changes.

## Failure and recovery

An exact retry with the same idempotency key returns the stored command result.
A changed request with the same key is rejected. Concurrent or stale changes
cannot skip a revision. If a command fails before commit, neither the catalogue
pointer nor its revision, audit event, or receipt advances.

The catalogue read is intentionally bounded. A `truncated` response means the
operator must narrow the future API query before treating the list as complete.
`historyTruncated` on a plan means older versions exist outside the returned
history; the current version is always included.

## Deployment and verification

Migration `0029_commercial_catalogue` creates the product, product revision,
plan, and plan version tables plus database guards for immutable history and
exact next-version pointers. Apply it through the normal deployment migration
step. Readiness remains closed until schema version 29, the exact migration hash,
the commercial table sentinel, immutable trigger, writable connection, and
runtime privileges are confirmed.

Before production promotion, verify product and plan lifecycle transitions,
idempotent replay, rejected stale/changed retries, exact minor-unit round trips,
cross-environment isolation, and the authenticated catalogue workflow against a
disposable database and configured billing-provider test account.
