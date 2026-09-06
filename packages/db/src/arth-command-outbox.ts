import type {
  ArthCommandPayload,
  PlatformConfigurationEnvironment,
} from "@atharvan/domain";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import { arthCommandOutbox } from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const commandLifetimeMilliseconds = 7 * 24 * 60 * 60_000;

/** Persists an authenticated Arth command in the caller's domain transaction. */
export async function enqueueArthCommand(
  transaction: Transaction,
  input: {
    readonly commandId: string | undefined;
    readonly environment: PlatformConfigurationEnvironment;
    readonly kind: ArthCommandPayload["kind"];
    readonly aggregateId: string;
    readonly aggregateRevision: number;
    readonly payload: ArthCommandPayload;
    readonly now: Date;
  },
) {
  // Some internal maintenance callers do not use the HTTP command envelope.
  if (input.commandId === undefined) return;
  const canonicalPayload = JSON.stringify(input.payload);
  const payloadSha256 = await sha256(canonicalPayload);
  await transaction.insert(arthCommandOutbox).values({
    commandId: input.commandId,
    environment: input.environment,
    kind: input.kind,
    aggregateId: input.aggregateId,
    aggregateRevision: input.aggregateRevision,
    payload: input.payload,
    payloadSha256,
    availableAt: input.now,
    expiresAt: new Date(input.now.getTime() + commandLifetimeMilliseconds),
    createdAt: input.now,
    updatedAt: input.now,
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
