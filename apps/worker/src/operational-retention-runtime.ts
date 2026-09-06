import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresOperationalRetentionStore,
  type AtharvanDatabase,
} from "@atharvan/db";

/** Claim and apply one fenced hourly retention window. */
export function createOperationalRetentionRuntime(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
) {
  const store = createPostgresOperationalRetentionStore(database);
  return {
    async run() {
      const job = await store.claim(config.ATHARVAN_ENVIRONMENT);
      if (!job) return { claimed: 0, completed: 0 };
      try {
        const result = await store.apply(job);
        if (result.outcome === "lease_lost")
          return { claimed: 1, completed: 0 };
        return { claimed: 1, completed: 1, counts: result.counts };
      } catch (error) {
        await store.recordFailure(job);
        throw error;
      }
    },
  };
}
