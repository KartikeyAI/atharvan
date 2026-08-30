import type { PlatformConfigurationAdministrationStore } from "@atharvan/config";
import type {
  PlatformConfigurationEnvironment,
  PlatformConfigurationRegistry,
  PlatformConfigurationRevisionEntry,
  PlatformConfigurationScope,
  PlatformConfigurationValue,
} from "@atharvan/domain";
import { and, desc, eq, isNull, max, or } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operators,
  platformConfigurationBindings,
  platformConfigurationDefinitions,
  platformConfigurationRevisions,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface PostgresPlatformConfigurationStore extends PlatformConfigurationAdministrationStore {
  listConfiguration(
    environment: PlatformConfigurationEnvironment,
  ): Promise<PlatformConfigurationRegistry>;
}

export function createPostgresPlatformConfigurationStore(
  database: Database,
): PostgresPlatformConfigurationStore {
  return {
    async findConfigurationDefinition(key) {
      const [definition] = await database
        .select({
          id: platformConfigurationDefinitions.id,
          key: platformConfigurationDefinitions.key,
          valueType: platformConfigurationDefinitions.valueType,
          validation: platformConfigurationDefinitions.validation,
          isMutable: platformConfigurationDefinitions.isMutable,
        })
        .from(platformConfigurationDefinitions)
        .where(eq(platformConfigurationDefinitions.key, key))
        .limit(1);

      return definition ?? null;
    },

    async setConfiguration(input) {
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

        if (actor === undefined) throw new Error("operator_command_forbidden");

        const [definition] = await transaction
          .select({
            id: platformConfigurationDefinitions.id,
            key: platformConfigurationDefinitions.key,
            valueType: platformConfigurationDefinitions.valueType,
            validation: platformConfigurationDefinitions.validation,
            isMutable: platformConfigurationDefinitions.isMutable,
          })
          .from(platformConfigurationDefinitions)
          .where(
            and(
              eq(platformConfigurationDefinitions.id, input.definition.id),
              eq(platformConfigurationDefinitions.key, input.definition.key),
            ),
          )
          .limit(1)
          .for("update");

        if (definition === undefined)
          throw new Error("configuration_not_found");
        if (!definition.isMutable) throw new Error("configuration_not_mutable");

        const bindingCondition = configurationBindingCondition({
          definitionId: definition.id,
          scope: input.scope,
          environment: input.environment,
        });
        const [current] = await transaction
          .select({
            bindingId: platformConfigurationBindings.id,
            value: platformConfigurationRevisions.value,
            revisionNumber: platformConfigurationRevisions.revisionNumber,
          })
          .from(platformConfigurationBindings)
          .innerJoin(
            platformConfigurationRevisions,
            eq(
              platformConfigurationRevisions.id,
              platformConfigurationBindings.currentRevisionId,
            ),
          )
          .where(bindingCondition)
          .limit(1)
          .for("update");

        if (
          current !== undefined &&
          configurationValuesEqual(current.value, input.value)
        ) {
          return { outcome: "unchanged", key: definition.key } as const;
        }

        const [revisionAggregate] = await transaction
          .select({
            maximumRevision: max(platformConfigurationRevisions.revisionNumber),
          })
          .from(platformConfigurationRevisions)
          .where(
            eq(platformConfigurationRevisions.definitionId, definition.id),
          );
        const revisionNumber =
          Number(revisionAggregate?.maximumRevision ?? 0) + 1;
        const [revision] = await transaction
          .insert(platformConfigurationRevisions)
          .values({
            definitionId: definition.id,
            revisionNumber,
            scope: input.scope,
            environment: input.environment,
            value: input.value,
            createdByOperatorId: input.actorId,
            reason: input.reason,
            correlationId: input.correlationId,
            createdAt: input.now,
          })
          .returning({ id: platformConfigurationRevisions.id });

        if (revision === undefined)
          throw new Error("configuration_revision_not_created");

        if (current === undefined) {
          await transaction.insert(platformConfigurationBindings).values({
            definitionId: definition.id,
            scope: input.scope,
            environment: input.environment,
            currentRevisionId: revision.id,
            updatedByOperatorId: input.actorId,
            updatedAt: input.now,
          });
        } else {
          await transaction
            .update(platformConfigurationBindings)
            .set({
              currentRevisionId: revision.id,
              updatedByOperatorId: input.actorId,
              updatedAt: input.now,
            })
            .where(eq(platformConfigurationBindings.id, current.bindingId));
        }

        await transaction.insert(auditEvents).values({
          actorId: input.actorId,
          eventType: "platform.configuration.updated",
          targetType: "platform_configuration",
          targetId: definition.key,
          correlationId: input.correlationId,
          reason: input.reason,
          evidence: {
            scope: input.scope,
            environment: input.environment,
            previousRevisionNumber: current?.revisionNumber ?? null,
            previousValue: current?.value ?? null,
            resultingRevisionNumber: revisionNumber,
            resultingValue: input.value,
          },
          occurredAt: input.now,
        });

        return {
          outcome: "updated",
          key: definition.key,
          revisionNumber,
        } as const;
      });
    },

    async listConfiguration(environment) {
      const [definitions, bindings, revisions] = await Promise.all([
        database
          .select()
          .from(platformConfigurationDefinitions)
          .orderBy(
            platformConfigurationDefinitions.category,
            platformConfigurationDefinitions.key,
          ),
        database
          .select({
            definitionId: platformConfigurationBindings.definitionId,
            scope: platformConfigurationBindings.scope,
            environment: platformConfigurationBindings.environment,
            id: platformConfigurationRevisions.id,
            revisionNumber: platformConfigurationRevisions.revisionNumber,
            value: platformConfigurationRevisions.value,
            reason: platformConfigurationRevisions.reason,
            correlationId: platformConfigurationRevisions.correlationId,
            createdByOperatorId:
              platformConfigurationRevisions.createdByOperatorId,
            createdAt: platformConfigurationRevisions.createdAt,
          })
          .from(platformConfigurationBindings)
          .innerJoin(
            platformConfigurationRevisions,
            eq(
              platformConfigurationRevisions.id,
              platformConfigurationBindings.currentRevisionId,
            ),
          )
          .where(
            or(
              eq(platformConfigurationBindings.scope, "platform"),
              and(
                eq(platformConfigurationBindings.scope, "environment"),
                eq(platformConfigurationBindings.environment, environment),
              ),
            ),
          ),
        database
          .select({
            definitionId: platformConfigurationRevisions.definitionId,
            id: platformConfigurationRevisions.id,
            revisionNumber: platformConfigurationRevisions.revisionNumber,
            scope: platformConfigurationRevisions.scope,
            environment: platformConfigurationRevisions.environment,
            value: platformConfigurationRevisions.value,
            reason: platformConfigurationRevisions.reason,
            correlationId: platformConfigurationRevisions.correlationId,
            createdByOperatorId:
              platformConfigurationRevisions.createdByOperatorId,
            createdAt: platformConfigurationRevisions.createdAt,
          })
          .from(platformConfigurationRevisions)
          .where(
            or(
              eq(platformConfigurationRevisions.scope, "platform"),
              and(
                eq(platformConfigurationRevisions.scope, "environment"),
                eq(platformConfigurationRevisions.environment, environment),
              ),
            ),
          )
          .orderBy(
            platformConfigurationRevisions.definitionId,
            desc(platformConfigurationRevisions.revisionNumber),
          ),
      ]);

      const currentByDefinition = new Map<
        string,
        {
          platform: PlatformConfigurationRevisionEntry | null;
          environment: PlatformConfigurationRevisionEntry | null;
        }
      >();
      for (const binding of bindings) {
        const current = currentByDefinition.get(binding.definitionId) ?? {
          platform: null,
          environment: null,
        };
        current[binding.scope] = toRevisionEntry(binding);
        currentByDefinition.set(binding.definitionId, current);
      }

      const revisionsByDefinition = new Map<
        string,
        Array<PlatformConfigurationRevisionEntry>
      >();
      for (const revision of revisions) {
        const entries = revisionsByDefinition.get(revision.definitionId) ?? [];
        if (entries.length < 10) entries.push(toRevisionEntry(revision));
        revisionsByDefinition.set(revision.definitionId, entries);
      }

      return {
        environment,
        items: definitions.map((definition) => {
          const current = currentByDefinition.get(definition.id) ?? {
            platform: null,
            environment: null,
          };
          return {
            definitionId: definition.id,
            key: definition.key,
            category: definition.category,
            name: definition.name,
            description: definition.description,
            valueType: definition.valueType,
            validation: definition.validation,
            defaultValue: definition.defaultValue,
            platformOverride: current.platform,
            environmentOverride: current.environment,
            resolvedValue:
              current.environment?.value ??
              current.platform?.value ??
              definition.defaultValue,
            resolvedFrom:
              current.environment !== null
                ? ("environment" as const)
                : current.platform !== null
                  ? ("platform" as const)
                  : ("default" as const),
            recentRevisions: revisionsByDefinition.get(definition.id) ?? [],
          };
        }),
      };
    },
  };
}

