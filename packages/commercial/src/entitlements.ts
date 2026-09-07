import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type EnterpriseEntitlementGrantLifecycle,
  type EntitlementOveragePolicy,
  type EntitlementValue,
  type PlanEntitlementSet,
  type PlatformConfigurationEnvironment,
  type WorkspaceEntitlementRegistry,
} from "@atharvan/domain";

const overagePolicies = new Set<EntitlementOveragePolicy>([
  "denied",
  "metered",
  "contract",
]);
const maximumEntitlements = 128;
const maximumGrantTermMilliseconds = 5 * 366 * 24 * 60 * 60_000;
const maximumScheduledLeadMilliseconds = 366 * 24 * 60 * 60_000;

export type EntitlementCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
      readonly snapshotRevisionNumber?: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface EntitlementStore {
  getPlanEntitlementSet(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly planVersionId: string;
  }): Promise<PlanEntitlementSet | null>;
  getWorkspaceEntitlements(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly now: Date;
  }): Promise<WorkspaceEntitlementRegistry | null>;
  sealPlanEntitlementSet(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly setId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly planVersionId: string;
    readonly values: ReadonlyArray<EntitlementValue>;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<EntitlementCommandResult>;
  assignWorkspacePlan(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly assignmentId: string;
    readonly snapshotId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly planVersionId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<EntitlementCommandResult>;
  setEnterpriseGrant(input: {
    readonly actorId: string;
    readonly commandId?: string;
    readonly grantId: string;
    readonly grantRevisionId: string;
    readonly snapshotId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly value: EntitlementValue;
    readonly lifecycle: EnterpriseEntitlementGrantLifecycle;
    readonly contractReference: string;
    readonly startsAt: Date;
    readonly expiresAt: Date;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<EntitlementCommandResult>;
}

export class EntitlementCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("entitlement_command_rejected");
  }
}

export interface SealPlanEntitlementSetCommand {
  readonly commandId?: string;
  readonly planVersionId: string;
  readonly values: ReadonlyArray<EntitlementValue>;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface AssignWorkspacePlanCommand {
  readonly commandId?: string;
  readonly workspaceId: string;
  readonly planVersionId: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface SetEnterpriseGrantCommand {
  readonly commandId?: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly valueType: "boolean" | "quantity";
  readonly enabled: boolean | null;
  readonly limit: number | null;
  readonly unit: string | null;
  readonly overagePolicy: EntitlementOveragePolicy;
  readonly lifecycle: EnterpriseEntitlementGrantLifecycle;
  readonly contractReference: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export function createEntitlementService(input: {
  readonly store: EntitlementStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const clock = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  function authorize(actor: AuthenticatedOperator, now: Date) {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:plans:write",
      requireRecentStepUp: true,
      now,
    });
  }

  return {
    getPlanEntitlementSet: (planVersionId: string) =>
      input.store.getPlanEntitlementSet({
        environment: input.environment,
        planVersionId: requireUuid(planVersionId, "plan_version_id_invalid"),
      }),

    getWorkspaceEntitlements: (workspaceId: string) =>
      input.store.getWorkspaceEntitlements({
        environment: input.environment,
        workspaceId: requireIdentifier(workspaceId, "workspace_id_invalid"),
        now: clock(),
      }),

    async sealPlanEntitlementSet(
      actor: AuthenticatedOperator,
      command: SealPlanEntitlementSetCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      if (
        !Array.isArray(command.values) ||
        command.values.length === 0 ||
        command.values.length > maximumEntitlements
      )
        reject("entitlement_values_invalid");
      const values = command.values.map(normalizeEntitlementValue);
      const keys = new Set(values.map((value) => value.key));
      if (keys.size !== values.length) reject("entitlement_keys_duplicate");
      values.sort((left, right) => left.key.localeCompare(right.key));
      return unwrap(
        await input.store.sealPlanEntitlementSet({
          actorId: actor.operatorId,
          ...(command.commandId === undefined
            ? {}
            : { commandId: command.commandId }),
          setId: randomId(),
          environment: input.environment,
          planVersionId: requireUuid(
            command.planVersionId,
            "plan_version_id_invalid",
          ),
          values,
          reason: requireText(command.reason, 8, 500, "reason_invalid"),
          correlationId: command.correlationId ?? randomId(),
          now,
        }),
      );
    },

    async assignWorkspacePlan(
      actor: AuthenticatedOperator,
      command: AssignWorkspacePlanCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      return unwrap(
        await input.store.assignWorkspacePlan({
          actorId: actor.operatorId,
          ...(command.commandId === undefined
            ? {}
            : { commandId: command.commandId }),
          assignmentId: randomId(),
          snapshotId: randomId(),
          environment: input.environment,
          workspaceId: requireIdentifier(
            command.workspaceId,
            "workspace_id_invalid",
          ),
          planVersionId: requireUuid(
            command.planVersionId,
            "plan_version_id_invalid",
          ),
          reason: requireText(command.reason, 8, 500, "reason_invalid"),
          correlationId: command.correlationId ?? randomId(),
          now,
        }),
      );
    },

    async setEnterpriseGrant(
      actor: AuthenticatedOperator,
      command: SetEnterpriseGrantCommand,
    ) {
      const now = clock();
      authorize(actor, now);
      const lifecycle =
        command.lifecycle === "active" || command.lifecycle === "revoked"
          ? command.lifecycle
          : reject("grant_lifecycle_invalid");
      const startsAt = requireDate(command.startsAt, "grant_starts_at_invalid");
      const expiresAt = requireDate(
        command.expiresAt,
        "grant_expires_at_invalid",
      );
      if (expiresAt <= startsAt) reject("grant_term_invalid");
      if (
        expiresAt.getTime() - startsAt.getTime() >
        maximumGrantTermMilliseconds
      )
        reject("grant_term_too_long");
      if (
        lifecycle === "active" &&
        (expiresAt <= now ||
          startsAt.getTime() - now.getTime() > maximumScheduledLeadMilliseconds)
      )
        reject("grant_term_inactive");
      const value = normalizeEntitlementValue({
        key: command.key,
        valueType: command.valueType,
        enabled: command.enabled,
        limit: command.limit,
        unit: command.unit,
        overagePolicy: command.overagePolicy,
      } as EntitlementValue);
      return unwrap(
        await input.store.setEnterpriseGrant({
          actorId: actor.operatorId,
          ...(command.commandId === undefined
            ? {}
            : { commandId: command.commandId }),
          grantId: randomId(),
          grantRevisionId: randomId(),
          snapshotId: randomId(),
          environment: input.environment,
          workspaceId: requireIdentifier(
            command.workspaceId,
            "workspace_id_invalid",
          ),
          value,
          lifecycle,
          contractReference: requireText(
            command.contractReference,
            3,
            200,
            "contract_reference_invalid",
          ),
          startsAt,
          expiresAt,
          reason: requireText(command.reason, 8, 500, "reason_invalid"),
          correlationId: command.correlationId ?? randomId(),
          now,
        }),
      );
    },
  };
}

function normalizeEntitlementValue(value: EntitlementValue): EntitlementValue {
  const key = requireKey(value.key, "entitlement_key_invalid");
  if (value.valueType === "boolean") {
    if (
      typeof value.enabled !== "boolean" ||
      value.limit !== null ||
      value.unit !== null ||
      value.overagePolicy !== "denied"
    )
      reject("boolean_entitlement_invalid");
    return {
      key,
      valueType: "boolean",
      enabled: value.enabled,
      limit: null,
      unit: null,
      overagePolicy: "denied",
    };
  }
  if (value.valueType !== "quantity") reject("entitlement_value_type_invalid");
  if (
    value.enabled !== null ||
    (value.limit !== null &&
      (!Number.isSafeInteger(value.limit) ||
        value.limit < 0 ||
        value.limit > 9_000_000_000_000)) ||
    typeof value.unit !== "string" ||
    !overagePolicies.has(value.overagePolicy)
  )
    reject("quantity_entitlement_invalid");
  return {
    key,
    valueType: "quantity",
    enabled: null,
    limit: value.limit,
    unit: requireKey(value.unit, "entitlement_unit_invalid"),
    overagePolicy: value.overagePolicy,
  };
}

function unwrap(result: EntitlementCommandResult) {
  if (result.outcome === "rejected") reject(result.reason);
  return result;
}

function requireKey(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(normalized)) reject(reason);
  return normalized;
}

function requireIdentifier(value: string, reason: string) {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  )
    reject(reason);
  return normalized;
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  )
    reject(reason);
  return normalized;
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

function requireDate(value: string, reason: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) reject(reason);
  return date;
}

function reject(reason: string): never {
  throw new EntitlementCommandRejectedError(reason);
}
