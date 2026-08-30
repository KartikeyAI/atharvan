import type { PlatformAdministrationReader } from "@atharvan/domain";
import { asc, desc, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import { allowedEmailDomains, operatorInvitations, operators } from "./schema";

export function createPostgresPlatformAdministrationReader(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
): PlatformAdministrationReader {
  return {
    async listOperators() {
      const [operatorRows, invitationRows] = await Promise.all([
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

      return operatorRows.map((operator) => {
        const invitation = latestInvitationByOperator.get(operator.id);

        return {
          id: operator.id,
          email: operator.email,
          emailDomain: operator.emailDomain,
          status: operator.status,
          isSuperAdministrator: operator.isSuperAdministrator,
          effectiveCapabilities: operator.isSuperAdministrator
            ? ["platform:*"]
            : (invitation?.intendedCapabilities ?? []),
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
  };
}
