import type {
  OperatorSessionIdentity,
  OperatorSessionInventory,
  PlatformConfigurationEnvironment,
  RevokeOwnSessionInput,
} from "@atharvan/domain";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import type * as schema from "./schema";
import { recordTransactionalCommandSuccess } from "./transactional-command-receipt";

/** Fixed projections prevent bearer tokens from crossing the database boundary. */
export function ownSessionInventoryQuery(
  identity: OperatorSessionIdentity,
  now: Date,
) {
  return sql`SELECT s.id, (s.id = ${identity.sessionId}) AS current,
    s.created_at AS "createdAt", s.expires_at AS "expiresAt",
    s.authentication_method AS "authenticationMethod",
    left(s.user_agent, 300) AS "userAgent", left(s.ip_address, 64) AS "ipAddress"
    FROM auth.session s WHERE s.user_id = ${identity.userId}
      AND s.expires_at > ${now.toISOString()}::timestamptz
      AND EXISTS (SELECT 1 FROM auth.session c JOIN public.operators o ON o.auth_user_id = c.user_id
        WHERE c.id = ${identity.sessionId} AND c.user_id = ${identity.userId}
        AND c.expires_at > ${now.toISOString()}::timestamptz AND c.authentication_method = 'passkey'
        AND o.status = 'active')
    ORDER BY current DESC, s.created_at DESC, s.id DESC LIMIT 101`;
}

/** One PostgreSQL statement makes deletion conditional on its immutable audit write. */
export function revokeOwnSessionQuery(input: RevokeOwnSessionInput, now: Date) {
  return sql`WITH removed AS (
    DELETE FROM auth.session s WHERE s.id = ${input.targetSessionId}
      AND s.user_id = ${input.userId} AND s.id <> ${input.sessionId}
      AND s.expires_at > ${now.toISOString()}::timestamptz
      AND EXISTS (SELECT 1 FROM auth.session c JOIN public.operators o ON o.auth_user_id = c.user_id
        WHERE c.id = ${input.sessionId} AND c.user_id = ${input.userId}
        AND o.id = ${input.operatorId}::uuid AND o.status = 'active'
        AND c.expires_at > ${now.toISOString()}::timestamptz
        AND c.authentication_method = 'passkey'
        AND c.strong_authentication_at <= ${now.toISOString()}::timestamptz
        AND c.strong_authentication_at >= ${new Date(now.getTime() - 300_000).toISOString()}::timestamptz)
    RETURNING s.id
  ) INSERT INTO public.audit_events (actor_id, event_type, target_type, target_id, correlation_id, reason, evidence, occurred_at)
    SELECT ${input.operatorId}::uuid, 'platform.operator.session_revoked', 'operator_session', id,
      ${input.correlationId}::uuid, ${input.reason}, '{"scope":"self"}'::jsonb, ${now.toISOString()}::timestamptz
    FROM removed RETURNING target_id AS id`;
}

function rows(result: unknown): Array<Record<string, unknown>> {
  if (
    typeof result !== "object" ||
    result === null ||
    !("rows" in result) ||
    !Array.isArray(result.rows)
  )
    throw new Error("invalid_session_result");
  return result.rows;
}

export function createPostgresOperatorSessions(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
  environment?: PlatformConfigurationEnvironment,
) {
  return {
    async list(
      identity: OperatorSessionIdentity,
      now = new Date(),
    ): Promise<OperatorSessionInventory> {
      const result = rows(
        await database.execute(ownSessionInventoryQuery(identity, now)),
      );
      return {
        observedAt: now.toISOString(),
        truncated: result.length > 100,
        items: result.slice(0, 100).map((row) => ({
          id: String(row.id),
          current: row.current === true,
          createdAt: new Date(row.createdAt as string | Date).toISOString(),
          expiresAt: new Date(row.expiresAt as string | Date).toISOString(),
          authenticationMethod:
            row.authenticationMethod === "passkey" ? "passkey" : "email_otp",
          userAgent:
            typeof row.userAgent === "string"
              ? row.userAgent.replace(/[\u0000-\u001f\u007f]/g, " ")
              : null,
          ipAddress: typeof row.ipAddress === "string" ? row.ipAddress : null,
        })),
      };
    },
    async revoke(
      input: RevokeOwnSessionInput,
      now = new Date(),
    ): Promise<{ outcome: "updated" | "unchanged" }> {
      if (input.targetSessionId === input.sessionId)
        throw new Error("current_session_protected");
      return database.transaction(async (transaction) => {
        const rowsAffected = rows(
          await transaction.execute(revokeOwnSessionQuery(input, now)),
        );
        const result = {
          outcome: rowsAffected.length === 1 ? "updated" : "unchanged",
        } as const;
        if (input.commandId !== undefined && environment !== undefined) {
          await recordTransactionalCommandSuccess(
            transaction,
            {
              commandId: input.commandId,
              actorId: input.operatorId,
              environment,
              name: "operator.session.revoke",
              targetType: "operator_session",
              targetId: input.targetSessionId,
              correlationId: input.correlationId,
              reason: input.reason,
              now,
            },
            result,
          );
        }
        return result;
      });
    },
  };
}