function configurationBindingCondition(input: {
  readonly definitionId: string;
  readonly scope: PlatformConfigurationScope;
  readonly environment: PlatformConfigurationEnvironment | null;
}) {
  return input.scope === "platform"
    ? and(
        eq(platformConfigurationBindings.definitionId, input.definitionId),
        eq(platformConfigurationBindings.scope, "platform"),
        isNull(platformConfigurationBindings.environment),
      )
    : and(
        eq(platformConfigurationBindings.definitionId, input.definitionId),
        eq(platformConfigurationBindings.scope, "environment"),
        eq(platformConfigurationBindings.environment, input.environment!),
      );
}

function configurationValuesEqual(
  first: PlatformConfigurationValue,
  second: PlatformConfigurationValue,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

function toRevisionEntry(input: {
  readonly id: string;
  readonly revisionNumber: number;
  readonly scope: PlatformConfigurationScope;
  readonly environment: PlatformConfigurationEnvironment | null;
  readonly value: PlatformConfigurationValue;
  readonly reason: string;
  readonly correlationId: string;
  readonly createdByOperatorId: string;
  readonly createdAt: Date;
}): PlatformConfigurationRevisionEntry {
  return {
    id: input.id,
    revisionNumber: input.revisionNumber,
    scope: input.scope,
    environment: input.environment,
    value: input.value,
    reason: input.reason,
    correlationId: input.correlationId,
    createdByOperatorId: input.createdByOperatorId,
    createdAt: input.createdAt.toISOString(),
  };
}
