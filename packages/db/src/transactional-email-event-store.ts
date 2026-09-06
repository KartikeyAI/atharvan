import type { PlatformConfigurationEnvironment } from "@atharvan/domain";
import type {
  OperationalAlertDeliveryState,
  VerifiedResendEmailEvent,
  VerificationDeliveryState,
} from "@atharvan/email";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";

import * as schema from "./schema";
import {
  auditEvents,
  operationalAlertDeliveries,
  transactionalEmailProviderEvents,
  transactionalEmailRecipientSuppressions,
  verificationEmailDeliveries,
} from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Record signed provider feedback once and advance only the matched delivery. */
export function createPostgresTransactionalEmailEventStore(database: Database) {
  return {
    record(
      environment: PlatformConfigurationEnvironment,
      event: VerifiedResendEmailEvent,
    ): Promise<"recorded" | "duplicate" | "unmatched"> {
      return database.transaction(async (tx) => {
        const now = await databaseNow(tx);
        const [verification] = await tx
          .select({
            id: verificationEmailDeliveries.id,
            state: verificationEmailDeliveries.state,
            reason: verificationEmailDeliveries.reason,
            recipientFingerprint:
              verificationEmailDeliveries.recipientFingerprint,
          })
          .from(verificationEmailDeliveries)
          .where(
            and(
              eq(verificationEmailDeliveries.environment, environment),
              eq(
                verificationEmailDeliveries.providerMessageId,
                event.providerMessageId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        const [alert] = await tx
          .select({
            id: operationalAlertDeliveries.id,
            state: operationalAlertDeliveries.state,
            reason: operationalAlertDeliveries.reason,
            recipientFingerprint:
              operationalAlertDeliveries.recipientFingerprint,
          })
          .from(operationalAlertDeliveries)
          .where(
            and(
              eq(operationalAlertDeliveries.environment, environment),
              eq(
                operationalAlertDeliveries.providerMessageId,
                event.providerMessageId,
              ),
            ),
          )
          .limit(1)
          .for("update");
        if (verification && alert)
          throw new Error("transactional_email_provider_message_ambiguous");
        const [created] = await tx
          .insert(transactionalEmailProviderEvents)
          .values({
            environment,
            providerEventId: event.providerEventId,
            providerMessageId: event.providerMessageId,
            eventType: event.type,
            verificationDeliveryId: verification?.id ?? null,
            operationalAlertDeliveryId: alert?.id ?? null,
            payloadDigest: event.payloadDigest,
            occurredAt: event.occurredAt,
            receivedAt: now,
          })
          .onConflictDoNothing({
            target: [
              transactionalEmailProviderEvents.provider,
              transactionalEmailProviderEvents.providerEventId,
            ],
          })
          .returning({ id: transactionalEmailProviderEvents.id });
        if (!created) return "duplicate";
        const target = verification ?? alert;
        if (!target) {
          await tx.insert(auditEvents).values({
            eventType: "platform.email_provider_event.unmatched",
            targetType: "transactional_email_provider_event",
            targetId: created.id,
            correlationId: created.id,
            reason:
              "Record authenticated provider feedback without a matching delivery receipt.",
            evidence: {
              provider: "resend",
              eventType: event.type,
              payloadDigest: event.payloadDigest,
            },
            occurredAt: now,
          });
          return "unmatched";
        }
        const nextState = downstreamState(
          event.type,
          target.state,
          target.reason,
        );
        const reason = eventReason(event.type);
        if (verification && nextState !== null)
          await tx
            .update(verificationEmailDeliveries)
            .set({ state: nextState, reason, updatedAt: now })
            .where(eq(verificationEmailDeliveries.id, verification.id));
        if (alert && nextState !== null)
          await tx
            .update(operationalAlertDeliveries)
            .set({
              state: nextState as OperationalAlertDeliveryState,
              reason,
              updatedAt: now,
            })
            .where(eq(operationalAlertDeliveries.id, alert.id));
        const suppressionReason = suppressionFor(event.type);
        if (suppressionReason)
          await tx
            .insert(transactionalEmailRecipientSuppressions)
            .values({
              environment,
              recipientFingerprint: target.recipientFingerprint,
              reason: suppressionReason,
              sourceEventId: created.id,
              createdAt: now,
            })
            .onConflictDoNothing();
        await tx.insert(auditEvents).values({
          eventType: `platform.email_provider_event.${event.type.slice("email.".length)}`,
          targetType: verification
            ? "email_delivery"
            : "operational_alert_delivery",
          targetId: target.id,
          correlationId: created.id,
          reason: "Apply authenticated transactional-email provider feedback.",
          evidence: {
            provider: "resend",
            eventType: event.type,
            deliveryUpdated: nextState !== null,
            stateChanged: nextState !== null && nextState !== target.state,
            suppressed: suppressionReason !== null,
            payloadDigest: event.payloadDigest,
          },
          occurredAt: now,
        });
        return "recorded";
      });
    },
  };
}

async function databaseNow(tx: Transaction): Promise<Date> {
  const [row] = await tx
    .select({ now: sql<string>`clock_timestamp()::text` })
    .from(sql`(select 1) as clock_source`);
  const now = new Date(row?.now ?? "");
  if (!Number.isFinite(now.getTime()))
    throw new Error("database_clock_unavailable");
  return now;
}

function downstreamState(
  type: VerifiedResendEmailEvent["type"],
  current: VerificationDeliveryState | OperationalAlertDeliveryState,
  currentReason: string,
): VerificationDeliveryState | null {
  if (!["accepted", "delivered", "bounced", "complained"].includes(current))
    return null;
  if (current === "complained") return null;
  if (type === "email.complained") return "complained";
  if (current === "bounced") return null;
  if (current === "accepted" && type === "email.delivery_delayed")
    return "accepted";
  if (
    current === "accepted" &&
    type === "email.sent" &&
    currentReason === "provider_accepted"
  )
    return "accepted";
  if (
    type === "email.bounced" ||
    type === "email.failed" ||
    type === "email.suppressed"
  )
    return "bounced";
  if (type === "email.delivered" && current === "accepted") return "delivered";
  return null;
}

function eventReason(type: VerifiedResendEmailEvent["type"]): string {
  return type.replace("email.", "provider_");
}

function suppressionFor(type: VerifiedResendEmailEvent["type"]) {
  if (type === "email.complained") return "complained" as const;
  if (type === "email.bounced") return "bounced" as const;
  if (type === "email.failed") return "failed" as const;
  if (type === "email.suppressed") return "suppressed" as const;
  return null;
}
