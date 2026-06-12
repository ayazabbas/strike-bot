import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { HistoryPythAdapter } from "../src/adapters/PythAdapter.js";

describe("HistoryPythAdapter", () => {
  it("fetches BTC 5-minute history and normalizes the latest candle", async () => {
    const now = new Date("2026-06-12T12:10:00.000Z");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          s: "ok",
          t: [1781265600, 1781265900],
          o: [67000, 67010],
          h: [67100, 67110],
          l: [66900, 66950],
          c: [67050, 67080],
          v: [1, 2]
        }),
        { status: 200 }
      )
    );
    const adapter = new HistoryPythAdapter(loadConfig({ PYTH_PRO_API_KEY: "pyth-test-key" }), fetchImpl, () => now);

    const metadata = await adapter.getBtcFiveMinuteCandleMetadata();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0].toString());
    expect(url.origin + url.pathname).toBe("https://pyth.dourolabs.app/v1/real_time/history");
    expect(url.searchParams.get("symbol")).toBe("Crypto.BTC/USD");
    expect(url.searchParams.get("resolution")).toBe("5");
    expect(url.searchParams.get("to")).toBe("1781266200");
    expect(url.searchParams.get("from")).toBe("1781262600");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "pyth-test-key" });
    expect(metadata.stubbed).toBe(false);
    expect(metadata.latestCandle).toMatchObject({
      openTime: new Date("2026-06-12T12:05:00.000Z"),
      open: 67010,
      high: 67110,
      low: 66950,
      close: 67080,
      volume: 2
    });
  });

  it("keeps stub behavior on API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const adapter = new HistoryPythAdapter(loadConfig({}), fetchImpl, () => new Date("2026-06-12T12:10:00.000Z"));

    await expect(adapter.getBtcFiveMinuteCandleMetadata()).resolves.toMatchObject({ stubbed: true });
  });
});
