import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresArthCommandExchange,
  createPostgresEmailDeliveryAdministration,
  createPostgresOperationalAlertDeliveryStore,
  createPostgresPlatformHealthProbeStore,
  createPostgresPlatformOverviewReader,
  type AtharvanDatabase,
} from "@atharvan/db";
import { buildOperationalAlerts } from "@atharvan/domain";
import {
  createRecipientFingerprint,
  createOperationalAlertDeliveryService,
  createResendOperationalAlertSender,
} from "@atharvan/email";
import { resolveTransactionalEmailConfiguration } from "./transactional-email-configuration";

/** Build one internally consistent evidence snapshot before reconciling notifications. */
export function createOperationalAlertRuntime(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
) {
  const store = createPostgresOperationalAlertDeliveryStore(database);
  const recipientFingerprint = createRecipientFingerprint(
    config.ATHARVAN_EMAIL_RECIPIENT_HMAC_SECRET ??
      config.ATHARVAN_VERIFICATION_HMAC_SECRET,
    config.ATHARVAN_ENVIRONMENT,
  );
  return {
    async run() {
      const now = new Date();
      const emailConfiguration = await resolveTransactionalEmailConfiguration(
        database,
        config,
      );
      const [
        overview,
        emailHealth,
        arthHealth,
        alertDeliveryHealth,
        platformHealthProbeQueueHealth,
      ] = await Promise.all([
        createPostgresPlatformOverviewReader(database).read(
          config.ATHARVAN_ENVIRONMENT,
          now,
          { includeHistory: false },
        ),
        createPostgresEmailDeliveryAdministration(
          database,
          config.ATHARVAN_ENVIRONMENT,
        )
          .health()
          .catch(() => null),
        createPostgresArthCommandExchange(database, config.ATHARVAN_ENVIRONMENT)
          .readHealth()
          .catch(() => null),
        store.health(config.ATHARVAN_ENVIRONMENT).catch(() => null),
        createPostgresPlatformHealthProbeStore(database)
          .health(config.ATHARVAN_ENVIRONMENT)
          .catch(() => null),
      ]);
      const secretProviderConfigured = Boolean(
        config.CLOUDFLARE_SECRETS_STORE_ACCOUNT_ID &&
        config.CLOUDFLARE_SECRETS_STORE_ID &&
        config.CLOUDFLARE_SECRETS_STORE_API_TOKEN,
      );
      const arthWorkloadConfigured = Boolean(
        config.ATHARVAN_ARTH_CURRENT_KEY_ID &&
        config.ATHARVAN_ARTH_CURRENT_SHARED_SECRET &&
        config.ATHARVAN_ARTH_AUDIENCE,
      );
      const alerts = buildOperationalAlerts(
        overview.environment,
        overview.evidence,
        {
          emailDeliveryConfigured: Boolean(config.RESEND_API_KEY),
          emailFeedbackConfigured: Boolean(config.RESEND_WEBHOOK_SECRET),
          secretProviderConfigured,
          arthWorkloadConfigured,
          emailDeliveryHealth: emailHealth,
          arthCommandDeliveryHealth: arthHealth,
          platformHealthProbeQueueHealth,
          alertDeliveryConfigured: Boolean(
            config.RESEND_API_KEY && config.ATHARVAN_ALERT_EMAIL_TO,
          ),
          alertDeliveryHealth,
        },
      );
      const service = createOperationalAlertDeliveryService({
        store,
        environment: config.ATHARVAN_ENVIRONMENT,
        sender: config.RESEND_API_KEY
          ? createResendOperationalAlertSender({
              apiKey: config.RESEND_API_KEY,
              from: config.ATHARVAN_EMAIL_FROM,
            })
          : null,
        destination: config.ATHARVAN_ALERT_EMAIL_TO ?? null,
        consoleOrigin: config.ATHARVAN_PUBLIC_ORIGIN,
        recipientFingerprint,
        templateVersion: emailConfiguration.templateVersion,
        locale: emailConfiguration.locale,
      });
      return service.run(alerts, now);
    },
  };
}
