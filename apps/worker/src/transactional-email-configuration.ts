import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresPlatformConfigurationStore,
  type AtharvanDatabase,
} from "@atharvan/db";
import type {
  TransactionalEmailLocale,
  TransactionalEmailTemplateVersion,
} from "@atharvan/email";

export interface TransactionalEmailConfiguration {
  readonly templateVersion: TransactionalEmailTemplateVersion;
  readonly locale: TransactionalEmailLocale;
}

/** Resolve the immutable source template revision selected by versioned config. */
export async function resolveTransactionalEmailConfiguration(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
): Promise<TransactionalEmailConfiguration> {
  const registry = await createPostgresPlatformConfigurationStore(
    database,
  ).listConfiguration(config.ATHARVAN_ENVIRONMENT);
  const version = registry.items.find(
    (item) => item.key === "communications.transactional_template_version",
  )?.resolvedValue;
  const locale = registry.items.find(
    (item) => item.key === "communications.default_locale",
  )?.resolvedValue;
  return {
    templateVersion: version === "v2" ? "v2" : "v1",
    locale: locale === "hi" ? "hi" : "en",
  };
}
