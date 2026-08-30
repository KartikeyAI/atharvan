import type { CustomerDirectoryStore } from "@atharvan/customers";
import type {
  CustomerDirectoryStatus,
  CustomerUserSummary,
  CustomerWorkspaceMembership,
  CustomerWorkspaceSummary,
} from "@atharvan/domain";
import { and, asc, eq, ilike, lt, or } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  customerDirectorySources,
  customerUserProjections,
  customerWorkspaceMembershipProjections,
  customerWorkspaceProjections,
  operators,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReconcileInput = Parameters<
  CustomerDirectoryStore["reconcileSnapshot"]
>[0];
const staleAfterMs = 15 * 60 * 1_000;

export function createPostgresCustomerDirectoryStore(
  database: Database,
): CustomerDirectoryStore {
  return {
    getStatus: (input) => loadStatus(database, input.environment, input.now),

    searchAndAudit(input) {
      return database.transaction(async (transaction) => {
        const pattern = `%${escapeLike(input.query)}%`;
        const [status, users, workspaces] = await Promise.all([
          loadStatus(transaction, input.environment, input.now),
          input.scope === "workspaces"
            ? Promise.resolve([])
            : transaction
                .select()
                .from(customerUserProjections)
                .where(
                  and(
                    eq(customerUserProjections.environment, input.environment),
                    or(
                      ilike(customerUserProjections.sourceId, pattern),
                      ilike(customerUserProjections.email, pattern),
                      ilike(customerUserProjections.displayName, pattern),
                    ),
                  ),
                )
                .orderBy(asc(customerUserProjections.email))
                .limit(input.limit),
          input.scope === "users"
            ? Promise.resolve([])
            : transaction
                .select()
                .from(customerWorkspaceProjections)
                .where(
                  and(
                    eq(
                      customerWorkspaceProjections.environment,
                      input.environment,
                    ),
                    or(
                      ilike(customerWorkspaceProjections.sourceId, pattern),
                      ilike(
                        customerWorkspaceProjections.organizationId,
                        pattern,
                      ),
                      ilike(customerWorkspaceProjections.name, pattern),
                      ilike(customerWorkspaceProjections.slug, pattern),
                    ),
                  ),
                )
                .orderBy(asc(customerWorkspaceProjections.name))
                .limit(input.limit),
        ]);
        const mappedUsers = users.map(mapUser);
        const mappedWorkspaces = workspaces.map(mapWorkspace);
        await insertReadAudit(transaction, {
          actorId: input.actorId,
          eventType: "platform.customer_directory.searched",
          targetType: "customer_directory",
          targetId: input.scope,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            queryFingerprint: input.queryFingerprint,
            scope: input.scope,
            userResultCount: mappedUsers.length,
            workspaceResultCount: mappedWorkspaces.length,
            sourceRevision: status.sourceRevision,
            freshness: status.freshness,
          },
          occurredAt: input.now,
        });
        return {
          status,
          queryFingerprint: input.queryFingerprint,
          users: mappedUsers,
          workspaces: mappedWorkspaces,
        };
      });
    },

    inspectAndAudit(input) {
      return database.transaction(async (transaction) => {
        const status = await loadStatus(
          transaction,
          input.environment,
          input.now,
        );
        const inspection =
          input.entityType === "user"
            ? await inspectUser(
                transaction,
                input.environment,
                input.entityId,
                status,
              )
            : await inspectWorkspace(
                transaction,
                input.environment,
                input.entityId,
                status,
              );
        await insertReadAudit(transaction, {
          actorId: input.actorId,
          eventType: `platform.customer_directory.${input.entityType}_inspected`,
          targetType: `customer_${input.entityType}`,
          targetId: input.entityId,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            found: inspection !== null,
            sourceRevision: status.sourceRevision,
            freshness: status.freshness,
          },
          occurredAt: input.now,
        });
        return inspection;
      });
    },

    reconcileSnapshot(input) {
      return database.transaction(async (transaction) => {
        const [operator] = await transaction
          .select({ id: operators.id })
          .from(operators)
          .where(
            and(
              eq(operators.id, input.actorId),
              eq(operators.status, "active"),
            ),
          )
          .limit(1);
        if (operator === undefined)
          return { outcome: "rejected", reason: "operator_not_active" };

        const [current] = await transaction
          .select({ sourceRevision: customerDirectorySources.sourceRevision })
          .from(customerDirectorySources)
          .where(
            and(
              eq(customerDirectorySources.environment, input.environment),
              eq(customerDirectorySources.source, "arth"),
            ),
          )
          .limit(1)
          .for("update");
        const revision = BigInt(input.sourceRevision);
        if (current !== undefined && revision <= current.sourceRevision) {
          return {
            outcome: "unchanged",
            sourceRevision: current.sourceRevision.toString(),
          };
        }

        await upsertUsers(transaction, input, revision);
        await upsertWorkspaces(transaction, input, revision);
        await upsertMemberships(transaction, input, revision);
        await removePriorProjectionRows(
          transaction,
          input.environment,
          revision,
        );
        await transaction
          .insert(customerDirectorySources)
          .values({
            environment: input.environment,
            source: "arth",
            sourceRevision: revision,
            observedAt: input.observedAt,
            synchronizedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              customerDirectorySources.environment,
              customerDirectorySources.source,
            ],
            set: {
              sourceRevision: revision,
              observedAt: input.observedAt,
              synchronizedAt: input.now,
            },
          });
        return {
          outcome: "updated",
          sourceRevision: input.sourceRevision,
          users: input.users.length,
          workspaces: input.workspaces.length,
          memberships: input.memberships.length,
        };
      });
    },
  };
}

