import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformConfigurationEnvironment,
  type PlatformFeatureFlagEntry,
  type PlatformFeatureFlagEvaluation,
  type PlatformFeatureFlagEvaluationContext,
  type PlatformFeatureFlagLifecycle,
  type PlatformFeatureFlagRegistry,
  type PlatformFeatureFlagRule,
} from "@atharvan/domain";

export type PlatformFeatureFlagCommandResult =
  | {
      readonly outcome: "created" | "updated" | "unchanged";
      readonly id: string;
      readonly revisionNumber: number;
    }
  | { readonly outcome: "rejected"; readonly reason: string };

export interface PlatformFeatureFlagStore {
  listFlags(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly now: Date;
  }): Promise<PlatformFeatureFlagRegistry>;
  findFlag(input: {
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly now: Date;
  }): Promise<PlatformFeatureFlagEntry | null>;
  setFlag(input: {
    readonly actorId: string;
    readonly flagId: string;
    readonly revisionId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly key: string;
    readonly displayName: string;
    readonly purpose: string;
    readonly ownerOperatorId: string;
    readonly lifecycle: PlatformFeatureFlagLifecycle;
    readonly defaultEnabled: boolean;
    readonly emergencyDisabled: boolean;
    readonly rules: ReadonlyArray<PlatformFeatureFlagRule>;
    readonly reviewAt: Date;
    readonly expiresAt: Date | null;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<PlatformFeatureFlagCommandResult>;
}

export class PlatformFeatureFlagCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_feature_flag_command_rejected");
  }
}

export interface SetPlatformFeatureFlagCommand {
  readonly actor: AuthenticatedOperator;
  readonly key: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly ownerOperatorId: string;
  readonly lifecycle: PlatformFeatureFlagLifecycle;
  readonly defaultEnabled: boolean;
  readonly emergencyDisabled: boolean;
  readonly rules: ReadonlyArray<PlatformFeatureFlagRule>;
  readonly reviewAt: string;
  readonly expiresAt?: string | null;
  readonly reason: string;
  readonly correlationId?: string;
}

