import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformAuditEventPage,
  type PlatformAuditExport,
  type PlatformAuditQuery,
  type PlatformCommandOutcome,
  type PlatformConfigurationEnvironment,
  type PlatformJsonValue,
} from "@atharvan/domain";

export interface PlatformCommandReplay {
  readonly outcome: PlatformCommandOutcome;
  readonly responseStatus: number;
  readonly responseBody: PlatformJsonValue;
}

export type PlatformCommandBeginResult =
  | { readonly state: "started"; readonly commandId: string }
  | {
      readonly state: "replayed";
      readonly commandId: string;
      readonly result: PlatformCommandReplay;
    }
  | { readonly state: "in_progress"; readonly commandId: string }
  | { readonly state: "conflict"; readonly commandId: string };

export interface PlatformCommandAuditStore {
  beginCommand(input: {
    readonly commandId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly name: string;
    readonly version: number;
    readonly actorId: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly expectedTargetVersion: number | null;
    readonly payloadFingerprint: string;
    readonly idempotencyFingerprint: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly approvalReference: string | null;
    readonly evidenceReferences: ReadonlyArray<string>;
    readonly requestedAt: Date;
  }): Promise<PlatformCommandBeginResult>;
  completeCommand(input: {
    readonly commandId: string;
    readonly actorId: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly outcome: PlatformCommandOutcome;
    readonly responseStatus: number;
    readonly responseBody: PlatformJsonValue;
    readonly completedAt: Date;
  }): Promise<{ readonly state: "completed" | "already_completed" }>;
  listAuditEvents(input: {
    readonly query: NormalizedPlatformAuditQuery;
  }): Promise<PlatformAuditEventPage>;
  exportAuditEvents(input: {
    readonly query: NormalizedPlatformAuditExportQuery;
  }): Promise<{
    readonly items: PlatformAuditEventPage["items"];
    readonly truncated: boolean;
  }>;
}

export interface BeginPlatformCommand {
  readonly actor: AuthenticatedOperator;
  readonly requiredCapability: string;
  readonly name: string;
  readonly version: number;
  readonly targetType: string;
  readonly targetId: string;
  readonly expectedTargetVersion?: number | null;
  readonly safePayload: PlatformJsonValue;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly approvalReference?: string | null;
  readonly evidenceReferences?: ReadonlyArray<string>;
}

export interface NormalizedPlatformAuditQuery {
  readonly actorId: string | null;
  readonly eventType: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly correlationId: string | null;
  readonly commandName: string | null;
  readonly outcome: PlatformCommandOutcome | null;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly cursor: { readonly occurredAt: Date; readonly id: string } | null;
  readonly limit: number;
}

export interface NormalizedPlatformAuditExportQuery extends Omit<
  NormalizedPlatformAuditQuery,
  "cursor" | "limit"
> {
  readonly cursor: null;
  readonly limit: 5001;
}

export class PlatformCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_command_rejected");
  }
}

export function createPlatformCommandService(input: {
  readonly store: PlatformCommandAuditStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  return {
    async begin(command: BeginPlatformCommand) {
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: command.requiredCapability,
      });
      const requestedAt = now();
      const name = requireName(command.name);
      const version = requirePositiveInteger(
        command.version,
        "command_version_invalid",
      );
      const targetType = requireName(command.targetType);
      const targetId = requireText(
        command.targetId,
        1,
        256,
        "command_target_required",
      );
      const correlationId = requireUuid(
        command.correlationId,
        "command_correlation_invalid",
      );
      const reason = requireText(
        command.reason,
        8,
        500,
        "command_reason_required",
      );
      const approvalReference = requireOptionalText(
        command.approvalReference ?? null,
        256,
        "command_approval_reference_invalid",
      );
      const evidenceReferences = requireEvidenceReferences(
        command.evidenceReferences ?? [],
      );
      const expectedTargetVersion =
        command.expectedTargetVersion === undefined ||
        command.expectedTargetVersion === null
          ? null
          : requirePositiveInteger(
              command.expectedTargetVersion,
              "command_expected_version_invalid",
            );
      const idempotencyKey = requireText(
        command.idempotencyKey,
        8,
        256,
        "command_idempotency_key_invalid",
      );

      return input.store.beginCommand({
        commandId: randomId(),
        environment: input.environment,
        name,
        version,
        actorId: command.actor.operatorId,
        targetType,
        targetId,
        expectedTargetVersion,
        payloadFingerprint: await fingerprint(command.safePayload),
        idempotencyFingerprint: await fingerprint(idempotencyKey),
        correlationId,
        reason,
        approvalReference,
        evidenceReferences,
        requestedAt,
      });
    },

    complete(command: {
      readonly commandId: string;
      readonly actor: AuthenticatedOperator;
      readonly targetType: string;
      readonly targetId: string;
      readonly correlationId: string;
      readonly reason: string;
      readonly outcome: PlatformCommandOutcome;
      readonly responseStatus: number;
      readonly responseBody: PlatformJsonValue;
    }) {
      return input.store.completeCommand({
        commandId: requireUuid(command.commandId, "command_id_invalid"),
        actorId: command.actor.operatorId,
        targetType: requireName(command.targetType),
        targetId: requireText(
          command.targetId,
          1,
          256,
          "command_target_required",
        ),
        correlationId: requireUuid(
          command.correlationId,
          "command_correlation_invalid",
        ),
        reason: requireText(command.reason, 8, 500, "command_reason_required"),
        outcome: command.outcome,
        responseStatus: requireHttpStatus(command.responseStatus),
        responseBody: normalizeJson(command.responseBody),
        completedAt: now(),
      });
    },

    listAuditEvents(actor: AuthenticatedOperator, query: PlatformAuditQuery) {
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:audit:read",
      });
      return input.store.listAuditEvents({ query: normalizeAuditQuery(query) });
    },

    async exportAuditEvents(
      actor: AuthenticatedOperator,
      query: PlatformAuditQuery,
    ): Promise<PlatformAuditExport> {
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:audit:export",
        requireRecentStepUp: true,
        now: now(),
      });
      const normalized = normalizeAuditExportQuery(query);
      const result = await input.store.exportAuditEvents({ query: normalized });
      return {
        generatedAt: now().toISOString(),
        format: "ndjson",
        itemCount: result.items.length,
        truncated: result.truncated,
        content:
          result.items.map((item) => JSON.stringify(item)).join("\n") +
          (result.items.length === 0 ? "" : "\n"),
      };
    },
  };
}

