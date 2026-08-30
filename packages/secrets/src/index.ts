import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type PlatformConfigurationEnvironment,
  type PlatformSecretReferenceEntry,
} from "@atharvan/domain";

export interface PlatformSecretMaterialProvider {
  readonly configured: boolean;
  create(input: {
    readonly name: string;
    readonly value: string;
    readonly comment: string;
  }): Promise<{ readonly externalId: string }>;
  rotate(input: {
    readonly externalId: string;
    readonly value: string;
    readonly comment: string;
  }): Promise<void>;
  revoke(input: { readonly externalId: string }): Promise<void>;
}

export interface PlatformSecretLifecycleStore {
  listReferences(): Promise<ReadonlyArray<PlatformSecretReferenceEntry>>;
  beginCreate(input: {
    readonly actorId: string;
    readonly referenceId: string;
    readonly versionId: string;
    readonly key: string;
    readonly purpose: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly providerName: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "created" }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  completeCreate(input: {
    readonly referenceId: string;
    readonly versionId: string;
    readonly externalId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  failCreate(input: {
    readonly referenceId: string;
    readonly versionId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  beginRotation(input: {
    readonly referenceId: string;
    readonly versionId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | {
        readonly outcome: "started";
        readonly externalId: string;
        readonly providerName: string;
      }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  completeRotation(input: {
    readonly referenceId: string;
    readonly versionId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  failRotation(input: {
    readonly referenceId: string;
    readonly versionId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  beginRevocation(input: {
    readonly referenceId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<
    | { readonly outcome: "started"; readonly externalId: string }
    | { readonly outcome: "rejected"; readonly reason: string }
  >;
  completeRevocation(input: {
    readonly referenceId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
  failRevocation(input: {
    readonly referenceId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly correlationId: string;
    readonly now: Date;
  }): Promise<void>;
}

export class PlatformSecretCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super("platform_secret_command_rejected");
  }
}

export class PlatformSecretProviderError extends Error {
  constructor(readonly reason: "unconfigured" | "request_failed") {
    super("platform_secret_provider_error");
  }
}

export function createPlatformSecretLifecycleService(input: {
  readonly store: PlatformSecretLifecycleStore;
  readonly provider: PlatformSecretMaterialProvider;
  readonly environment: PlatformConfigurationEnvironment;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const randomId = input.randomId ?? (() => crypto.randomUUID());

  function authorize(actor: AuthenticatedOperator, commandTime: Date) {
    assertPlatformCommandAuthorized({
      actor,
      requestedCapability: "platform:secrets:write",
      requireSuperAdministrator: true,
      requireRecentStepUp: true,
      now: commandTime,
    });
    if (!input.provider.configured) {
      throw new PlatformSecretProviderError("unconfigured");
    }
  }

  return {
    listReferences: () => input.store.listReferences(),

    async create(command: {
      readonly actor: AuthenticatedOperator;
      readonly key: string;
      readonly purpose: string;
      readonly value: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime);
      const referenceId = randomId();
      const versionId = randomId();
      const correlationId = command.correlationId ?? randomId();
      const key = requireSecretKey(command.key);
      const purpose = requireText(
        command.purpose,
        8,
        300,
        "secret_purpose_required",
      );
      const reason = requireText(
        command.reason,
        8,
        500,
        "command_reason_required",
      );
      const value = requireSecretValue(command.value);
      const providerName = createProviderName(
        input.environment,
        key,
        referenceId,
      );
      const reserved = await input.store.beginCreate({
        actorId: command.actor.operatorId,
        referenceId,
        versionId,
        key,
        purpose,
        environment: input.environment,
        providerName,
        reason,
        correlationId,
        now: commandTime,
      });
      if (reserved.outcome === "rejected") {
        throw new PlatformSecretCommandRejectedError(reserved.reason);
      }

      try {
        const created = await input.provider.create({
          name: providerName,
          value,
          comment: `Atharvan ${input.environment}: ${purpose}`,
        });
        await input.store.completeCreate({
          referenceId,
          versionId,
          externalId: created.externalId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
      } catch (error) {
        await input.store.failCreate({
          referenceId,
          versionId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
        throw sanitizeProviderFailure(error);
      }

      return { outcome: "created" as const, id: referenceId };
    },

    async rotate(command: {
      readonly actor: AuthenticatedOperator;
      readonly referenceId: string;
      readonly value: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime);
      const referenceId = requireUuid(command.referenceId);
      const versionId = randomId();
      const correlationId = command.correlationId ?? randomId();
      const reason = requireText(
        command.reason,
        8,
        500,
        "command_reason_required",
      );
      const value = requireSecretValue(command.value);
      const started = await input.store.beginRotation({
        referenceId,
        versionId,
        actorId: command.actor.operatorId,
        reason,
        correlationId,
        now: commandTime,
      });
      if (started.outcome === "rejected") {
        throw new PlatformSecretCommandRejectedError(started.reason);
      }

      try {
        await input.provider.rotate({
          externalId: started.externalId,
          value,
          comment: `Atharvan ${input.environment}: ${started.providerName}`,
        });
        await input.store.completeRotation({
          referenceId,
          versionId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
      } catch (error) {
        await input.store.failRotation({
          referenceId,
          versionId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
        throw sanitizeProviderFailure(error);
      }

      return { outcome: "updated" as const, id: referenceId };
    },

    async revoke(command: {
      readonly actor: AuthenticatedOperator;
      readonly referenceId: string;
      readonly reason: string;
      readonly correlationId?: string;
    }) {
      const commandTime = now();
      authorize(command.actor, commandTime);
      const referenceId = requireUuid(command.referenceId);
      const correlationId = command.correlationId ?? randomId();
      const reason = requireText(
        command.reason,
        8,
        500,
        "command_reason_required",
      );
      const started = await input.store.beginRevocation({
        referenceId,
        actorId: command.actor.operatorId,
        reason,
        correlationId,
        now: commandTime,
      });
      if (started.outcome === "rejected") {
        throw new PlatformSecretCommandRejectedError(started.reason);
      }

      try {
        await input.provider.revoke({ externalId: started.externalId });
        await input.store.completeRevocation({
          referenceId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
      } catch (error) {
        await input.store.failRevocation({
          referenceId,
          actorId: command.actor.operatorId,
          reason,
          correlationId,
          now: now(),
        });
        throw sanitizeProviderFailure(error);
      }

      return { outcome: "updated" as const, id: referenceId };
    },
  };
}

export function createCloudflareSecretsStoreProvider(input: {
  readonly accountId: string;
  readonly storeId: string;
  readonly apiToken: string;
  readonly fetch?: typeof fetch;
}): PlatformSecretMaterialProvider {
  const request = input.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/secrets_store/stores/${encodeURIComponent(input.storeId)}/secrets`;

  async function call(path: string, init: RequestInit) {
    const response = await request(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${input.apiToken}`,
        "content-type": "application/json",
      },
    });
    if (!response.ok) throw new PlatformSecretProviderError("request_failed");
    return response;
  }

  return {
    configured: true,
    async create(secret) {
      const response = await call("", {
        method: "POST",
        body: JSON.stringify([{ ...secret, scopes: ["workers"] }]),
      });
      const body: unknown = await response.json();
      const externalId = readCloudflareCreatedId(body);
      if (externalId === null) {
        throw new PlatformSecretProviderError("request_failed");
      }
      return { externalId };
    },
    async rotate(secret) {
      await call(`/${encodeURIComponent(secret.externalId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          value: secret.value,
          comment: secret.comment,
          scopes: ["workers"],
        }),
      });
    },
    async revoke(secret) {
      const response = await request(
        `${base}/${encodeURIComponent(secret.externalId)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${input.apiToken}` },
        },
      );
      if (!response.ok && response.status !== 404) {
        throw new PlatformSecretProviderError("request_failed");
      }
    },
  };
}

export const unconfiguredPlatformSecretMaterialProvider: PlatformSecretMaterialProvider =
  {
    configured: false,
    create: () =>
      Promise.reject(new PlatformSecretProviderError("unconfigured")),
    rotate: () =>
      Promise.reject(new PlatformSecretProviderError("unconfigured")),
    revoke: () =>
      Promise.reject(new PlatformSecretProviderError("unconfigured")),
  };

function readCloudflareCreatedId(value: unknown): string | null {
  if (!isRecord(value) || !("result" in value)) return null;
  const result = value.result;
  const candidate = Array.isArray(result) ? result[0] : result;
  return isRecord(candidate) && typeof candidate.id === "string"
    ? candidate.id
    : null;
}

function createProviderName(
  environment: PlatformConfigurationEnvironment,
  key: string,
  referenceId: string,
) {
  return `atharvan_${environment}_${key.replaceAll(/[.-]/g, "_")}_${referenceId.slice(0, 8)}`;
}

function requireSecretKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    !/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/.test(normalized) ||
    normalized.length > 96
  ) {
    throw new PlatformSecretCommandRejectedError("invalid_secret_key");
  }
  return normalized;
}

function requireSecretValue(value: string): string {
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes === 0 || bytes > 1024) {
    throw new PlatformSecretCommandRejectedError("invalid_secret_value");
  }
  return value;
}

function requireText(
  value: string,
  minimum: number,
  maximum: number,
  reason: string,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PlatformSecretCommandRejectedError(reason);
  }
  return normalized;
}

function requireUuid(value: string) {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(normalized)) {
    throw new PlatformSecretCommandRejectedError("secret_reference_not_found");
  }
  return normalized;
}

function sanitizeProviderFailure(error: unknown): PlatformSecretProviderError {
  return error instanceof PlatformSecretProviderError
    ? error
    : new PlatformSecretProviderError("request_failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
