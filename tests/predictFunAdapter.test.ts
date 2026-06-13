import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { RestPredictFunAdapter } from "../src/adapters/PredictFunAdapter.js";
import { filterBtcFiveMinuteMarkets } from "../src/domain/marketFilter.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe("RestPredictFunAdapter", () => {
  it("does not call the network when the predict.fun API key is absent", async () => {
    const fetchImpl = vi.fn();
    const adapter = new RestPredictFunAdapter(
      { predictFunBaseUrl: "https://api.predict.fun", predictFunApiKey: undefined },
      fetchImpl
    );

    await expect(adapter.listMarkets()).resolves.toMatchObject({ markets: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends x-api-key and maps plausible market payloads safely", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
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
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const adapter = new RestPredictFunAdapter(
      loadConfig({ PREDICT_FUN_API_KEY: "test-key", PREDICT_FUN_BASE_URL: "https://api.predict.fun" }),
      fetchImpl
    );

    const snapshot = await adapter.listMarkets();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe("https://api.predict.fun/v1/markets?first=100");
    expect(fetchImpl.mock.calls[1][0].toString()).toBe(
      "https://api.predict.fun/v1/categories?first=100&status=OPEN&marketVariant=CRYPTO_UP_DOWN"
    );
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

  it("maps the live /v1/markets shape without treating BTC daily markets as 5-minute markets", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 123,
              title: "Bitcoin 5 minute UP or DOWN",
              symbol: "BTC",
              interval: "5m",
              outcomes: [{ name: "Up" }, { name: "Down" }],
              startTime: "2026-06-13T12:00:00.000Z",
              closeTime: "2026-06-13T12:05:00.000Z",
              status: "OPEN"
            },
            {
              id: 124,
              title: "Bitcoin Up/Down daily market - June 5, 2026",
              symbol: "BTC",
              outcomes: [{ name: "Up" }, { name: "Down" }],
              startTime: "2026-06-05T00:00:00.000Z",
              closeTime: "2026-06-06T00:00:00.000Z",
              status: "CLOSED"
            },
            {
              id: 125,
              title: "Bitcoin 5 minute UP or DOWN",
              symbol: "BTC",
              interval: "5m",
              outcomes: [{ name: "Up" }, { name: "Down" }],
              startTime: "2026-06-13T12:05:00.000Z",
              closeTime: "2026-06-13T12:10:00.000Z",
              status: "RESOLVED"
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const adapter = new RestPredictFunAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    const snapshot = await adapter.listMarkets();

    expect(snapshot.markets).toHaveLength(3);
    expect(snapshot.markets[0]).toMatchObject({
      id: "123",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      status: "open"
    });
    expect(snapshot.markets[1]).toMatchObject({
      id: "124",
      asset: "BTC",
      intervalMinutes: 1440,
      directions: ["UP", "DOWN"],
      status: "closed"
    });
    expect(snapshot.markets[2]).toMatchObject({
      id: "125",
      status: "settled"
    });
    expect(filterBtcFiveMinuteMarkets(snapshot.markets).map((market) => market.id)).toEqual(["123"]);
  });

  it("maps BTC 5-minute crypto up/down markets nested under categories", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            slug: "btc-updown-5m-1781372100",
            title: "Bitcoin Up or Down - June 13, 1:35PM-1:40PM ET",
            startsAt: "2026-06-13T17:35:00.000Z",
            endsAt: "2026-06-13T17:40:00.000Z",
            status: "OPEN",
            marketVariant: "CRYPTO_UP_DOWN",
            markets: [
              {
                id: 472369,
                categorySlug: "btc-updown-5m-1781372100",
                title: "Bitcoin Up or Down - June 13, 1:35PM-1:40PM ET",
                question: "Bitcoin Up or Down - June 13, 1:35PM-1:40PM ET",
                marketVariant: "CRYPTO_UP_DOWN",
                outcomes: [{ name: "Up" }, { name: "Down" }],
                status: "REGISTERED",
                tradingStatus: "OPEN"
              }
            ]
          }
        ]
      })
    );
    const adapter = new RestPredictFunAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    const snapshot = await adapter.listMarkets();
    const btcMarkets = filterBtcFiveMinuteMarkets(snapshot.markets);

    expect(btcMarkets).toHaveLength(1);
    expect(btcMarkets[0]).toMatchObject({
      id: "472369",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      status: "open"
    });
    expect(btcMarkets[0].startsAt.toISOString()).toBe("2026-06-13T17:35:00.000Z");
    expect(btcMarkets[0].closesAt.toISOString()).toBe("2026-06-13T17:40:00.000Z");
  });
});