function normalizeAuditQuery(
  query: PlatformAuditQuery,
): NormalizedPlatformAuditQuery {
  return {
    actorId: requireOptionalUuid(query.actorId, "audit_actor_invalid"),
    eventType: requireOptionalName(query.eventType, "audit_event_type_invalid"),
    targetType: requireOptionalName(
      query.targetType,
      "audit_target_type_invalid",
    ),
    targetId: requireOptionalText(
      query.targetId,
      256,
      "audit_target_id_invalid",
    ),
    correlationId: requireOptionalUuid(
      query.correlationId,
      "audit_correlation_invalid",
    ),
    commandName: requireOptionalName(
      query.commandName,
      "audit_command_name_invalid",
    ),
    outcome: requireOptionalOutcome(query.outcome),
    from: requireOptionalDate(query.from, "audit_from_invalid"),
    to: requireOptionalDate(query.to, "audit_to_invalid"),
    cursor: decodeCursor(query.cursor),
    limit:
      query.limit === undefined
        ? 50
        : requireBoundedInteger(query.limit, 1, 200, "audit_limit_invalid"),
  };
}

function normalizeAuditExportQuery(
  query: PlatformAuditQuery,
): NormalizedPlatformAuditExportQuery {
  const normalized = normalizeAuditQuery(query);
  if (normalized.from === null || normalized.to === null) {
    reject("audit_export_range_required");
  }
  const rangeMs = normalized.to.getTime() - normalized.from.getTime();
  if (rangeMs <= 0 || rangeMs > 31 * 24 * 60 * 60_000) {
    reject("audit_export_range_invalid");
  }
  return { ...normalized, cursor: null, limit: 5001 };
}

export function encodePlatformAuditCursor(
  occurredAt: Date,
  id: string,
): string {
  return btoa(`${occurredAt.toISOString()}|${id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeCursor(value: string | undefined) {
  if (value === undefined) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.lastIndexOf("|");
    if (separator < 1) reject("audit_cursor_invalid");
    return {
      occurredAt: requireDate(
        decoded.slice(0, separator),
        "audit_cursor_invalid",
      ),
      id: requireUuid(decoded.slice(separator + 1), "audit_cursor_invalid"),
    };
  } catch {
    reject("audit_cursor_invalid");
  }
}

async function fingerprint(value: PlatformJsonValue | string): Promise<string> {
  const canonical =
    typeof value === "string" ? value : JSON.stringify(normalizeJson(value));
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeJson(value: PlatformJsonValue): PlatformJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("command_payload_invalid");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  const record = value as { readonly [key: string]: PlatformJsonValue };
  const normalized: Record<string, PlatformJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) reject("command_payload_invalid");
    normalized[key] = normalizeJson(item);
  }
  return normalized;
}

function requireName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,127}$/u.test(normalized))
    reject("command_name_invalid");
  return normalized;
}

function requireOptionalName(value: string | undefined, reason: string) {
  if (value === undefined) return null;
  try {
    return requireName(value);
  } catch {
    reject(reason);
  }
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    reject(reason);
  return normalized;
}

function requireOptionalText(
  value: string | null | undefined,
  maximum: number,
  reason: string,
) {
  if (value === null || value === undefined) return null;
  return requireText(value, 1, maximum, reason);
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      normalized,
    )
  )
    reject(reason);
  return normalized;
}

function requireOptionalUuid(value: string | undefined, reason: string) {
  return value === undefined ? null : requireUuid(value, reason);
}

function requirePositiveInteger(value: number, reason: string) {
  return requireBoundedInteger(value, 1, 2_147_483_647, reason);
}

function requireBoundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  reason: string,
) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    reject(reason);
  return value;
}

function requireHttpStatus(value: number) {
  return requireBoundedInteger(
    value,
    100,
    599,
    "command_response_status_invalid",
  );
}

function requireDate(value: string, reason: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) reject(reason);
  return date;
}

function requireOptionalDate(value: string | undefined, reason: string) {
  return value === undefined ? null : requireDate(value, reason);
}

function requireOptionalOutcome(value: PlatformCommandOutcome | undefined) {
  if (value === undefined) return null;
  if (value !== "succeeded" && value !== "rejected" && value !== "failed")
    reject("audit_outcome_invalid");
  return value;
}

function requireEvidenceReferences(values: ReadonlyArray<string>) {
  if (values.length > 20 || new Set(values).size !== values.length)
    reject("command_evidence_invalid");
  return values.map((value) =>
    requireText(value, 1, 256, "command_evidence_invalid"),
  );
}

function reject(reason: string): never {
  throw new PlatformCommandRejectedError(reason);
}
