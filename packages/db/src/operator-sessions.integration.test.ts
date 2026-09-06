import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import { createPostgresOperatorSessions } from "./operator-sessions";
import { integrationDatabaseFromEnvironment } from "./integration-environment";

/** Run only against an isolated database branch. Every fixture and DDL change rolls back. */
describe.skipIf(process.env.ATHARVAN_RUN_SESSION_DB_TESTS !== "1")(
  "session security PostgreSQL contract",
  () => {
    it("enforces ownership, live proof, idempotent revocation, and atomic audit rollback", async () => {
      const client = new Client({
        connectionString: integrationDatabaseFromEnvironment(),
        connectionTimeoutMillis: 10_000,
        statement_timeout: 10_000,
      });
      const now = new Date();
      const userId = randomUUID();
      const foreignUserId = randomUUID();
      const operatorId = randomUUID();
      const current = randomUUID();
      const other = randomUUID();
      const foreign = randomUUID();
      const expired = randomUUID();
      const staleProof = randomUUID();
      const otp = randomUUID();
      const auditFailure = randomUUID();
      try {
        await client.connect();
        await client.query("BEGIN");
        for (const id of [userId, foreignUserId])
          await client.query(
            'INSERT INTO auth."user" (id, name, email) VALUES ($1, $2, $3)',
            [id, "Session QA", `${id}@session-qa.invalid`],
          );
        await client.query(
          "INSERT INTO public.operators (id, email, email_domain, status, activated_at, auth_user_id) VALUES ($1, $2, 'session-qa.invalid', 'active', $3, $4)",
          [operatorId, `${userId}@session-qa.invalid`, now, userId],
        );
        for (const id of [
          current,
          other,
          foreign,
          expired,
          staleProof,
          otp,
          auditFailure,
        ]) {
          await client.query(
            "INSERT INTO auth.session (id, user_id, token, expires_at, authentication_method, strong_authentication_at, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)",
            [
              id,
              id === foreign ? foreignUserId : userId,
              `qa-token-${id}`,
              new Date(now.getTime() + (id === expired ? -1 : 3_600_000)),
              id === otp ? "email_otp" : "passkey",
              id === otp
                ? null
                : new Date(now.getTime() - (id === staleProof ? 301_000 : 0)),
              "Fixture device",
            ],
          );
        }
        const store = createPostgresOperatorSessions(
          drizzle(client, { schema }),
        );
        const identity = { userId, sessionId: current };
        const input = {
          ...identity,
          operatorId,
          targetSessionId: other,
          reason: "Retire an unused session",
          correlationId: randomUUID(),
        };
        const inventory = await store.list(identity, now);
        expect(inventory.items[0]?.id).toBe(current);
        expect(
          inventory.items.some(
            (entry) => entry.id === foreign || entry.id === expired,
          ),
        ).toBe(false);
        expect(JSON.stringify(inventory)).not.toContain("qa-token");
        for (const targetSessionId of [foreign, expired, "missing-session"])
          await expect(
            store.revoke({ ...input, targetSessionId }, now),
          ).resolves.toEqual({ outcome: "unchanged" });
        for (const sessionId of [staleProof, otp, "missing-proof"])
          await expect(
            store.revoke({ ...input, sessionId }, now),
          ).resolves.toEqual({ outcome: "unchanged" });
        await expect(
          store.revoke({ ...input, targetSessionId: current }, now),
        ).rejects.toThrow("current_session_protected");
        await expect(store.revoke(input, now)).resolves.toEqual({
          outcome: "updated",
        });
        await expect(store.revoke(input, now)).resolves.toEqual({
          outcome: "unchanged",
        });
        expect(
          (
            await client.query("SELECT id FROM auth.session WHERE id = $1", [
              other,
            ])
          ).rows,
        ).toHaveLength(0);
        const audit = await client.query(
          "SELECT actor_id, evidence FROM public.audit_events WHERE event_type = 'platform.operator.session_revoked' AND target_id = $1",
          [other],
        );
        expect(audit.rows).toEqual([
          { actor_id: operatorId, evidence: { scope: "self" } },
        ]);

        // Force an actual audit INSERT failure after DELETE has selected its row.
        // A savepoint lets the test inspect the rolled-back statement in this transaction.
        await client.query(
          "CREATE FUNCTION pg_temp.reject_session_qa_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'platform.operator.session_revoked' AND NEW.reason = 'Reject audit fixture' THEN RAISE EXCEPTION 'session_qa_audit_rejected'; END IF; RETURN NEW; END; $$",
        );
        await client.query(
          "CREATE TRIGGER session_qa_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_session_qa_audit()",
        );
        await client.query("SAVEPOINT audit_failure");
        await expect(
          store.revoke(
            {
              ...input,
              targetSessionId: auditFailure,
              reason: "Reject audit fixture",
            },
            now,
          ),
        ).rejects.toThrow();
        await client.query("ROLLBACK TO SAVEPOINT audit_failure");
        expect(
          (
            await client.query("SELECT id FROM auth.session WHERE id = $1", [
              auditFailure,
            ])
          ).rows,
        ).toHaveLength(1);
        expect(
          (
            await client.query(
              "SELECT id FROM public.audit_events WHERE event_type = 'platform.operator.session_revoked' AND target_id = $1",
              [auditFailure],
            )
          ).rows,
        ).toHaveLength(0);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    }, 60_000);
  },
);
