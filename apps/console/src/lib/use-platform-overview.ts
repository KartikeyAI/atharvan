import { useCallback, useEffect, useRef, useState } from "react";
import type { PlatformOverview } from "@atharvan/domain";
import { apiRequest } from "./api";
import { createOverviewPolling, type OverviewState } from "./overview-polling";

export function usePlatformOverview() {
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const polling = useRef<ReturnType<typeof createOverviewPolling> | null>(null);
  const refresh = useCallback(() => polling.current?.refresh(), []);

  useEffect(() => {
    const session = createOverviewPolling(
      (signal) =>
        apiRequest<PlatformOverview>("/api/platform/overview", {
          signal,
          cache: "no-store",
        }),
      setState,
    );
    polling.current = session;
    const onVisible = () => {
      if (document.visibilityState === "visible") session.refresh();
    };
    session.refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      polling.current = null;
      session.stop();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { state, refresh };
}
