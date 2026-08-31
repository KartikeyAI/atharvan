import type { PlatformAdministrationReader } from "@atharvan/domain";
import { asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  allowedEmailDomains,
  operatorBreakGlassGrants,
  operatorBreakGlassReviews,
  operatorInvitations,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
} from "./schema";

export function createPostgresPlatformAdministrationReader(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
): PlatformAdministrationReader {
  return {
    async listOperators() {
      const [operatorRows, invitationRows, roleAssignmentRows] =
        await Promise.all([
          database
            .select({
              id: operators.id,
              email: operators.email,
              emailDomain: operators.emailDomain,
              status: operators.status,
              isSuperAdministrator: operators.isSuperAdministrator,
              invitedAt: operators.invitedAt,
              activatedAt: operators.activatedAt,
            })
            .from(operators)
            .orderBy(asc(operators.email)),
          database
            .select({
              operatorId: operatorInvitations.operatorId,
              status: operatorInvitations.status,
              intendedCapabilities: operatorInvitations.intendedCapabilities,
            })
            .from(operatorInvitations)
            .where(inArray(operatorInvitations.status, ["pending", "accepted"]))
            .orderBy(
              desc(operatorInvitations.acceptedAt),
              desc(operatorInvitations.createdAt),
            ),
          database
            .select({
              operatorId: operatorRoleAssignments.operatorId,
              definitionId: operatorRoleDefinitions.id,
              key: operatorRoleDefinitions.key,
              name: operatorRoleDefinitions.name,
              version: operatorRoleDefinitions.version,
              capabilities: operatorRoleDefinitions.capabilities,
            })
            .from(operatorRoleAssignments)
            .innerJoin(
              operatorRoleDefinitions,
              eq(
                operatorRoleDefinitions.id,
                operatorRoleAssignments.roleDefinitionId,
              ),
            )
            .where(isNull(operatorRoleAssignments.revokedAt))
            .orderBy(asc(operatorRoleDefinitions.name)),
        ]);
      const latestInvitationByOperator = new Map<
        string,
        (typeof invitationRows)[number]
      >();

      for (const invitation of invitationRows) {
        if (!latestInvitationByOperator.has(invitation.operatorId)) {
          latestInvitationByOperator.set(invitation.operatorId, invitation);
        }
      }
      const rolesByOperator = new Map<
        string,
        Array<(typeof roleAssignmentRows)[number]>
      >();

      for (const role of roleAssignmentRows) {
        const roles = rolesByOperator.get(role.operatorId) ?? [];
        roles.push(role);
        rolesByOperator.set(role.operatorId, roles);
      }

      return operatorRows.map((operator) => {
        const invitation = latestInvitationByOperator.get(operator.id);
        const assignedRoles = rolesByOperator.get(operator.id) ?? [];
        const roleCapabilities = [
          ...new Set(assignedRoles.flatMap((role) => role.capabilities)),
        ].sort();

        return {
          id: operator.id,
          email: operator.email,
          emailDomain: operator.emailDomain,
          status: operator.status,
          isSuperAdministrator: operator.isSuperAdministrator,
          effectiveCapabilities: operator.isSuperAdministrator
            ? ["platform:*"]
            : roleCapabilities.length > 0
              ? roleCapabilities
              : (invitation?.intendedCapabilities ?? []),
          assignedRoles: assignedRoles.map((role) => ({
            definitionId: role.definitionId,
            key: role.key,
            name: role.name,
            version: role.version,
          })),
          invitationStatus: invitation?.status ?? null,
          invitedAt: operator.invitedAt.toISOString(),
          activatedAt: operator.activatedAt?.toISOString() ?? null,
        };
      });
    },

    async listMembershipDomains() {
      const rows = await database
        .select({
          id: allowedEmailDomains.id,
          domain: allowedEmailDomains.domain,
          includeSubdomains: allowedEmailDomains.includeSubdomains,
          isActive: allowedEmailDomains.isActive,
          reason: allowedEmailDomains.reason,
          createdAt: allowedEmailDomains.createdAt,
          disabledAt: allowedEmailDomains.disabledAt,
        })
        .from(allowedEmailDomains)
        .orderBy(
          desc(allowedEmailDomains.isActive),
          asc(allowedEmailDomains.domain),
        );

      return rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        disabledAt: row.disabledAt?.toISOString() ?? null,
      }));
    },

    async listOperatorRoleDefinitions() {
      return database
        .select({
          definitionId: operatorRoleDefinitions.id,
          key: operatorRoleDefinitions.key,
          name: operatorRoleDefinitions.name,
          version: operatorRoleDefinitions.version,
          description: operatorRoleDefinitions.description,
          capabilities: operatorRoleDefinitions.capabilities,
          isActive: operatorRoleDefinitions.isActive,
          isSystem: operatorRoleDefinitions.isSystem,
        })
        .from(operatorRoleDefinitions)
        .orderBy(
          desc(operatorRoleDefinitions.isActive),
          asc(operatorRoleDefinitions.name),
          desc(operatorRoleDefinitions.version),
        );
    },

    async listOperatorBreakGlassGrants() {
      const [grantRows, reviewRows, operatorRows] = await Promise.all([
        database
          .select()
          .from(operatorBreakGlassGrants)
          .orderBy(desc(operatorBreakGlassGrants.grantedAt)),
        database.select().from(operatorBreakGlassReviews),
        database
          .select({ id: operators.id, email: operators.email })
          .from(operators),
      ]);
      const emailByOperatorId = new Map(
        operatorRows.map((operator) => [operator.id, operator.email]),
      );
      const reviewByGrantId = new Map(
        reviewRows.map((review) => [review.grantId, review]),
      );
      const now = new Date();

      return grantRows.map((grant) => {
        const review = reviewByGrantId.get(grant.id);
        const status =
          grant.revokedAt !== null
            ? ("revoked" as const)
            : grant.expiresAt <= now
              ? ("expired" as const)
              : ("active" as const);

        return {
          id: grant.id,
          operatorId: grant.operatorId,
          operatorEmail: emailByOperatorId.get(grant.operatorId) ?? "unknown",
          capabilities: grant.capabilities,
          reason: grant.reason,
          incidentReference: grant.incidentReference,
          approvalReference: grant.approvalReference,
          grantedByOperatorId: grant.grantedByOperatorId,
          grantedByEmail:
            emailByOperatorId.get(grant.grantedByOperatorId) ?? "unknown",
          grantedAt: grant.grantedAt.toISOString(),
          expiresAt: grant.expiresAt.toISOString(),
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          revokedByOperatorId: grant.revokedByOperatorId,
          revokedReason: grant.revokedReason,
          status,
          review:
            review === undefined
              ? null
              : {
                  id: review.id,
                  reviewerOperatorId: review.reviewerOperatorId,
                  reviewerEmail:
                    emailByOperatorId.get(review.reviewerOperatorId) ??
                    "unknown",
                  outcome: review.outcome,
                  summary: review.summary,
                  reviewedAt: review.reviewedAt.toISOString(),
                },
        };
      });
    },

    async findActiveOperatorRoleDefinition(key) {
      const [row] = await database
        .select({
          definitionId: operatorRoleDefinitions.id,
          key: operatorRoleDefinitions.key,
          name: operatorRoleDefinitions.name,
          version: operatorRoleDefinitions.version,
          description: operatorRoleDefinitions.description,
          capabilities: operatorRoleDefinitions.capabilities,
          isActive: operatorRoleDefinitions.isActive,
          isSystem: operatorRoleDefinitions.isSystem,
        })
        .from(operatorRoleDefinitions)
        .where(eq(operatorRoleDefinitions.key, key.trim().toLowerCase()))
        .orderBy(desc(operatorRoleDefinitions.version))
        .limit(1);

      return row?.isActive ? row : null;
    },
  };
}