export function createPlatformFeatureFlagService(input: {
  readonly store: PlatformFeatureFlagStore;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  return {
    listFlags: () =>
      input.store.listFlags({ environment: input.environment, now: now() }),

    async setFlag(command: SetPlatformFeatureFlagCommand) {
      const commandTime = now();
      assertPlatformCommandAuthorized({
        actor: command.actor,
        requestedCapability: "platform:feature-flags:write",
        requireRecentStepUp: true,
        now: commandTime,
      });
      const lifecycle = requireLifecycle(command.lifecycle);
      const reviewAt = requireDate(command.reviewAt, "flag_review_at_invalid");
      const expiresAt = requireOptionalDate(
        command.expiresAt ?? null,
        "flag_expires_at_invalid",
      );

      if (
        lifecycle !== "archived" &&
        reviewAt.getTime() <= commandTime.getTime()
      ) {
        reject("flag_review_must_be_future");
      }
      if (
        lifecycle !== "archived" &&
        expiresAt !== null &&
        (expiresAt.getTime() <= commandTime.getTime() ||
          expiresAt.getTime() <= reviewAt.getTime())
      ) {
        reject("flag_expiry_must_follow_review");
      }

      const result = await input.store.setFlag({
        actorId: command.actor.operatorId,
        flagId: randomId(),
        revisionId: randomId(),
        environment: input.environment,
        key: requireKey(command.key),
        displayName: requireText(
          command.displayName,
          2,
          120,
          "flag_name_required",
        ),
        purpose: requireText(command.purpose, 8, 500, "flag_purpose_required"),
        ownerOperatorId: requireUuid(
          command.ownerOperatorId,
          "flag_owner_invalid",
        ),
        lifecycle,
        defaultEnabled: requireBoolean(
          command.defaultEnabled,
          "flag_default_invalid",
        ),
        emergencyDisabled: requireBoolean(
          command.emergencyDisabled,
          "flag_kill_switch_invalid",
        ),
        rules: requireRules(command.rules),
        reviewAt,
        expiresAt,
        reason: requireText(command.reason, 8, 500, "command_reason_required"),
        correlationId: command.correlationId ?? randomId(),
        now: commandTime,
      });
      if (result.outcome === "rejected") reject(result.reason);
      return result;
    },

    async evaluate(
      key: string,
      context: PlatformFeatureFlagEvaluationContext,
    ): Promise<PlatformFeatureFlagEvaluation> {
      const evaluatedAt = now();
      const normalizedKey = requireKey(key);
      const normalizedContext = requireEvaluationContext(context);
      const flag = await input.store.findFlag({
        environment: input.environment,
        key: normalizedKey,
        now: evaluatedAt,
      });
      if (flag === null) {
        return decision(
          normalizedKey,
          input.environment,
          false,
          "flag_not_found",
          null,
          null,
          null,
          evaluatedAt,
        );
      }
      const revision = flag.current;
      if (revision.lifecycle !== "active") {
        return decision(
          normalizedKey,
          input.environment,
          false,
          "flag_not_active",
          revision.revisionNumber,
          null,
          null,
          evaluatedAt,
        );
      }
      if (
        new Date(revision.reviewAt).getTime() >
        new Date(revision.expiresAt ?? "9999-12-31").getTime()
      ) {
        throw new Error("feature_flag_state_invalid");
      }
      if (
        revision.expiresAt !== null &&
        new Date(revision.expiresAt).getTime() <= evaluatedAt.getTime()
      ) {
        return decision(
          normalizedKey,
          input.environment,
          false,
          "flag_expired",
          revision.revisionNumber,
          null,
          null,
          evaluatedAt,
        );
      }
      if (revision.emergencyDisabled) {
        return decision(
          normalizedKey,
          input.environment,
          false,
          "emergency_disabled",
          revision.revisionNumber,
          null,
          null,
          evaluatedAt,
        );
      }
      for (const rule of revision.rules) {
        const match = ruleMatches(normalizedKey, rule, normalizedContext);
        if (match.matches) {
          return decision(
            normalizedKey,
            input.environment,
            rule.enabled,
            "targeting_rule",
            revision.revisionNumber,
            rule.id,
            match.bucket,
            evaluatedAt,
          );
        }
      }
      return decision(
        normalizedKey,
        input.environment,
        revision.defaultEnabled,
        "default",
        revision.revisionNumber,
        null,
        null,
        evaluatedAt,
      );
    },
  };
}

function ruleMatches(
  flagKey: string,
  rule: PlatformFeatureFlagRule,
  context: Required<
    Pick<PlatformFeatureFlagEvaluationContext, "stableRoutingKey" | "cohorts">
  > &
    Omit<PlatformFeatureFlagEvaluationContext, "stableRoutingKey" | "cohorts">,
) {
  if (rule.planKeys.length > 0 && !includes(rule.planKeys, context.planKey))
    return { matches: false, bucket: null };
  if (
    rule.workspaceIds.length > 0 &&
    !includes(rule.workspaceIds, context.workspaceId)
  )
    return { matches: false, bucket: null };
  if (rule.userIds.length > 0 && !includes(rule.userIds, context.userId))
    return { matches: false, bucket: null };
  if (rule.regions.length > 0 && !includes(rule.regions, context.region))
    return { matches: false, bucket: null };
  if (
    rule.cohorts.length > 0 &&
    !rule.cohorts.some((cohort) => context.cohorts.includes(cohort))
  )
    return { matches: false, bucket: null };
  if (
    rule.internalStaff !== null &&
    rule.internalStaff !== context.internalStaff
  )
    return { matches: false, bucket: null };
  if (
    rule.minimumAccountAgeDays !== null &&
    (context.accountAgeDays === undefined ||
      context.accountAgeDays < rule.minimumAccountAgeDays)
  )
    return { matches: false, bucket: null };
  if (
    rule.maximumAccountAgeDays !== null &&
    (context.accountAgeDays === undefined ||
      context.accountAgeDays > rule.maximumAccountAgeDays)
  )
    return { matches: false, bucket: null };
  const bucket = rolloutBucket(
    `${flagKey}:${rule.id}:${context.stableRoutingKey}`,
  );
  return { matches: bucket < rule.rolloutBasisPoints, bucket };
}

function rolloutBucket(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 10_000;
}

function decision(
  key: string,
  environment: PlatformConfigurationEnvironment,
  enabled: boolean,
  reason: PlatformFeatureFlagEvaluation["reason"],
  revisionNumber: number | null,
  matchedRuleId: string | null,
  rolloutBucketValue: number | null,
  evaluatedAt: Date,
): PlatformFeatureFlagEvaluation {
  return {
    key,
    environment,
    enabled,
    reason,
    revisionNumber,
    matchedRuleId,
    rolloutBucket: rolloutBucketValue,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

function requireRules(values: ReadonlyArray<PlatformFeatureFlagRule>) {
  if (!Array.isArray(values) || values.length > 50)
    reject("flag_rules_invalid");
  const normalized = values.map((rule) => {
    if (typeof rule !== "object" || rule === null) reject("flag_rules_invalid");
    const minimumAccountAgeDays = requireNullableDayCount(
      rule.minimumAccountAgeDays,
    );
    const maximumAccountAgeDays = requireNullableDayCount(
      rule.maximumAccountAgeDays,
    );
    if (
      minimumAccountAgeDays !== null &&
      maximumAccountAgeDays !== null &&
      minimumAccountAgeDays > maximumAccountAgeDays
    )
      reject("flag_account_age_range_invalid");
    if (
      !Number.isSafeInteger(rule.rolloutBasisPoints) ||
      rule.rolloutBasisPoints < 0 ||
      rule.rolloutBasisPoints > 10_000
    )
      reject("flag_rollout_invalid");
    if (rule.internalStaff !== null && typeof rule.internalStaff !== "boolean")
      reject("flag_rules_invalid");
    return {
      id: requireIdentifier(rule.id, "flag_rule_id_invalid"),
      description: requireText(
        rule.description,
        3,
        240,
        "flag_rule_description_required",
      ),
      enabled: requireBoolean(rule.enabled, "flag_rule_result_invalid"),
      planKeys: requireStringSet(rule.planKeys, true),
      workspaceIds: requireStringSet(rule.workspaceIds, false),
      userIds: requireStringSet(rule.userIds, false),
      regions: requireStringSet(rule.regions, true),
      cohorts: requireStringSet(rule.cohorts, true),
      internalStaff: rule.internalStaff,
      minimumAccountAgeDays,
      maximumAccountAgeDays,
      rolloutBasisPoints: rule.rolloutBasisPoints,
    };
  });
  if (new Set(normalized.map((rule) => rule.id)).size !== normalized.length)
    reject("flag_rule_ids_duplicate");
  return normalized;
}

function requireEvaluationContext(
  context: PlatformFeatureFlagEvaluationContext,
) {
  return {
    stableRoutingKey: requireText(
      context.stableRoutingKey,
      1,
      200,
      "flag_routing_key_invalid",
    ),
    ...(context.planKey === undefined
      ? {}
      : { planKey: normalizeTarget(context.planKey, true) }),
    ...(context.workspaceId === undefined
      ? {}
      : { workspaceId: normalizeTarget(context.workspaceId, false) }),
    ...(context.userId === undefined
      ? {}
      : { userId: normalizeTarget(context.userId, false) }),
    ...(context.region === undefined
      ? {}
      : { region: normalizeTarget(context.region, true) }),
    cohorts: requireStringSet(context.cohorts ?? [], true),
    ...(context.internalStaff === undefined
      ? {}
      : {
          internalStaff: requireBoolean(
            context.internalStaff,
            "flag_internal_staff_invalid",
          ),
        }),
    ...(context.accountAgeDays === undefined
      ? {}
      : { accountAgeDays: requireDayCount(context.accountAgeDays) }),
  };
}

function requireStringSet(values: ReadonlyArray<string>, lowercase: boolean) {
  if (!Array.isArray(values) || values.length > 100)
    reject("flag_target_values_invalid");
  const normalized = [
    ...new Set(values.map((value) => normalizeTarget(value, lowercase))),
  ].sort();
  return normalized;
}

function normalizeTarget(value: string, lowercase: boolean) {
  const normalized = requireText(value, 1, 128, "flag_target_values_invalid");
  return lowercase ? normalized.toLowerCase() : normalized;
}

function requireNullableDayCount(value: number | null) {
  return value === null ? null : requireDayCount(value);
}

function requireDayCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36_500)
    reject("flag_account_age_invalid");
  return value;
}

function includes(
  values: ReadonlyArray<string>,
  candidate: string | undefined,
) {
  return candidate !== undefined && values.includes(candidate);
}

function requireLifecycle(value: PlatformFeatureFlagLifecycle) {
  if (value !== "draft" && value !== "active" && value !== "archived")
    reject("flag_lifecycle_invalid");
  return value;
}

function requireBoolean(value: boolean, reason: string) {
  if (typeof value !== "boolean") reject(reason);
  return value;
}

function requireKey(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_.-]{2,95}$/.test(normalized)) reject("flag_key_invalid");
  return normalized;
}

function requireIdentifier(value: string, reason: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(normalized)) reject(reason);
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

function requireDate(value: string, reason: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) reject(reason);
  return date;
}

function requireOptionalDate(value: string | null, reason: string) {
  return value === null || value.trim() === ""
    ? null
    : requireDate(value, reason);
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  if (typeof value !== "string") reject(reason);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum)
    reject(reason);
  return normalized;
}

function reject(reason: string): never {
  throw new PlatformFeatureFlagCommandRejectedError(reason);
}
