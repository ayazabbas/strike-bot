import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { RestPredictFunAdapter } from "../src/adapters/PredictFunAdapter.js";

describe("RestPredictFunAdapter", () => {
  it("does not call the network when the predict.fun API key is absent", async () => {
    const fetchImpl = vi.fn();
    const adapter = new RestPredictFunAdapter(loadConfig({}), fetchImpl);

    await expect(adapter.listMarkets()).resolves.toMatchObject({ markets: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends x-api-key and maps plausible market payloads safely", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          markets: [
            {
              marketId: "btc-5m-1",
              title: "Bitcoin 5 minute UP or DOWN",
              asset: "BTC",
              interval: "5m",
              outcomes: ["UP", "DOWN"],
              startTime: "2026-06-12T12:00:00.000Z",
              closeTime: "2026-06-12T12:05:00.000Z",
              resolveTime: "2026-06-12T12:06:00.000Z",
              liquidityUsd: "42.5",
              status: "open"
            }
          ]
        }),
        { status: 200 }
      )
    );
    const adapter = new RestPredictFunAdapter(
      loadConfig({ PREDICT_FUN_API_KEY: "test-key", PREDICT_FUN_BASE_URL: "https://api.predict.fun" }),
      fetchImpl
    );

    const snapshot = await adapter.listMarkets();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe("https://api.predict.fun/v1/markets");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "test-key" });
    expect(snapshot.markets).toHaveLength(1);
    expect(snapshot.markets[0]).toMatchObject({
      id: "btc-5m-1",
      venue: "predict.fun",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      liquidityUsd: 42.5,
      status: "open"
    });
  });

  it("falls back to an empty snapshot on fetch failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const adapter = new RestPredictFunAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    await expect(adapter.listMarkets()).resolves.toMatchObject({ markets: [] });
  });
});
