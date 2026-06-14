import { describe, expect, it } from "vitest";
import { MomentumStrategySkill } from "../src/strategy/MomentumStrategySkill.js";
import type { MarketPricing, SelectedBtcFiveMinuteMarket } from "../src/domain/types.js";

const now = new Date("2026-06-13T12:02:00.000Z");

function selectedMarket(overrides: Partial<SelectedBtcFiveMinuteMarket> = {}): SelectedBtcFiveMinuteMarket {
  const startsAt = new Date("2026-06-13T12:00:00.000Z");
  const closesAt = new Date("2026-06-13T12:05:00.000Z");
  return {
    id: "472571",
    categorySlug: "btc-updown-5m-1781352000",
    startsAt,
    closesAt,
    timeRemainingSeconds: 180,
    market: {
      id: "472571",
      venue: "predict.fun",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      startsAt,
      closesAt,
      resolvesAt: closesAt,
      status: "open"
    },
    ...overrides
  };
}

function pricing(overrides: Partial<MarketPricing> = {}): MarketPricing {
  return {
    marketId: "472571",
    capturedAt: now,
    source: "predict.fun",
    status: "available",
    up: { bestBid: 0.70, bestAsk: 0.76, impliedProbability: 0.73 },
    down: { bestBid: 0.20, bestAsk: 0.24, impliedProbability: 0.22 },
    spread: 0.04,
    ...overrides
  };
}

describe("MomentumStrategySkill", () => {
  it("enters UP when momentum trigger fires and ask is below edge-adjusted fair threshold", async () => {
    const strategy = new MomentumStrategySkill({ minEdge: 0.05 }, () => now);

    const decision = await strategy.decide({
      runMode: "paper",
      macro: { capturedAt: now, source: "coinmarketcap", stubbed: true },
      candle: {
        capturedAt: now,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        latestCandleOpenTime: new Date("2026-06-13T12:00:00.000Z"),
        latestCandle: { openTime: new Date("2026-06-13T12:00:00.000Z"), open: 100, high: 103, low: 99, close: 102 },
        stubbed: false
      },
      markets: [],
      selectedMarket: selectedMarket(),
      pricing: pricing()
    });

    expect(decision).toMatchObject({
      action: "enter",
      marketId: "472571",
      direction: "UP",
      notionalUsd: 1,
      runMode: "paper"
    });
    expect(decision.metadata).toMatchObject({
      triggerName: "momentum_continuation",
      fairThreshold: 0.8248,
      maxAcceptableAsk: 0.7748,
      askPrice: 0.76,
      edge: 0.0648,
      elapsedMinutes: 2
    });
  });

  it("skips when signal fires but ask is above edge-adjusted fair threshold", async () => {
    const strategy = new MomentumStrategySkill({ minEdge: 0.05 }, () => now);

    const decision = await strategy.decide({
      runMode: "paper",
      macro: { capturedAt: now, source: "coinmarketcap", stubbed: true },
      candle: {
        capturedAt: now,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        latestCandleOpenTime: new Date("2026-06-13T12:00:00.000Z"),
        latestCandle: { openTime: new Date("2026-06-13T12:00:00.000Z"), open: 100, high: 103, low: 99, close: 102 },
        stubbed: false
      },
      markets: [],
      selectedMarket: selectedMarket(),
      pricing: pricing({ up: { bestBid: 0.78, bestAsk: 0.80, impliedProbability: 0.79 } })
    });

    expect(decision).toMatchObject({
      action: "no_trade",
      reason: "price_above_threshold",
      marketId: "472571",
      runMode: "paper"
    });
    expect(decision.metadata).toMatchObject({ askPrice: 0.8, maxAcceptableAsk: 0.7748 });
  });

  it("skips when no momentum trigger fires", async () => {
    const strategy = new MomentumStrategySkill({}, () => now);

    const decision = await strategy.decide({
      runMode: "paper",
      macro: { capturedAt: now, source: "coinmarketcap", stubbed: true },
      candle: {
        capturedAt: now,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        latestCandleOpenTime: new Date("2026-06-13T12:00:00.000Z"),
        latestCandle: { openTime: new Date("2026-06-13T12:00:00.000Z"), open: 100, high: 101, low: 99, close: 100.01 },
        stubbed: false
      },
      markets: [],
      selectedMarket: selectedMarket(),
      pricing: pricing()
    });

    expect(decision).toMatchObject({ action: "no_trade", reason: "signal_not_triggered" });
  });
});
