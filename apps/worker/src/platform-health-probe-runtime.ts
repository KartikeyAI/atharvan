import type { AuthenticationRuntimeConfig } from "@atharvan/config";
import {
  createPostgresPlatformHealthProbeStore,
  type AtharvanDatabase,
  type LeasedPlatformHealthProbe,
  type PlatformHealthProbeResult,
} from "@atharvan/db";

/** Reconcile due probe windows and execute a bounded concurrent batch. */
export function createPlatformHealthProbeRuntime(
  database: AtharvanDatabase,
  config: AuthenticationRuntimeConfig,
  request: typeof fetch = fetch,
) {
  const store = createPostgresPlatformHealthProbeStore(database);
  return {
    async run() {
      const enqueued = await store.enqueueDue(config.ATHARVAN_ENVIRONMENT);
      const jobs = await store.claimDue(config.ATHARVAN_ENVIRONMENT, 8);
      const results = await Promise.allSettled(
        jobs.map(async (job) => store.settle(job, await execute(job, request))),
      );
      const failed = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failed.length > 0) throw new Error("health_probe_settlement_failed");
      return {
        enqueued,
        claimed: jobs.length,
        recorded: results.filter(
          (result) =>
            result.status === "fulfilled" && result.value === "recorded",
        ).length,
      };
    },
  };
}

async function execute(
  job: LeasedPlatformHealthProbe,
  request: typeof fetch,
): Promise<PlatformHealthProbeResult> {
  const startedAt = Date.now();
  try {
    const response = await request(job.probe.url, {
      method: job.probe.method,
      redirect: "manual",
      signal: AbortSignal.timeout(job.probe.timeoutMs),
      headers: {
        accept: "application/json, text/plain;q=0.9, */*;q=0.1",
        "user-agent": "Atharvan-Health-Probe/1.0",
      },
    });
    await response.body?.cancel();
    const latencyMs = boundedLatency(startedAt);
    if (job.probe.expectedStatusCodes.includes(response.status)) {
      return {
        status: "healthy",
        latencyMs,
        httpStatusCode: response.status,
        errorCode: null,
        observedAt: new Date(),
      };
    }
    return {
      status: response.status >= 500 ? "unavailable" : "degraded",
      latencyMs,
      httpStatusCode: response.status,
      errorCode: "unexpected_http_status",
      observedAt: new Date(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      latencyMs: boundedLatency(startedAt),
      httpStatusCode: null,
      errorCode:
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? "probe_timeout"
          : "probe_network_error",
      observedAt: new Date(),
    };
  }
}

function boundedLatency(startedAt: number) {
  return Math.min(Math.max(Date.now() - startedAt, 0), 120_000);
}
