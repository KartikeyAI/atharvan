import {
  encodePlatformAuditCursor,
  type NormalizedPlatformAuditQuery,
  type PlatformCommandAuditStore,
} from "@atharvan/commands";
import type {
  PlatformAuditEventEntry,
  PlatformCommandOutcome,
  PlatformJsonValue,
} from "@atharvan/domain";
import { and, desc, eq, gte, like, lt, or, type SQL } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformCommandResults,
  platformCommands,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPostgresPlatformCommandAuditStore(
  database: Database,
): PlatformCommandAuditStore {
  return {
    async beginCommand(input) {
      return database.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(platformCommands)
          .values({
            id: input.commandId,
            environment: input.environment,
            name: input.name,
            version: input.version,
            actorId: input.actorId,
            targetType: input.targetType,
            targetId: input.targetId,
            expectedTargetVersion: input.expectedTargetVersion,
            payloadFingerprint: input.payloadFingerprint,
            idempotencyFingerprint: input.idempotencyFingerprint,
            correlationId: input.correlationId,
            reason: input.reason,
            approvalReference: input.approvalReference,
            evidenceReferences: [...input.evidenceReferences],
            requestedAt: input.requestedAt,
          })
          .onConflictDoNothing()
          .returning({ id: platformCommands.id });

        if (created !== undefined) {
          await transaction.insert(auditEvents).values({
            actorId: input.actorId,
            commandId: created.id,
            eventType: "platform.command.accepted",
            targetType: input.targetType,
            targetId: input.targetId,
            correlationId: input.correlationId,
            reason: input.reason,
            evidence: {
              commandName: input.name,
              commandVersion: input.version,
              environment: input.environment,
              expectedTargetVersion: input.expectedTargetVersion,
              payloadFingerprint: input.payloadFingerprint,
              approvalReference: input.approvalReference,
              evidenceReferences: [...input.evidenceReferences],
            },
            occurredAt: input.requestedAt,
          });
          return { state: "started", commandId: created.id };
        }

        const [existing] = await transaction
          .select()
          .from(platformCommands)
          .where(
            and(
              eq(platformCommands.environment, input.environment),
              eq(platformCommands.actorId, input.actorId),
              eq(platformCommands.name, input.name),
              eq(platformCommands.version, input.version),
              eq(
                platformCommands.idempotencyFingerprint,
                input.idempotencyFingerprint,
              ),
            ),
          )
          .limit(1);

        if (existing === undefined) {
          throw new Error("platform_command_state_conflict");
        }
        if (!sameEnvelope(existing, input)) {
          return { state: "conflict", commandId: existing.id };
        }

        const [result] = await transaction
          .select({
            outcome: platformCommandResults.outcome,
            responseStatus: platformCommandResults.responseStatus,
            responseBody: platformCommandResults.responseBody,
          })
          .from(platformCommandResults)
          .where(eq(platformCommandResults.commandId, existing.id))
          .limit(1);

        if (result === undefined) {
          return { state: "in_progress", commandId: existing.id };
        }

        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          commandId: existing.id,
          eventType: "platform.command.replayed",
          targetType: input.targetType,
          targetId: input.targetId,
          correlationId: existing.correlationId,
          reason: input.reason,
          evidence: {
            commandName: input.name,
            commandVersion: input.version,
            outcome: result.outcome,
          },
          occurredAt: input.requestedAt,
        });

        return {
          state: "replayed",
          commandId: existing.id,
          result,
        };
      });
    },

    async completeCommand(input) {
      return database.transaction(async (transaction) => {
        await assertCommandIdentity(transaction, input);
        const [created] = await transaction
          .insert(platformCommandResults)
          .values({
            commandId: input.commandId,
            outcome: input.outcome,
            responseStatus: input.responseStatus,
            responseBody: input.responseBody,
            completedAt: input.completedAt,
          })
          .onConflictDoNothing({
            target: platformCommandResults.commandId,
          })
          .returning({ id: platformCommandResults.id });

        if (created === undefined) {
          return { state: "already_completed" };
        }

        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          commandId: input.commandId,
          eventType: `platform.command.${input.outcome}`,
          targetType: input.targetType,
          targetId: input.targetId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            outcome: input.outcome,
            responseStatus: input.responseStatus,
          },
          occurredAt: input.completedAt,
        });
        return { state: "completed" };
      });
    },

    listAuditEvents: ({ query }) => loadAuditEvents(database, query),

    async exportAuditEvents({ query }) {
      const page = await loadAuditEvents(database, query, false);
      const truncated = page.items.length > 5000;
      return {
        items: truncated ? page.items.slice(0, 5000) : page.items,
        truncated,
      };
    },
  };
}

