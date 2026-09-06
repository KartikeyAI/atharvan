import type { PlatformOverview } from "@atharvan/domain";

export type OverviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: PlatformOverview };

/** Use elapsed time, not the browser's wall clock, to expire server evidence. */
export function remainingOverviewLifetime(
  data: PlatformOverview,
  elapsed: number,
) {
  // During a rolling deployment an older Worker may not supply alert evidence.
  // Treat that as unavailable instead of rendering a misleading empty alert list.
  if (!data || !Array.isArray(data.alerts) || !Array.isArray(data.history))
    throw new Error("incompatible_overview_response");
  const lifetime = Date.parse(data.validUntil) - Date.parse(data.generatedAt);
  return Number.isFinite(lifetime)
    ? Math.max(0, Math.min(30_000, lifetime) - elapsed)
    : 0;
}

/** Own cancellation and expiry together so late responses cannot restore old health. */
export function createOverviewPolling(
  request: (signal: AbortSignal) => Promise<PlatformOverview>,
  publish: (state: OverviewState) => void,
  clock: () => number = () => performance.now(),
) {
  let stopped = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh() {
    if (stopped) return;
    clearTimeout(timer);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    publish({ status: "loading" });
    const started = clock();
    // A stalled request must not leave the dashboard loading indefinitely.
    timer = setTimeout(() => {
      current.abort();
      publish({ status: "error" });
      timer = setTimeout(refresh, 30_000);
    }, 15_000);
    void request(current.signal)
      .then((data) => {
        if (stopped || current.signal.aborted) return;
        clearTimeout(timer);
        const remaining = remainingOverviewLifetime(data, clock() - started);
        if (remaining <= 0) {
          publish({ status: "error" });
          timer = setTimeout(refresh, 1_000);
          return;
        }
        publish({ status: "success", data });
        timer = setTimeout(refresh, remaining);
      })
      .catch(() => {
        if (stopped || current.signal.aborted) return;
        clearTimeout(timer);
        publish({ status: "error" });
        timer = setTimeout(refresh, 30_000);
      });
  }

  return {
    refresh,
    stop() {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
    },
  };
}
