# Deployment environment contract

Development, test, and production use separate Neon databases, Cloudflare
Workers, Secrets Stores, Resend routing, Arth identities, and operator records.
Credentials and signing keys are never shared across environments. Local work
uses Neon directly and does not require Docker.

## Runtime configuration

| Setting                                | Development                                   | Production                                    |
| -------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| `ATHARVAN_ENVIRONMENT`                 | Required                                      | Required; exactly `production`                |
| `ATHARVAN_PUBLIC_ORIGIN`               | Required                                      | Required HTTPS, never localhost or `.invalid` |
| `DATABASE_URL`                         | Dedicated Neon branch/database                | Dedicated production Neon project/branch      |
| `BETTER_AUTH_SECRET`                   | Required, ≥32 characters                      | Required independent value                    |
| `ATHARVAN_VERIFICATION_HMAC_SECRET`    | Required, ≥32 characters                      | Required independent value                    |
| `ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET` | Optional; falls back to verification HMAC     | Required independent value                    |
| `ATHARVAN_SUPER_ADMIN_EMAIL`           | Authorised operator                           | Authorised production owner                   |
| `ATHARVAN_EMAIL_FROM`                  | Verified sender                               | Verified sender                               |
| `RESEND_API_KEY`                       | Required for delivery verification            | Required                                      |
| `RESEND_WEBHOOK_SECRET`                | Required for provider feedback verification   | Required independent value                    |
| `ATHARVAN_ALERT_EMAIL_TO`              | Required for alert verification               | Required authorised distribution address      |
| Secrets Store account/store/token      | Optional as a complete set until verification | Required least-privilege set                  |
| Current Arth key ID/secret/audience    | Optional as a complete set until integration  | Required matching set                         |
| Previous Arth key ID/secret            | Optional complete pair during rotation only   | Optional complete pair during rotation only   |
| `ATHARVAN_CONTROL_PLANE_ORIGIN`        | Protected deployed Worker HTTPS origin        | Protected deployed Worker HTTPS origin        |

Production configuration parsing fails closed when its origin, email provider,
email feedback secret,
alert destination, Secrets Store, or current Arth workload identity is missing.
The deployment workflow sources the production origin and Arth audience from
protected environment variables and writes runtime values through Cloudflare's
secret channel. The repository contains no production origin placeholder.

## Promotion order

1. Protect the GitHub environment and assign Release, Database, Security, Platform
   On-call, and Arth Runtime owners.
2. Create independent provider resources and enter configuration without copying
   values into issues, logs, or evidence.
3. Run formatting, migration history, clean database migration/contract,
   typecheck, automated/integration tests, and production builds at the candidate.
4. Back up and record the current database restore point. Apply reviewed additive
   migrations before code that needs them.
5. Deploy Atharvan with Arth claiming disabled. The release gate verifies exact
   schema readiness at the configured Worker origin before publishing the
   console; then verify authenticated read compatibility.
6. Deploy/migrate Arth, enable one consumer, verify monotonic apply/acknowledgment,
   directory ingestion, and alert delivery, then scale consumers.
7. Exercise the release smoke suite and observe one complete scheduled interval.
   Roll back code only while preserving new schema/evidence; use forward fixes for
   data migrations.

Production promotion remains blocked until the concrete domain, named owners,
alert destination, backup policy, and provider resources are recorded and the
release-candidate verification in the SLO runbook passes.
