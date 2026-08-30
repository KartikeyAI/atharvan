import type { OperatorRoleAdministrationStore } from "@atharvan/auth";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operatorRoleAssignments,
  operatorRoleDefinitions,
  operators,
} from "./schema";

export function createPostgresOperatorRoleAdministrationStore(
  database: PgDatabase<PgQueryResultHKT, typeof schema>,
): OperatorRoleAdministrationStore {
  return {
    replaceOperatorRoles(input) {
      return database.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ id: operators.id })
          .from(operators)
          .where(
            and(
              eq(operators.id, input.actorId),
              eq(operators.status, "active"),
              eq(operators.isSuperAdministrator, true),
            ),
          )
          .limit(1)
          .for("update");

        if (actor === undefined) {
          throw new Error("operator_command_forbidden");
        }

        const [target] = await transaction
          .select({
            id: operators.id,
            status: operators.status,
            isSuperAdministrator: operators.isSuperAdministrator,
          })
          .from(operators)
          .where(eq(operators.id, input.targetOperatorId))
          .limit(1)
          .for("update");

        if (target === undefined || target.status !== "active") {
          return { outcome: "rejected", reason: "operator_not_found" };
        }

        if (target.isSuperAdministrator) {
          return {
            outcome: "rejected",
            reason: "super_administrator_roles_immutable",
          };
        }

        const roleDefinitions = await transaction
          .select({
            id: operatorRoleDefinitions.id,
            key: operatorRoleDefinitions.key,
          })
          .from(operatorRoleDefinitions)
          .where(
            and(
              inArray(operatorRoleDefinitions.key, [...input.roleKeys]),
              eq(operatorRoleDefinitions.isActive, true),
            ),
          );

        if (roleDefinitions.length !== input.roleKeys.length) {
          return { outcome: "rejected", reason: "role_not_found" };
        }

        const currentAssignments = await transaction
          .select({
            id: operatorRoleAssignments.id,
            roleDefinitionId: operatorRoleAssignments.roleDefinitionId,
            key: operatorRoleDefinitions.key,
          })
          .from(operatorRoleAssignments)
          .innerJoin(
            operatorRoleDefinitions,
            eq(
              operatorRoleDefinitions.id,
              operatorRoleAssignments.roleDefinitionId,
            ),
          )
          .where(
            and(
              eq(operatorRoleAssignments.operatorId, target.id),
              isNull(operatorRoleAssignments.revokedAt),
            ),
          )
          .for("update");
        const currentKeys = currentAssignments.map(
          (assignment) => assignment.key,
        );
        const nextKeys = [...input.roleKeys].sort();

        if (
          currentKeys.length === nextKeys.length &&
          [...currentKeys].sort().every((key, index) => key === nextKeys[index])
        ) {
          return { outcome: "unchanged", operatorId: target.id };
        }

        const nextKeySet = new Set(nextKeys);
        const currentKeySet = new Set(currentKeys);
        const revokedIds = currentAssignments
          .filter((assignment) => !nextKeySet.has(assignment.key))
          .map((assignment) => assignment.id);

        if (revokedIds.length > 0) {
          await transaction
            .update(operatorRoleAssignments)
            .set({
              revokedByOperatorId: input.actorId,
              revokedReason: input.reason,
              revokedCorrelationId: input.correlationId,
              revokedAt: input.now,
            })
            .where(inArray(operatorRoleAssignments.id, revokedIds));
        }

        const addedDefinitions = roleDefinitions.filter(
          (definition) => !currentKeySet.has(definition.key),
        );

        if (addedDefinitions.length > 0) {
          await transaction.insert(operatorRoleAssignments).values(
            addedDefinitions.map((definition) => ({
              operatorId: target.id,
              roleDefinitionId: definition.id,
              assignedByOperatorId: input.actorId,
              reason: input.reason,
              correlationId: input.correlationId,
              assignedAt: input.now,
            })),
          );
        }

        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.operator.roles_replaced",
          targetType: "operator",
          targetId: target.id,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            previousRoleKeys: [...currentKeys].sort(),
            resultingRoleKeys: nextKeys,
          },
          occurredAt: input.now,
        });

        return { outcome: "updated", operatorId: target.id };
      });
    },
  };
}
