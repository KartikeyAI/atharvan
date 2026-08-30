# ADR 0008: Versioned platform adapter releases

- Status: Accepted
- Date: 2026-08-30

## Context

Arth must know exactly which technologies it can detect, understand, modify,
validate, preview, deploy, operate, and migrate. Source-code presence does not
make an adapter safe or available. Each package needs an explicit capability
contract, compatibility boundary, permission declaration, signature result,
security review, rollout channel, and lifecycle.

Atharvan operates this platform catalogue. It must not become a package store or
a path into customer installations, repositories, code, configuration values,
credentials, integrations, or environments.

## Decision

Atharvan stores an environment-scoped identity for each adapter key and semantic
version, plus an immutable sequence of metadata revisions. A release declares:

- package name and SHA-256 artifact digest;
- all eight capability names with an explicit maturity state;
- declared permissions and required secret purposes;
- typed configuration-field, command-risk, and health-check contracts;
- supported environments and compatibility tags;
- release channel, signature result, security-review state and evidence;
- lifecycle, blocking reason, deprecation date, and optional sunset date;
- actor, reason, correlation, revision, and creation evidence.

The package name and digest cannot change under the same adapter key and version.
The service rejects the mutation and PostgreSQL independently enforces the
identity with a trigger. A different artifact requires a new semantic version.
Release revisions are append-only and cannot be updated or deleted.

An active release requires a verified signature, an approved security review
with a named evidence reference, and at least one supported capability. The
stable channel accepts only active releases. An invalid signature or rejected
review forces the release into a blocked lifecycle with a named reason.
Deprecation requires a timestamp, and any sunset must occur later.

Registry mutations require `platform:adapters:write` and recent step-up
authentication. Reads require `platform:adapters:read`. The registry stores only
declarative metadata: package archives and executable code remain in a separately
secured, signed artifact distribution system.

## Consequences

- Adapter availability and maturity are explicit rather than inferred from code.
- Operators can stage, block, deprecate, and sunset releases without deployment.
- Security and compatibility evidence remain reviewable across revisions.
- Reusing a semantic version for different package bytes is prevented at both
  service and database layers.
- Customer adapter installation, package distribution, signature verification,
  security scanning, runtime loading, and private registry synchronization remain
  separate workflows and must not be claimed as complete by this catalogue.
