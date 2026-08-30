import {
  assertPlatformCommandAuthorized,
  operatorHasCapability,
  type AuthenticatedOperator,
  type CustomerDirectoryInspection,
  type CustomerDirectorySearchResult,
  type CustomerDirectoryStatus,
  type CustomerMembershipLifecycle,
  type CustomerInternalNoteCategory,
  type CustomerOperationsTargetType,
  type CustomerOwnershipTransferObservedState,
  type CustomerRiskCategory,
  type CustomerRiskSeverity,
  type CustomerRiskState,
  type CustomerRestrictionCapability,
  type CustomerRestrictionDesiredState,
  type CustomerRestrictionObservedState,
  type CustomerRestrictionRegistry,
  type CustomerUserLifecycle,
  type CustomerVerificationStatus,
  type CustomerWorkspaceLifecycle,
  type PlatformConfigurationEnvironment,
} from "@atharvan/domain";

export type CustomerDirectorySearchScope = "users" | "workspaces" | "all";
export type CustomerDirectoryEntityType = "user" | "workspace";

export interface CustomerDirectorySnapshotUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly lifecycle: CustomerUserLifecycle;
  readonly verificationStatus: CustomerVerificationStatus;
  readonly createdAt: string;
}

export interface CustomerDirectorySnapshotWorkspace {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug?: string | null;
  readonly lifecycle: CustomerWorkspaceLifecycle;
  readonly ownerUserId?: string | null;
  readonly createdAt: string;
}

export interface CustomerDirectorySnapshotMembership {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: string;
  readonly lifecycle: CustomerMembershipLifecycle;
  readonly grantedPermissions: ReadonlyArray<string>;
  readonly deniedPermissions: ReadonlyArray<string>;
  readonly effectivePermissions: ReadonlyArray<string>;
}

export interface ReconcileCustomerDirectorySnapshotCommand {
  readonly actor: AuthenticatedOperator;
  readonly sourceRevision: string;
  readonly observedAt: string;
  readonly users: ReadonlyArray<CustomerDirectorySnapshotUser>;
  readonly workspaces: ReadonlyArray<CustomerDirectorySnapshotWorkspace>;
  readonly memberships: ReadonlyArray<CustomerDirectorySnapshotMembership>;
  readonly reason: string;
  readonly correlationId?: string;
}

