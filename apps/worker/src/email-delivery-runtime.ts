import { digestBetterAuthOtp } from "@atharvan/auth";
import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresVerificationDeliveryStore,
  createPostgresEmailDeliveryAdministration,
  createPostgresOperatorSessionPolicyStore,
  type AtharvanDatabase,
} from "@atharvan/db";
import {
  createVerificationDeliveryService,
  createVerificationDeliveryCipher,
  createResendTransactionalEmailSender,
  createRecipientFingerprint,
} from "@atharvan/email";
import {
  assertPlatformCommandAuthorized,
  type AuthenticatedOperator,
  type ManageEmailDeliveryCommand,
  type RestoreEmailRecipientCommand,
} from "@atharvan/domain";
import { resolveTransactionalEmailConfiguration } from "./transactional-email-configuration";

/** Request and scheduled runners share a protocol, not a cached request execution context. */
export function createEmailDeliveryRuntime(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
) {
  const policy = createPostgresOperatorSessionPolicyStore(database);
  const administration = createPostgresEmailDeliveryAdministration(
    database,
    config.ATHARVAN_ENVIRONMENT,
  );
  const queue = createVerificationDeliveryService({
    store: createPostgresVerificationDeliveryStore(database),
    environment: config.ATHARVAN_ENVIRONMENT,
    cipher: createVerificationDeliveryCipher(
      config.BETTER_AUTH_SECRET,
      config.ATHARVAN_ENVIRONMENT,
    ),
    digest: (code) =>
      digestBetterAuthOtp(code, config.ATHARVAN_VERIFICATION_HMAC_SECRET),
    sender: config.ATHARVAN_EMAIL_FROM,
    provider: config.RESEND_API_KEY
      ? createResendTransactionalEmailSender({
          apiKey: config.RESEND_API_KEY,
          from: config.ATHARVAN_EMAIL_FROM,
        })
      : null,
    eligible: (normalizedEmail) =>
      policy.canIssueSignInOtp({ normalizedEmail, now: new Date() }),
    template: () => resolveTransactionalEmailConfiguration(database, config),
    recipientFingerprint: createRecipientFingerprint(
      config.ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET ??
        config.ATHARVAN_VERIFICATION_HMAC_SECRET,
      config.ATHARVAN_ENVIRONMENT,
    ),
  });
  return {
    ...queue,
    health: administration.health,
    async list(actor: AuthenticatedOperator, correlationId: string) {
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:security:read",
      });
      return {
        ...(await administration.list(actor.operatorId, correlationId)),
        providerConfigured: Boolean(config.RESEND_API_KEY),
        feedbackConfigured: Boolean(config.RESEND_WEBHOOK_SECRET),
        canManage: actor.isSuperAdministrator,
      };
    },
    manage(actor: AuthenticatedOperator, command: ManageEmailDeliveryCommand) {
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:security:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: new Date(),
      });
      return administration.manage(actor.operatorId, command);
    },
    restoreRecipient(
      actor: AuthenticatedOperator,
      command: RestoreEmailRecipientCommand,
    ) {
      assertPlatformCommandAuthorized({
        actor,
        requestedCapability: "platform:security:write",
        requireSuperAdministrator: true,
        requireRecentStepUp: true,
        now: new Date(),
      });
      return administration.restoreRecipient(actor.operatorId, command);
    },
  };
}