async function loadAuditEvents(
  database: Database,
  query: NormalizedPlatformAuditQuery,
  paginate = true,
) {
  const conditions: SQL[] = [];
  if (query.actorId !== null)
    conditions.push(eq(auditEvents.actorId, query.actorId));
  if (query.eventType !== null)
    conditions.push(like(auditEvents.eventType, `${query.eventType}%`));
  if (query.targetType !== null)
    conditions.push(eq(auditEvents.targetType, query.targetType));
  if (query.targetId !== null)
    conditions.push(eq(auditEvents.targetId, query.targetId));
  if (query.correlationId !== null)
    conditions.push(eq(auditEvents.correlationId, query.correlationId));
  if (query.commandName !== null)
    conditions.push(eq(platformCommands.name, query.commandName));
  if (query.outcome !== null)
    conditions.push(eq(platformCommandResults.outcome, query.outcome));
  if (query.from !== null)
    conditions.push(gte(auditEvents.occurredAt, query.from));
  if (query.to !== null) conditions.push(lt(auditEvents.occurredAt, query.to));
  if (query.cursor !== null) {
    conditions.push(
      or(
        lt(auditEvents.occurredAt, query.cursor.occurredAt),
        and(
          eq(auditEvents.occurredAt, query.cursor.occurredAt),
          lt(auditEvents.id, query.cursor.id),
        ),
      )!,
    );
  }

  const rows = await database
    .select({
      id: auditEvents.id,
      actorId: auditEvents.actorId,
      actorEmail: operators.email,
      eventType: auditEvents.eventType,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      correlationId: auditEvents.correlationId,
      reason: auditEvents.reason,
      evidence: auditEvents.evidence,
      occurredAt: auditEvents.occurredAt,
      commandId: platformCommands.id,
      commandName: platformCommands.name,
      commandVersion: platformCommands.version,
      commandEnvironment: platformCommands.environment,
      commandTargetType: platformCommands.targetType,
      commandTargetId: platformCommands.targetId,
      expectedTargetVersion: platformCommands.expectedTargetVersion,
      payloadFingerprint: platformCommands.payloadFingerprint,
      idempotencyFingerprint: platformCommands.idempotencyFingerprint,
      approvalReference: platformCommands.approvalReference,
      evidenceReferences: platformCommands.evidenceReferences,
      requestedAt: platformCommands.requestedAt,
      commandOutcome: platformCommandResults.outcome,
      completedAt: platformCommandResults.completedAt,
    })
    .from(auditEvents)
    .leftJoin(operators, eq(operators.id, auditEvents.actorId))
    .leftJoin(platformCommands, eq(platformCommands.id, auditEvents.commandId))
    .leftJoin(
      platformCommandResults,
      eq(platformCommandResults.commandId, platformCommands.id),
    )
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(paginate ? query.limit + 1 : query.limit);

  const hasNext = paginate && rows.length > query.limit;
  const selectedRows = hasNext ? rows.slice(0, query.limit) : rows;
  const items = selectedRows.map(mapAuditEvent);
  const last = selectedRows.at(-1);
  return {
    items,
    nextCursor:
      hasNext && last !== undefined
        ? encodePlatformAuditCursor(last.occurredAt, last.id)
        : null,
  };
}

function mapAuditEvent(row: {
  readonly id: string;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly eventType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly correlationId: string;
  readonly reason: string | null;
  readonly evidence: unknown;
  readonly occurredAt: Date;
  readonly commandId: string | null;
  readonly commandName: string | null;
  readonly commandVersion: number | null;
  readonly commandEnvironment: "development" | "production" | "test" | null;
  readonly commandTargetType: string | null;
  readonly commandTargetId: string | null;
  readonly expectedTargetVersion: number | null;
  readonly payloadFingerprint: string | null;
  readonly idempotencyFingerprint: string | null;
  readonly approvalReference: string | null;
  readonly evidenceReferences: ReadonlyArray<string> | null;
  readonly requestedAt: Date | null;
  readonly commandOutcome: PlatformCommandOutcome | null;
  readonly completedAt: Date | null;
}): PlatformAuditEventEntry {
  const command =
    row.commandId === null ||
    row.commandName === null ||
    row.commandVersion === null ||
    row.commandEnvironment === null ||
    row.commandTargetType === null ||
    row.commandTargetId === null ||
    row.payloadFingerprint === null ||
    row.idempotencyFingerprint === null ||
    row.requestedAt === null
      ? null
      : {
          id: row.commandId,
          name: row.commandName,
          version: row.commandVersion,
          environment: row.commandEnvironment,
          targetType: row.commandTargetType,
          targetId: row.commandTargetId,
          expectedTargetVersion: row.expectedTargetVersion,
          payloadFingerprint: row.payloadFingerprint,
          idempotencyFingerprint: row.idempotencyFingerprint,
          approvalReference: row.approvalReference,
          evidenceReferences: row.evidenceReferences ?? [],
          requestedAt: row.requestedAt.toISOString(),
          outcome: row.commandOutcome,
          completedAt: row.completedAt?.toISOString() ?? null,
        };
  return {
    id: row.id,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    eventType: row.eventType,
    targetType: row.targetType,
    targetId: row.targetId,
    correlationId: row.correlationId,
    reason: row.reason,
    evidence: row.evidence as PlatformJsonValue,
    occurredAt: row.occurredAt.toISOString(),
    command,
  };
}

async function assertCommandIdentity(
  transaction: Transaction,
  input: {
    readonly commandId: string;
    readonly actorId: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly correlationId: string;
  },
) {
  const [command] = await transaction
    .select({
      actorId: platformCommands.actorId,
      targetType: platformCommands.targetType,
      targetId: platformCommands.targetId,
      correlationId: platformCommands.correlationId,
    })
    .from(platformCommands)
    .where(eq(platformCommands.id, input.commandId))
    .limit(1);
  if (
    command === undefined ||
    command.actorId !== input.actorId ||
    command.targetType !== input.targetType ||
    command.targetId !== input.targetId ||
    command.correlationId !== input.correlationId
  ) {
    throw new Error("platform_command_state_conflict");
  }
}

function sameEnvelope(
  existing: typeof platformCommands.$inferSelect,
  input: Parameters<PlatformCommandAuditStore["beginCommand"]>[0],
) {
  return (
    existing.targetType === input.targetType &&
    existing.targetId === input.targetId &&
    existing.expectedTargetVersion === input.expectedTargetVersion &&
    existing.payloadFingerprint === input.payloadFingerprint &&
    existing.reason === input.reason &&
    existing.approvalReference === input.approvalReference &&
    JSON.stringify(existing.evidenceReferences) ===
      JSON.stringify(input.evidenceReferences)
  );
}