export interface CustomerDirectoryStore {
  getStatus(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly now: Date;
  }): Promise<CustomerDirectoryStatus>;
  searchAndAudit(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly query: string;
    readonly queryFingerprint: string;
    readonly scope: CustomerDirectorySearchScope;
    readonly limit: number;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CustomerDirectorySearchResult>;
  inspectAndAudit(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly entityType: CustomerDirectoryEntityType;
    readonly entityId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<CustomerDirectoryInspection | null>;
  reconcileSnapshot(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly sourceRevision: string;
    readonly observedAt: Date;
    readonly users: ReadonlyArray<CustomerDirectorySnapshotUser>;
    readonly workspaces: ReadonlyArray<CustomerDirectorySnapshotWorkspace>;
    readonly memberships: ReadonlyArray<CustomerDirectorySnapshotMembership>;
    readonly now: Date;
  }): Promise<
    | {
        readonly outcome: "updated";
        readonly sourceRevision: string;
        readonly users: number;
        readonly workspaces: number;
        readonly memberships: number;
      }
    | { readonly outcome: "unchanged"; readonly sourceRevision: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  listRestrictions(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly targetType: CustomerDirectoryEntityType;
    readonly targetId: string;
  }): Promise<CustomerRestrictionRegistry>;
  setRestriction(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly targetType: CustomerDirectoryEntityType;
    readonly targetId: string;
    readonly capability: CustomerRestrictionCapability;
    readonly desiredState: CustomerRestrictionDesiredState;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly outcome: "updated";
        readonly restrictionId: string;
        readonly revisionNumber: number;
        readonly desiredState: CustomerRestrictionDesiredState;
      }
    | {
        readonly outcome: "unchanged";
        readonly restrictionId: string;
        readonly revisionNumber: number;
        readonly desiredState: CustomerRestrictionDesiredState;
      }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  recordRestrictionObservation(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly restrictionId: string;
    readonly desiredRevisionNumber: number;
    readonly sourceRevision: string;
    readonly observedState: CustomerRestrictionObservedState;
    readonly message: string | null;
    readonly observedAt: Date;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created"; readonly restrictionId: string }
    | { readonly outcome: "unchanged"; readonly restrictionId: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  createInternalNote(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly targetType: CustomerOperationsTargetType;
    readonly targetId: string;
    readonly category: CustomerInternalNoteCategory;
    readonly body: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created"; readonly id: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  setRiskMarker(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly targetType: CustomerOperationsTargetType;
    readonly targetId: string;
    readonly markerId: string | null;
    readonly category: CustomerRiskCategory;
    readonly severity: CustomerRiskSeverity;
    readonly state: CustomerRiskState;
    readonly summary: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly outcome: "created" | "updated" | "unchanged";
        readonly id: string;
        readonly revisionNumber: number;
      }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  requestOwnershipTransfer(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly workspaceId: string;
    readonly successorUserId: string;
    readonly approvalReference: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly outcome: "created";
        readonly id: string;
        readonly revisionNumber: number;
      }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  recordOwnershipTransferObservation(input: {
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly transferId: string;
    readonly sourceRevision: string;
    readonly observedState: CustomerOwnershipTransferObservedState;
    readonly observedOwnerUserId: string | null;
    readonly message: string | null;
    readonly observedAt: Date;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created" | "unchanged"; readonly id: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
}

export class CustomerDirectoryRejectedError extends Error {
  constructor(readonly reason: string) {
    super("customer_directory_rejected");
  }
}

export function createCustomerDirectoryService(input: {
  readonly store: CustomerDirectoryStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  return {
    getStatus(actor: AuthenticatedOperator) {
      assertAnyDirectoryRead(actor);
      return input.store.getStatus({
        environment: input.environment,
        now: now(),
      });
    },

    async search(command: {
      readonly actor: AuthenticatedOperator;
      readonly query: string;
      readonly scope: CustomerDirectorySearchScope;
      readonly limit?: number;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      assertSearchAuthorized(command.actor, command.scope);
      const query = requireSearchQuery(command.query);
      return input.store.searchAndAudit({
        actorId: command.actor.operatorId,
        environment: input.environment,
        query,
        queryFingerprint: await fingerprint(query),
        scope: requireSearchScope(command.scope),
        limit: requireLimit(command.limit ?? 20),
        reason: requireText(command.reason, 8, 500, "access_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: now(),
      });
    },

    inspect(command: {
      readonly actor: AuthenticatedOperator;
      readonly entityType: CustomerDirectoryEntityType;
      readonly entityId: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const entityType = requireEntityType(command.entityType);
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability:
          entityType === "user"
            ? "platform:users:read"
            : "platform:workspaces:read",
      });
      return input.store.inspectAndAudit({
        actorId: command.actor.operatorId,
        environment: input.environment,
        entityType,
        entityId: requireIdentifier(command.entityId, "entity_id_invalid"),
        reason: requireText(command.reason, 8, 500, "access_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: now(),
      });
    },

    async reconcileSnapshot(
      command: ReconcileCustomerDirectorySnapshotCommand,
    ) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:customer-directory:sync",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: commandTime,
      });
      const sourceRevision = requireSourceRevision(command.sourceRevision);
      const observedAt = requireObservedAt(command.observedAt, commandTime);
      const users = requireUsers(command.users);
      const workspaces = requireWorkspaces(command.workspaces);
      const memberships = requireMemberships(command.memberships);
      assertUnique(
        users.map((value) => value.id),
        "duplicate_user_id",
      );
      assertUnique(
        workspaces.map((value) => value.id),
        "duplicate_workspace_id",
      );
      assertUnique(
        memberships.map((value) => value.id),
        "duplicate_membership_id",
      );
      const userIds = new Set(users.map((value) => value.id));
      const workspaceIds = new Set(workspaces.map((value) => value.id));
      if (
        memberships.some(
          (value) =>
            !userIds.has(value.userId) || !workspaceIds.has(value.workspaceId),
        )
      ) {
        reject("membership_reference_missing");
      }
      if (
        workspaces.some(
          (value) =>
            value.ownerUserId !== null && !userIds.has(value.ownerUserId),
        )
      ) {
        reject("workspace_owner_reference_missing");
      }

      const result = await input.store.reconcileSnapshot({
        actorId: command.actor.operatorId,
        environment: input.environment,
        sourceRevision,
        observedAt,
        users,
        workspaces,
        memberships,
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    listRestrictions(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetType: CustomerDirectoryEntityType;
      readonly targetId: string;
    }) {
      const targetType = requireEntityType(command.targetType);
      assertRestrictionAuthorized(command.actor, targetType, false, now());
      return input.store.listRestrictions({
        environment: input.environment,
        targetType,
        targetId: requireIdentifier(command.targetId, "entity_id_invalid"),
      });
    },

    async setRestriction(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetType: CustomerDirectoryEntityType;
      readonly targetId: string;
      readonly capability: CustomerRestrictionCapability;
      readonly desiredState: CustomerRestrictionDesiredState;
      readonly confirmation: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      const targetType = requireEntityType(command.targetType);
      const targetId = requireIdentifier(command.targetId, "entity_id_invalid");
      const capability = requireRestrictionCapability(command.capability);
      const desiredState = requireEnum(
        command.desiredState,
        ["restricted", "restored"] as const,
        "restriction_state_invalid",
      );
      assertRestrictionAuthorized(command.actor, targetType, true, commandTime);
      if (targetType === "workspace" && capability === "login") {
        reject("workspace_login_restriction_invalid");
      }
      const verb = desiredState === "restricted" ? "RESTRICT" : "RESTORE";
      if (command.confirmation.trim() !== `${verb} ${targetId}`) {
        reject("restriction_confirmation_invalid");
      }
      const result = await input.store.setRestriction({
        actorId: command.actor.operatorId,
        environment: input.environment,
        targetType,
        targetId,
        capability,
        desiredState,
        reason: requireText(
          command.reason,
          8,
          500,
          "restriction_reason_required",
        ),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async recordRestrictionObservation(command: {
      readonly actor: AuthenticatedOperator;
      readonly restrictionId: string;
      readonly desiredRevisionNumber: number;
      readonly sourceRevision: string;
      readonly observedState: CustomerRestrictionObservedState;
      readonly message?: string | null;
      readonly observedAt: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:customer-restrictions:sync",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: commandTime,
      });
      const result = await input.store.recordRestrictionObservation({
        actorId: command.actor.operatorId,
        environment: input.environment,
        restrictionId: requireUuid(
          command.restrictionId,
          "restriction_id_invalid",
        ),
        desiredRevisionNumber: requirePositiveInteger(
          command.desiredRevisionNumber,
          "restriction_revision_invalid",
        ),
        sourceRevision: requireSourceRevision(command.sourceRevision),
        observedState: requireEnum(
          command.observedState,
          ["restricted", "restored", "failed"] as const,
          "restriction_observation_state_invalid",
        ),
        message:
          command.message === undefined || command.message === null
            ? null
            : requireText(
                command.message,
                1,
                500,
                "restriction_observation_message_invalid",
              ),
        observedAt: requireObservedAt(command.observedAt, commandTime),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async createInternalNote(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetType: CustomerOperationsTargetType;
      readonly targetId: string;
      readonly category: CustomerInternalNoteCategory;
      readonly body: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const targetType = requireEntityType(command.targetType);
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: `platform:${targetType}s:notes:write`,
      });
      const result = await input.store.createInternalNote({
        actorId: command.actor.operatorId,
        environment: input.environment,
        targetType,
        targetId: requireIdentifier(command.targetId, "entity_id_invalid"),
        category: requireEnum(
          command.category,
          ["support", "operations", "billing", "security"] as const,
          "note_category_invalid",
        ),
        body: requireSafeInternalText(
          command.body,
          4,
          2000,
          "note_body_invalid",
        ),
        reason: requireText(command.reason, 8, 500, "note_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: now(),
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async setRiskMarker(command: {
      readonly actor: AuthenticatedOperator;
      readonly targetType: CustomerOperationsTargetType;
      readonly targetId: string;
      readonly markerId?: string | null;
      readonly category: CustomerRiskCategory;
      readonly severity: CustomerRiskSeverity;
      readonly state: CustomerRiskState;
      readonly summary: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      const targetType = requireEntityType(command.targetType);
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: `platform:${targetType}s:risk:write`,
        requireRecentStepUp: true,
        now: commandTime,
      });
      const markerId =
        command.markerId === undefined || command.markerId === null
          ? null
          : requireUuid(command.markerId, "risk_marker_id_invalid");
      if (command.state === "resolved" && markerId === null) {
        reject("risk_marker_id_required");
      }
      const result = await input.store.setRiskMarker({
        actorId: command.actor.operatorId,
        environment: input.environment,
        targetType,
        targetId: requireIdentifier(command.targetId, "entity_id_invalid"),
        markerId,
        category: requireEnum(
          command.category,
          ["security", "abuse", "billing", "identity", "support"] as const,
          "risk_category_invalid",
        ),
        severity: requireEnum(
          command.severity,
          ["low", "medium", "high", "critical"] as const,
          "risk_severity_invalid",
        ),
        state: requireEnum(
          command.state,
          ["active", "resolved"] as const,
          "risk_state_invalid",
        ),
        summary: requireSafeInternalText(
          command.summary,
          4,
          500,
          "risk_summary_invalid",
        ),
        reason: requireText(command.reason, 8, 500, "risk_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async requestOwnershipTransfer(command: {
      readonly actor: AuthenticatedOperator;
      readonly workspaceId: string;
      readonly successorUserId: string;
      readonly approvalReference: string;
      readonly confirmation: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      const workspaceId = requireIdentifier(
        command.workspaceId,
        "workspace_id_invalid",
      );
      const successorUserId = requireIdentifier(
        command.successorUserId,
        "successor_user_id_invalid",
      );
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:workspaces:transfer",
        requireRecentStepUp: true,
        now: commandTime,
      });
      if (
        command.confirmation.trim() !==
        `TRANSFER ${workspaceId} TO ${successorUserId}`
      ) {
        reject("ownership_transfer_confirmation_invalid");
      }
      const result = await input.store.requestOwnershipTransfer({
        actorId: command.actor.operatorId,
        environment: input.environment,
        workspaceId,
        successorUserId,
        approvalReference: requireText(
          command.approvalReference,
          3,
          200,
          "ownership_transfer_approval_required",
        ),
        reason: requireText(
          command.reason,
          8,
          500,
          "ownership_transfer_reason_required",
        ),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async recordOwnershipTransferObservation(command: {
      readonly actor: AuthenticatedOperator;
      readonly transferId: string;
      readonly sourceRevision: string;
      readonly observedState: CustomerOwnershipTransferObservedState;
      readonly observedOwnerUserId?: string | null;
      readonly message?: string | null;
      readonly observedAt: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:customer-ownership:sync",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: commandTime,
      });
      const observedState = requireEnum(
        command.observedState,
        ["observed", "failed"] as const,
        "ownership_observation_state_invalid",
      );
      const observedOwnerUserId =
        command.observedOwnerUserId === undefined ||
        command.observedOwnerUserId === null
          ? null
          : requireIdentifier(
              command.observedOwnerUserId,
              "observed_owner_user_id_invalid",
            );
      const message =
        command.message === undefined || command.message === null
          ? null
          : requireText(
              command.message,
              1,
              500,
              "ownership_observation_message_invalid",
            );
      if (
        (observedState === "observed" && observedOwnerUserId === null) ||
        (observedState === "failed" && message === null)
      ) {
        reject("ownership_observation_shape_invalid");
      }
      const result = await input.store.recordOwnershipTransferObservation({
        actorId: command.actor.operatorId,
        environment: input.environment,
        transferId: requireUuid(
          command.transferId,
          "ownership_transfer_id_invalid",
        ),
        sourceRevision: requireSourceRevision(command.sourceRevision),
        observedState,
        observedOwnerUserId,
        message,
        observedAt: requireObservedAt(command.observedAt, commandTime),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },
  };
}

function assertRestrictionAuthorized(
  actor: AuthenticatedOperator,
  targetType: CustomerDirectoryEntityType,
  requireStepUp: boolean,
  now: Date,
) {
  assertPlatformCommandAuthorized({
    actor,
    requestedCapability:
      targetType === "user"
        ? "platform:users:restrict"
        : "platform:workspaces:restrict",
    requireRecentStepUp: requireStepUp,
    now,
  });
}

function assertAnyDirectoryRead(actor: AuthenticatedOperator) {
  if (
    !operatorHasCapability(actor, "platform:users:read") &&
    !operatorHasCapability(actor, "platform:workspaces:read")
  ) {
    reject("directory_read_capability_required");
  }
}

function assertSearchAuthorized(
  actor: AuthenticatedOperator,
  scope: CustomerDirectorySearchScope,
) {
  const normalized = requireSearchScope(scope);
  if (normalized === "users" || normalized === "all") {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:users:read",
    });
  }
  if (normalized === "workspaces" || normalized === "all") {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:workspaces:read",
    });
  }
}

function requireUsers(values: ReadonlyArray<CustomerDirectorySnapshotUser>) {
  if (!Array.isArray(values) || values.length > 500) reject("users_invalid");
  return values.map((value) => ({
    id: requireIdentifier(value.id, "user_id_invalid"),
    email: requireEmail(value.email),
    displayName: requireText(value.displayName, 1, 160, "user_name_invalid"),
    lifecycle: requireEnum(
      value.lifecycle,
      ["active", "restricted", "suspended", "deactivated"] as const,
      "user_lifecycle_invalid",
    ),
    verificationStatus: requireEnum(
      value.verificationStatus,
      ["unverified", "pending", "verified"] as const,
      "user_verification_invalid",
    ),
    createdAt: requireDate(
      value.createdAt,
      "user_created_at_invalid",
    ).toISOString(),
  }));
}

function requireWorkspaces(
  values: ReadonlyArray<CustomerDirectorySnapshotWorkspace>,
) {
  if (!Array.isArray(values) || values.length > 500)
    reject("workspaces_invalid");
  return values.map((value) => ({
    id: requireIdentifier(value.id, "workspace_id_invalid"),
    organizationId: requireIdentifier(
      value.organizationId,
      "organization_id_invalid",
    ),
    name: requireText(value.name, 1, 160, "workspace_name_invalid"),
    slug:
      value.slug === undefined || value.slug === null
        ? null
        : requireText(
            value.slug,
            1,
            160,
            "workspace_slug_invalid",
          ).toLowerCase(),
    lifecycle: requireEnum(
      value.lifecycle,
      ["active", "restricted", "suspended", "archived"] as const,
      "workspace_lifecycle_invalid",
    ),
    ownerUserId:
      value.ownerUserId === undefined || value.ownerUserId === null
        ? null
        : requireIdentifier(value.ownerUserId, "workspace_owner_id_invalid"),
    createdAt: requireDate(
      value.createdAt,
      "workspace_created_at_invalid",
    ).toISOString(),
  }));
}

function requireMemberships(
  values: ReadonlyArray<CustomerDirectorySnapshotMembership>,
) {
  if (!Array.isArray(values) || values.length > 5_000)
    reject("memberships_invalid");
  return values.map((value) => ({
    id: requireIdentifier(value.id, "membership_id_invalid"),
    userId: requireIdentifier(value.userId, "membership_user_id_invalid"),
    workspaceId: requireIdentifier(
      value.workspaceId,
      "membership_workspace_id_invalid",
    ),
    role: requireText(
      value.role,
      1,
      80,
      "membership_role_invalid",
    ).toLowerCase(),
    lifecycle: requireEnum(
      value.lifecycle,
      ["invited", "active", "suspended", "removed"] as const,
      "membership_lifecycle_invalid",
    ),
    grantedPermissions: requirePermissions(value.grantedPermissions),
    deniedPermissions: requirePermissions(value.deniedPermissions),
    effectivePermissions: requirePermissions(value.effectivePermissions),
  }));
}

function requirePermissions(values: ReadonlyArray<string>) {
  if (!Array.isArray(values) || values.length > 200)
    reject("membership_permissions_invalid");
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase())),
  ];
  if (normalized.some((value) => !/^[a-z][a-z0-9:._-]{1,127}$/.test(value))) {
    reject("membership_permissions_invalid");
  }
  return normalized.sort();
}

function requireSearchScope(value: CustomerDirectorySearchScope) {
  return requireEnum(
    value,
    ["users", "workspaces", "all"] as const,
    "search_scope_invalid",
  );
}

function requireEntityType(value: CustomerDirectoryEntityType) {
  return requireEnum(
    value,
    ["user", "workspace"] as const,
    "entity_type_invalid",
  );
}

function requireRestrictionCapability(value: CustomerRestrictionCapability) {
  return requireEnum(
    value,
    [
      "login",
      "new_executions",
      "provider_mutations",
      "production_deployments",
      "integrations",
      "runner_access",
      "all_access",
    ] as const,
    "restriction_capability_invalid",
  );
}

function requireSearchQuery(value: string) {
  return requireText(value, 2, 200, "search_query_invalid").toLowerCase();
}

function requireLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50)
    reject("search_limit_invalid");
  return value;
}

function requireSourceRevision(value: string) {
  const normalized = value.trim();
  if (!/^[1-9][0-9]{0,18}$/.test(normalized)) reject("source_revision_invalid");
  return normalized;
}

function requireObservedAt(value: string, now: Date) {
  const date = requireDate(value, "observed_at_invalid");
  if (date.getTime() > now.getTime() + 5 * 60 * 1_000)
    reject("observed_at_in_future");
  return date;
}

function requireEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    reject("user_email_invalid");
  return email;
}

function requireIdentifier(value: string, reason: string) {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(normalized)) reject(reason);
  return normalized;
}

function requireUuid(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    )
  ) {
    reject(reason);
  }
  return normalized;
}

function requirePositiveInteger(value: number, reason: string) {
  if (!Number.isSafeInteger(value) || value < 1) reject(reason);
  return value;
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

function requireSafeInternalText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = requireText(value, minimum, maximum, reason);
  if (
    /(?:-----BEGIN [A-Z ]+PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=])/iu.test(
      normalized,
    )
  ) {
    reject("customer_private_or_secret_content_rejected");
  }
  return normalized;
}

function requireDate(value: string, reason: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) reject(reason);
  return date;
}

function requireEnum<const Values extends ReadonlyArray<string>>(
  value: string,
  values: Values,
  reason: string,
): Values[number] {
  if (!values.includes(value)) reject(reason);
  return value as Values[number];
}

function assertUnique(values: ReadonlyArray<string>, reason: string) {
  if (new Set(values).size !== values.length) reject(reason);
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function reject(reason: string): never {
  throw new CustomerDirectoryRejectedError(reason);
}
