import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";
export { createPostgresPlatformOverviewReader } from "./platform-overview-reader";
export {
  checkPostgresReadiness,
  currentAtharvanSchemaVersion,
  type DatabaseReadinessEvidence,
} from "./readiness";
export { createPostgresOperationalAlertDeliveryStore } from "./operational-alert-delivery-store";
export { createPostgresTransactionalEmailEventStore } from "./transactional-email-event-store";
export {
  createPostgresOperationalRetentionStore,
  type LeasedOperationalRetentionRun,
} from "./operational-retention-store";
export {
  createPostgresPlatformHealthProbeStore,
  type LeasedPlatformHealthProbe,
  type PlatformHealthProbeResult,
} from "./platform-health-probe-store";
export { createPostgresOperatorSessions } from "./operator-sessions";
export { createPostgresOperatorLifecycleStore } from "./operator-lifecycle-store";
export { createPostgresPlatformApprovalStore } from "./platform-approval-store";
export {
  createPostgresVerificationDeliveryStore,
  createPostgresEmailDeliveryAdministration,
} from "./verification-email-store";
export {
  createPostgresArthCommandExchange,
  ArthCommandExchangeError,
} from "./arth-command-exchange";

export { createPostgresOperatorOnboardingStore } from "./operator-onboarding-store";
export { createPostgresCustomerDirectoryStore } from "./customer-directory-store";
export { createPostgresOperatorRoleAdministrationStore } from "./operator-role-administration-store";
export { createPostgresOperatorBreakGlassAdministrationStore } from "./operator-break-glass-store";
export { createPostgresPlatformAdministrationReader } from "./platform-administration-reader";
export { createPostgresPlatformCommandAuditStore } from "./platform-command-audit-store";
export { createPostgresPlatformAdapterRegistryStore } from "./platform-adapter-store";
export { createPostgresPlatformConfigurationStore } from "./platform-configuration-store";
export { createPostgresPlatformIntegrationRegistryStore } from "./platform-integration-store";
export { createPostgresPlatformFeatureFlagStore } from "./platform-feature-flag-store";
export { createPostgresPlatformSecretStore } from "./platform-secret-store";
export { createPostgresModelCatalogueStore } from "./model-catalogue-store";
export { createPostgresCommercialCatalogueStore } from "./commercial-catalogue-store";
export { createPostgresEntitlementStore } from "./entitlement-store";
export { createPostgresModelRoutingStore } from "./model-routing-store";
export { createPostgresOperatorSessionPolicyStore } from "./operator-session-policy-store";
export * as authDatabaseSchema from "./schema";

export type AtharvanDatabase = ReturnType<
  typeof createNeonDatabase
>["database"];

export interface NeonDatabaseHandle {
  readonly database: ReturnType<typeof drizzle<typeof schema>>;
  close(): Promise<void>;
}

export function createNeonDatabase(databaseUrl: string): NeonDatabaseHandle {
  const client = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    statement_timeout: 10_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 15_000,
  });
  const database = drizzle({ client, schema });

  return {
    database,
    close: () => client.end(),
  };
}

export async function runWithNeonDatabase<Result>(
  databaseUrl: string,
  operation: (database: AtharvanDatabase) => Promise<Result>,
): Promise<Result> {
  const handle = createNeonDatabase(databaseUrl);

  try {
    return await operation(handle.database);
  } finally {
    await handle.close();
  }
}
