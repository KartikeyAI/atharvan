# Verifiable audit exports

## Export contract

`GET /v1/platform/audit-events/export` requires an active operator with
`platform:audit:export`, recent passkey step-up, and an explicit range no longer
than 31 days. The response contains at most 5,000 immutable audit events and 16
MiB in deterministic descending occurrence-time and ID order. The body remains
one event per NDJSON line and ends with a newline when non-empty. An oversized
request fails and must be retried with a narrower range.

The Worker hashes the exact UTF-8 response body with SHA-256 before returning it.
It sends the lowercase digest in `x-atharvan-audit-content-sha256`, a standard
base64 `Content-Digest`, an ETag, schema version, environment, generation time,
requested range, item count, and explicit truncation headers. Responses are
non-cacheable and use `nosniff`. The console also verifies the declared byte
length before hashing.

The console fetches the export as a bounded blob, validates all required metadata,
recomputes SHA-256 over the received bytes, and saves the file only when the
digest matches. The digest prefix is included in the filename and the complete
digest remains visible after download. A digest proves byte integrity against a
recorded value; it is not a signature or proof against a compromised control
plane.

## Immutable access evidence

Before the response is released, Atharvan appends
`platform.audit.exported` with the operator, request correlation ID, environment,
range, normalized filters, item count, truncation state, schema version, and
content digest. If this audit write fails, the export fails. The access event is
recorded after selecting the exported snapshot and therefore is not included in
that same file.

## Operator verification

Keep the digest shown by the console with any evidence transfer or case record.
On Windows, recompute it without opening or rewriting the file:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\atharvan-audit-YYYY-MM-DD-digest.ndjson
```

The output must exactly match the full lowercase digest displayed by Atharvan.
If the export reports truncation, narrow the date range until every file reports
`truncated: false`; a truncated file is valid but incomplete for its requested
range.
