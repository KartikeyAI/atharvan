import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPlatformOverview, type PlatformOverview } from "@atharvan/domain";
import {
  createOverviewPolling,
  remainingOverviewLifetime,
} from "./overview-polling";

const data = buildPlatformOverview(
  "development",
  new Date("2026-09-04T00:00:00Z"),
  [],
);
afterEach(() => vi.useRealTimers());

describe("overview freshness", () => {
  it("rejects an older response without alert evidence during a rolling deployment", async () => {
    vi.useFakeTimers();
    const { alerts: _alerts, ...legacy } = data;
    const publish = vi.fn();
    const polling = createOverviewPolling(
      vi.fn().mockResolvedValue(legacy),
      publish,
    );
    polling.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
    polling.stop();
  });
  it("handles a non-JSON success response without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const polling = createOverviewPolling(
      vi.fn().mockResolvedValue(null),
      publish,
    );
    polling.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
    polling.stop();
  });
  it("subtracts transit time without trusting the client wall clock", () => {
    expect(remainingOverviewLifetime(data, 2_000)).toBe(28_000);
    expect(
      remainingOverviewLifetime({ ...data, validUntil: "invalid" }, 0),
    ).toBe(0);
    expect(remainingOverviewLifetime(data, 31_000)).toBe(0);
  });
  it("removes evidence at expiry before requesting another snapshot", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce(data)
      .mockImplementation(() => new Promise(() => {}));
    const polling = createOverviewPolling(request, publish, () => 0);
    polling.refresh();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(publish).toHaveBeenLastCalledWith({ status: "success", data });
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenLastCalledWith({ status: "loading" });
    expect(request).toHaveBeenCalledTimes(2);
    polling.stop();
  });
  it("ignores an older response after manual refresh", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: PlatformOverview) => void;
    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PlatformOverview>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(data);
    const publish = vi.fn();
    const polling = createOverviewPolling(request, publish);
    polling.refresh();
    polling.refresh();
    await vi.advanceTimersByTimeAsync(0);
    resolveFirst({ ...data, status: "healthy" });
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ status: "success", data });
    expect(request.mock.calls[0]![0].aborted).toBe(true);
    polling.stop();
  });
  it("times out stalled requests and does not accept their eventual response", async () => {
    vi.useFakeTimers();
    let resolve!: (value: PlatformOverview) => void;
    const publish = vi.fn();
    const polling = createOverviewPolling(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
      publish,
    );
    polling.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
    resolve(data);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
    polling.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("backs off when snapshots arrive expired", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValue({ ...data, validUntil: data.generatedAt });
    const publish = vi.fn();
    const polling = createOverviewPolling(request, publish);
    polling.refresh();
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    polling.stop();
  });
  it("retries failures and cancels work on unmount", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new Error("network"));
    const publish = vi.fn();
    const polling = createOverviewPolling(request, publish);
    polling.refresh();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(2);
    polling.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
