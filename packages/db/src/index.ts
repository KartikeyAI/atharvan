import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

export { createPostgresOperatorOnboardingStore } from "./operator-onboarding-store";
export { createPostgresOperatorRoleAdministrationStore } from "./operator-role-administration-store";
export { createPostgresPlatformAdministrationReader } from "./platform-administration-reader";
export { createPostgresPlatformCommandAuditStore } from "./platform-command-audit-store";
export { createPostgresPlatformAdapterRegistryStore } from "./platform-adapter-store";
export { createPostgresPlatformConfigurationStore } from "./platform-configuration-store";
export { createPostgresPlatformIntegrationRegistryStore } from "./platform-integration-store";
export { createPostgresPlatformFeatureFlagStore } from "./platform-feature-flag-store";
export { createPostgresPlatformSecretStore } from "./platform-secret-store";
export { createPostgresModelCatalogueStore } from "./model-catalogue-store";
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
  const client = new Pool({ connectionString: databaseUrl });
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
