import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createPostgresOperatorSessions,
  ownSessionInventoryQuery,
  revokeOwnSessionQuery,
} from "./operator-sessions";

const now = new Date("2026-09-04T12:00:00Z");
const identity = { userId: "auth-user", sessionId: "current-session" };
const input = {
  ...identity,
  targetSessionId: "other-session",
  operatorId: "00000000-0000-4000-8000-000000000001",
  correlationId: "00000000-0000-4000-8000-000000000002",
  reason: "Retire an unused session",
};
type Database = Parameters<typeof createPostgresOperatorSessions>[0];

describe("operator session database boundary", () => {
  it("uses an explicit owner-scoped projection that never selects session tokens", () => {
    const query = new PgDialect().sqlToQuery(
      ownSessionInventoryQuery(identity, now),
    );
    expect(query.sql).not.toContain("token");
    expect(query.params).toContain(identity.userId);
    expect(query.params).toContain(identity.sessionId);
    expect(query.sql).toContain("LIMIT 101");
    expect(query.sql).toContain("o.status = 'active'");
  });
  it("binds both ownership and current-session proof inside the audited deletion", () => {
    const query = new PgDialect().sqlToQuery(revokeOwnSessionQuery(input, now));
    expect(query.sql).toContain("s.id <>");
    expect(query.sql).toContain("c.strong_authentication_at >=");
    expect(query.sql).toContain("INSERT INTO public.audit_events");
    expect(query.sql).toContain("FROM removed RETURNING");
    expect(query.params).toContain("2026-09-04T11:55:00.000Z");
    expect(query.params).toContain(input.operatorId);
    expect(query.sql).not.toContain("token");
  });
  it("bounds output, preserves current status, and strips control characters", async () => {
    const row = {
      id: "session",
      current: true,
      authenticationMethod: "passkey",
      createdAt: now,
      expiresAt: now,
      userAgent: "device\nname",
      ipAddress: null,
      token: "not-for-api",
    };
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: Array.from({ length: 101 }, () => row) });
    const inventory = await createPostgresOperatorSessions({
      execute,
    } as unknown as Database).list(identity, now);
    expect(inventory.items).toHaveLength(100);
    expect(inventory.truncated).toBe(true);
    expect(inventory.items[0]?.userAgent).toBe("device name");
    expect(JSON.stringify(inventory)).not.toContain("not-for-api");
  });
  it("refuses direct attempts to revoke the current session", async () => {
    const execute = vi.fn();
    await expect(
      createPostgresOperatorSessions({ execute } as unknown as Database).revoke(
        { ...input, targetSessionId: identity.sessionId },
        now,
      ),
    ).rejects.toThrow("current_session_protected");
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not report revocation when no owner-scoped row was removed", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: input.targetSessionId }] });
    const store = createPostgresOperatorSessions({
      execute,
    } as unknown as Database);
    await expect(store.revoke(input, now)).resolves.toEqual({
      outcome: "unchanged",
    });
    await expect(store.revoke(input, now)).resolves.toEqual({
      outcome: "updated",
    });
  });
  it("propagates an audit-write failure instead of claiming success", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error("audit write rejected"));
    await expect(
      createPostgresOperatorSessions({ execute } as unknown as Database).revoke(
        input,
        now,
      ),
    ).rejects.toThrow("audit write rejected");
  });
});
