import { describe, expect, it } from "vitest";
import type { MarketPricing, SelectedBtcFiveMinuteMarket } from "../src/domain/types.js";
import { buildModelInferenceRequest } from "../src/inference/buildModelInferenceRequest.js";

const capturedAt = new Date("2026-06-18T12:00:05.000Z");
const startsAt = new Date("2026-06-18T12:00:00.000Z");
const closesAt = new Date("2026-06-18T12:05:00.000Z");

function selectedMarket(): SelectedBtcFiveMinuteMarket {
  return {
    id: "511762",
    categorySlug: "btc-updown-5m-1781784000",
    startsAt,
    closesAt,
    timeRemainingSeconds: 295,
    market: {
      id: "511762",
      venue: "predict.fun",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      startsAt,
      closesAt,
      resolvesAt: closesAt,
      status: "open"
    }
  };
}

function pricing(overrides: Partial<MarketPricing> = {}): MarketPricing {
  return {
    marketId: "511762",
    capturedAt: new Date("2026-06-18T12:00:04.900Z"),
    source: "predict.fun",
    status: "available",
    up: { bestBid: 0.44, bestAsk: 0.47 },
    down: { bestBid: 0.49, bestAsk: 0.52 },
    spread: 0.03,
    ...overrides
  };
}

describe("buildModelInferenceRequest", () => {
  it("builds an inference payload from TS-owned market, pricing, macro, and candle state", () => {
    const request = buildModelInferenceRequest({
      requestId: "req-1",
      capturedAt,
      runMode: "paper",
      selectedMarket: selectedMarket(),
      pricing: pricing(),
      macro: {
        capturedAt,
        source: "coinmarketcap",
        stubbed: false,
        btcUsd: 104000,
        btc24hChangePct: 1.2
      },
      candle: {
        capturedAt,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        latestCandleOpenTime: startsAt,
        latestCandle: { openTime: startsAt, open: 103900, high: 104100, low: 103850, close: 104000 },
        stubbed: false
      }
    });

    expect(request).toMatchObject({
      requestId: "req-1",
      capturedAt: "2026-06-18T12:00:05.000Z",
      runMode: "paper",
      market: {
        id: "511762",
        categorySlug: "btc-updown-5m-1781784000",
        startsAt: "2026-06-18T12:00:00.000Z",
        closesAt: "2026-06-18T12:05:00.000Z",
        timeRemainingSeconds: 295,
        status: "open"
      },
      features: {
        btcUsd: 104000,
        btc24hChangePct: 1.2,
        elapsedSeconds: 5,
        featureState: {
          evaluation_time: "2026-06-18T12:00:05.000Z",
          window_start: "2026-06-18T12:00:00.000Z",
          window_end: "2026-06-18T12:05:00.000Z",
          elapsed_seconds: 5,
          seconds_to_close: 295,
          up_ask: 0.47,
          down_ask: 0.52,
          partial_return_bps: 9.6246,
          close_location: 0.6
        },
        latestCandle: {
          openTime: "2026-06-18T12:00:00.000Z",
          open: 103900,
          high: 104100,
          low: 103850,
          close: 104000
        }
      },
      candidates: [
        { direction: "UP", entryAsk: 0.47, entryBid: 0.44 },
        { direction: "DOWN", entryAsk: 0.52, entryBid: 0.49 }
      ]
    });
  });

  it("adds high-value multi-timeframe momentum/regime features for live model inference", () => {
    const recentCandles = Array.from({ length: 241 }, (_, index) => {
      const openTime = new Date(startsAt.getTime() - (240 - index) * 60_000);
      const open = 100_000 - (240 - index) * 10;
      const close = open + (index % 2 === 0 ? 5 : -3) + index;
      return {
        openTime,
        open,
        high: Math.max(open, close) + 10,
        low: Math.min(open, close) - 10,
        close,
        volume: 1
      };
    });

    const request = buildModelInferenceRequest({
      requestId: "req-momentum",
      capturedAt,
      runMode: "paper",
      selectedMarket: selectedMarket(),
      pricing: pricing(),
      macro: { capturedAt, source: "coinmarketcap", stubbed: false, btcUsd: 104000 },
      candle: {
        capturedAt,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 1,
        latestCandleOpenTime: startsAt,
        latestCandle: recentCandles.at(-1),
        recentCandles,
        stubbed: false
      }
    });

    expect(request?.features.featureState).toMatchObject({
      return_3m_bps: expect.any(Number),
      return_10m_bps: expect.any(Number),
      return_15m_bps: expect.any(Number),
      return_30m_bps: expect.any(Number),
      return_60m_bps: expect.any(Number),
      tf5m_return_bps: expect.any(Number),
      tf15m_return_bps: expect.any(Number),
      tf5m_rsi_14: expect.any(Number),
      tf15m_rsi_14: expect.any(Number),
      macd_histogram: expect.any(Number),
      macd_histogram_slope: expect.any(Number),
      rsi_14_slope_3m: expect.any(Number),
      momentum_acceleration_5m_bps: expect.any(Number),
      consecutive_up_1m_candles: expect.any(Number),
      consecutive_down_1m_candles: expect.any(Number),
      ema_stack_bullish: expect.any(Boolean),
      ema_stack_bearish: expect.any(Boolean)
    });
  });

  it("returns undefined when pricing is unavailable or either candidate ask is missing", () => {
    expect(
      buildModelInferenceRequest({
        requestId: "req-1",
        capturedAt,
        runMode: "paper",
        selectedMarket: selectedMarket(),
        pricing: pricing({ status: "unknown" }),
        macro: { capturedAt, source: "coinmarketcap", stubbed: true },
        candle: { capturedAt, source: "pyth-pro", symbol: "BTC", intervalMinutes: 5, stubbed: true }
      })
    ).toBeUndefined();

    expect(
      buildModelInferenceRequest({
        requestId: "req-1",
        capturedAt,
        runMode: "paper",
        selectedMarket: selectedMarket(),
        pricing: pricing({ down: { bestBid: 0.49 } }),
        macro: { capturedAt, source: "coinmarketcap", stubbed: true },
        candle: { capturedAt, source: "pyth-pro", symbol: "BTC", intervalMinutes: 5, stubbed: true }
      })
    ).toBeUndefined();
  });
});
