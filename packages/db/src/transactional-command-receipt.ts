import type {
  PlatformConfigurationEnvironment,
  PlatformJsonValue,
} from "@atharvan/domain";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import * as schema from "./schema";
import {
  auditEvents,
  platformCommands,
  platformCommandResults,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Persist the replay receipt with the domain effect, using the caller's transaction.
 * Any identity mismatch or duplicate receipt aborts the entire domain transaction.
 * The HTTP wrapper may subsequently acknowledge the existing receipt without
 * repeating the mutation; a dropped response is recoverable by idempotent replay.
 */
export async function recordTransactionalCommandSuccess(
  tx: Transaction,
  input: {
    readonly commandId: string;
    readonly actorId: string;
    readonly environment: PlatformConfigurationEnvironment;
    readonly name: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly correlationId: string;
    readonly reason: string;
    readonly now: Date;
  },
  result: PlatformJsonValue & {
    readonly outcome: "created" | "already_exists" | "updated" | "unchanged";
  },
): Promise<void> {
  const [command] = await tx
    .select()
    .from(platformCommands)
    .where(eq(platformCommands.id, input.commandId))
    .for("share");
  if (
    !command ||
    command.actorId !== input.actorId ||
    command.environment !== input.environment ||
    command.name !== input.name ||
    command.version !== 1 ||
    command.targetType !== input.targetType ||
    command.targetId !== input.targetId ||
    command.correlationId !== input.correlationId ||
    command.reason !== input.reason
  ) {
    throw new Error("platform_command_state_conflict");
  }
  const responseStatus = result.outcome === "created" ? 201 : 200;
  // Deliberately no ON CONFLICT: a second domain effect must not commit against
  // an existing receipt, even if a caller accidentally bypasses begin/replay.
  await tx.insert(platformCommandResults).values({
    commandId: command.id,
    outcome: "succeeded",
    responseStatus,
    responseBody: result,
    completedAt: input.now,
  });
  await tx.insert(auditEvents).values({
    actorId: input.actorId,
    commandId: command.id,
    eventType: "platform.command.succeeded",
    targetType: input.targetType,
    targetId: input.targetId,
    correlationId: input.correlationId,
    reason: input.reason,
    evidence: { outcome: "succeeded", responseStatus, atomicReceipt: true },
    occurredAt: input.now,
  });
}