async function removePriorProjectionRows(
  transaction: Transaction,
  environment: ReconcileInput["environment"],
  revision: bigint,
) {
  await transaction
    .delete(customerWorkspaceMembershipProjections)
    .where(
      and(
        eq(customerWorkspaceMembershipProjections.environment, environment),
        lt(customerWorkspaceMembershipProjections.sourceRevision, revision),
      ),
    );
  await transaction
    .delete(customerUserProjections)
    .where(
      and(
        eq(customerUserProjections.environment, environment),
        lt(customerUserProjections.sourceRevision, revision),
      ),
    );
  await transaction
    .delete(customerWorkspaceProjections)
    .where(
      and(
        eq(customerWorkspaceProjections.environment, environment),
        lt(customerWorkspaceProjections.sourceRevision, revision),
      ),
    );
}

async function loadStatus(
  database: Database | Transaction,
  environment: ReconcileInput["environment"],
  now: Date,
): Promise<CustomerDirectoryStatus> {
  const [row] = await database
    .select()
    .from(customerDirectorySources)
    .where(
      and(
        eq(customerDirectorySources.environment, environment),
        eq(customerDirectorySources.source, "arth"),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return {
      environment,
      source: "arth",
      freshness: "unknown",
      sourceRevision: null,
      observedAt: null,
      synchronizedAt: null,
    };
  }
  return {
    environment,
    source: "arth",
    freshness:
      now.getTime() - row.observedAt.getTime() > staleAfterMs
        ? "stale"
        : "current",
    sourceRevision: row.sourceRevision.toString(),
    observedAt: row.observedAt.toISOString(),
    synchronizedAt: row.synchronizedAt.toISOString(),
  };
}

async function inspectUser(
  transaction: Transaction,
  environment: ReconcileInput["environment"],
  sourceId: string,
  status: CustomerDirectoryStatus,
) {
  const [row] = await transaction
    .select()
    .from(customerUserProjections)
    .where(
      and(
        eq(customerUserProjections.environment, environment),
        eq(customerUserProjections.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  const memberships = await transaction
    .select({
      membership: customerWorkspaceMembershipProjections,
      workspace: customerWorkspaceProjections,
    })
    .from(customerWorkspaceMembershipProjections)
    .innerJoin(
      customerWorkspaceProjections,
      and(
        eq(customerWorkspaceProjections.environment, environment),
        eq(
          customerWorkspaceProjections.sourceId,
          customerWorkspaceMembershipProjections.workspaceSourceId,
        ),
      ),
    )
    .where(
      and(
        eq(customerWorkspaceMembershipProjections.environment, environment),
        eq(customerWorkspaceMembershipProjections.userSourceId, sourceId),
      ),
    )
    .orderBy(asc(customerWorkspaceProjections.name));
  return {
    entityType: "user" as const,
    status,
    user: mapUser(row),
    memberships: memberships.map((value) => ({
      membership: mapMembership(value.membership),
      workspace: mapWorkspace(value.workspace),
    })),
  };
}

async function inspectWorkspace(
  transaction: Transaction,
  environment: ReconcileInput["environment"],
  sourceId: string,
  status: CustomerDirectoryStatus,
) {
  const [row] = await transaction
    .select()
    .from(customerWorkspaceProjections)
    .where(
      and(
        eq(customerWorkspaceProjections.environment, environment),
        eq(customerWorkspaceProjections.sourceId, sourceId),
      ),
    )
    .limit(1);
  if (row === undefined) return null;
  const memberships = await transaction
    .select({
      membership: customerWorkspaceMembershipProjections,
      user: customerUserProjections,
    })
    .from(customerWorkspaceMembershipProjections)
    .innerJoin(
      customerUserProjections,
      and(
        eq(customerUserProjections.environment, environment),
        eq(
          customerUserProjections.sourceId,
          customerWorkspaceMembershipProjections.userSourceId,
        ),
      ),
    )
    .where(
      and(
        eq(customerWorkspaceMembershipProjections.environment, environment),
        eq(customerWorkspaceMembershipProjections.workspaceSourceId, sourceId),
      ),
    )
    .orderBy(asc(customerUserProjections.email));
  return {
    entityType: "workspace" as const,
    status,
    workspace: mapWorkspace(row),
    memberships: memberships.map((value) => ({
      membership: mapMembership(value.membership),
      user: mapUser(value.user),
    })),
  };
}

async function upsertUsers(
  transaction: Transaction,
  input: ReconcileInput,
  revision: bigint,
) {
  for (const value of input.users) {
    await transaction
      .insert(customerUserProjections)
      .values({
        environment: input.environment,
        sourceId: value.id,
        email: value.email,
        displayName: value.displayName,
        lifecycle: value.lifecycle,
        verificationStatus: value.verificationStatus,
        sourceCreatedAt: new Date(value.createdAt),
        sourceRevision: revision,
        observedAt: input.observedAt,
        projectedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          customerUserProjections.environment,
          customerUserProjections.sourceId,
        ],
        set: {
          email: value.email,
          displayName: value.displayName,
          lifecycle: value.lifecycle,
          verificationStatus: value.verificationStatus,
          sourceCreatedAt: new Date(value.createdAt),
          sourceRevision: revision,
          observedAt: input.observedAt,
          projectedAt: input.now,
        },
      });
  }
}

async function upsertWorkspaces(
  transaction: Transaction,
  input: ReconcileInput,
  revision: bigint,
) {
  for (const value of input.workspaces) {
    await transaction
      .insert(customerWorkspaceProjections)
      .values({
        environment: input.environment,
        sourceId: value.id,
        organizationId: value.organizationId,
        name: value.name,
        slug: value.slug ?? null,
        lifecycle: value.lifecycle,
        sourceCreatedAt: new Date(value.createdAt),
        sourceRevision: revision,
        observedAt: input.observedAt,
        projectedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          customerWorkspaceProjections.environment,
          customerWorkspaceProjections.sourceId,
        ],
        set: {
          organizationId: value.organizationId,
          name: value.name,
          slug: value.slug ?? null,
          lifecycle: value.lifecycle,
          sourceCreatedAt: new Date(value.createdAt),
          sourceRevision: revision,
          observedAt: input.observedAt,
          projectedAt: input.now,
        },
      });
  }
}

async function upsertMemberships(
  transaction: Transaction,
  input: ReconcileInput,
  revision: bigint,
) {
  for (const value of input.memberships) {
    await transaction
      .insert(customerWorkspaceMembershipProjections)
      .values({
        environment: input.environment,
        sourceId: value.id,
        userSourceId: value.userId,
        workspaceSourceId: value.workspaceId,
        role: value.role,
        lifecycle: value.lifecycle,
        grantedPermissions: [...value.grantedPermissions],
        deniedPermissions: [...value.deniedPermissions],
        effectivePermissions: [...value.effectivePermissions],
        sourceRevision: revision,
        observedAt: input.observedAt,
        projectedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [
          customerWorkspaceMembershipProjections.environment,
          customerWorkspaceMembershipProjections.sourceId,
        ],
        set: {
          userSourceId: value.userId,
          workspaceSourceId: value.workspaceId,
          role: value.role,
          lifecycle: value.lifecycle,
          grantedPermissions: [...value.grantedPermissions],
          deniedPermissions: [...value.deniedPermissions],
          effectivePermissions: [...value.effectivePermissions],
          sourceRevision: revision,
          observedAt: input.observedAt,
          projectedAt: input.now,
        },
      });
  }
}

function mapUser(
  row: typeof customerUserProjections.$inferSelect,
): CustomerUserSummary {
  return {
    id: row.sourceId,
    email: row.email,
    displayName: row.displayName,
    lifecycle: row.lifecycle,
    verificationStatus: row.verificationStatus,
    createdAt: row.sourceCreatedAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
    sourceRevision: row.sourceRevision.toString(),
  };
}

function mapWorkspace(
  row: typeof customerWorkspaceProjections.$inferSelect,
): CustomerWorkspaceSummary {
  return {
    id: row.sourceId,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    lifecycle: row.lifecycle,
    createdAt: row.sourceCreatedAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
    sourceRevision: row.sourceRevision.toString(),
  };
}

function mapMembership(
  row: typeof customerWorkspaceMembershipProjections.$inferSelect,
): CustomerWorkspaceMembership {
  return {
    id: row.sourceId,
    userId: row.userSourceId,
    workspaceId: row.workspaceSourceId,
    role: row.role,
    lifecycle: row.lifecycle,
    grantedPermissions: row.grantedPermissions,
    deniedPermissions: row.deniedPermissions,
    effectivePermissions: row.effectivePermissions,
    observedAt: row.observedAt.toISOString(),
    sourceRevision: row.sourceRevision.toString(),
  };
}

async function insertReadAudit(
  transaction: Transaction,
  input: typeof auditEvents.$inferInsert,
) {
  await transaction.insert(auditEvents).values(input);
}

function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
