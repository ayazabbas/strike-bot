import { describe, expect, it } from "vitest";
import { MomentumStrategySkill } from "../src/strategy/MomentumStrategySkill.js";
import type { MarketPricing, SelectedBtcFiveMinuteMarket } from "../src/domain/types.js";
import type { StrategyContext } from "../src/strategy/StrategySkill.js";

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

function context(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
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
    pricing: pricing(),
    ...overrides
  };
}

describe("MomentumStrategySkill", () => {
  it("enters UP when momentum trigger fires and ask is below edge-adjusted fair threshold", async () => {
    const strategy = new MomentumStrategySkill({ minEdge: 0.05 }, () => now);

    const decision = await strategy.decide(context());

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
      elapsedMinutes: 2,
      marketStartsAt: "2026-06-13T12:00:00.000Z",
      candleOpenTime: "2026-06-13T12:00:00.000Z",
      candleStartDeltaSeconds: 0,
      candleStartToleranceSeconds: 90,
      marketStartDeltaSeconds: 120,
      secondsSinceMarketStart: 120
    });
  });

  it("skips before the selected market starts before evaluating pricing or signal", async () => {
    const strategy = new MomentumStrategySkill({}, () => new Date("2026-06-13T11:59:30.000Z"));

    const decision = await strategy.decide(context({ pricing: undefined }));

    expect(decision).toMatchObject({
      action: "no_trade",
      reason: "market_not_started",
      marketId: "472571",
      runMode: "paper"
    });
    expect(decision.metadata).toMatchObject({
      marketStartsAt: "2026-06-13T12:00:00.000Z",
      marketStartDeltaSeconds: -30
    });
    expect(decision.metadata?.secondsSinceMarketStart).toBeUndefined();
  });

  it("allows a candle start mismatch within configured tolerance", async () => {
    const strategy = new MomentumStrategySkill({ minEdge: 0.05, candleStartToleranceSeconds: 90 }, () => now);

    const decision = await strategy.decide(
      context({
        candle: {
          capturedAt: now,
          source: "pyth-pro",
          symbol: "BTC",
          intervalMinutes: 5,
          latestCandleOpenTime: new Date("2026-06-13T12:01:00.000Z"),
          latestCandle: { openTime: new Date("2026-06-13T12:01:00.000Z"), open: 100, high: 103, low: 99, close: 102 },
          stubbed: false
        }
      })
    );

    expect(decision).toMatchObject({ action: "enter", direction: "UP" });
    expect(decision.metadata).toMatchObject({
      candleOpenTime: "2026-06-13T12:01:00.000Z",
      candleStartDeltaSeconds: 60,
      candleStartToleranceSeconds: 90
    });
  });

  it("skips when the latest candle start is outside configured market tolerance", async () => {
    const strategy = new MomentumStrategySkill({ candleStartToleranceSeconds: 90 }, () => now);

    const decision = await strategy.decide(
      context({
        pricing: undefined,
        candle: {
          capturedAt: now,
          source: "pyth-pro",
          symbol: "BTC",
          intervalMinutes: 5,
          latestCandleOpenTime: new Date("2026-06-13T12:02:00.000Z"),
          latestCandle: { openTime: new Date("2026-06-13T12:02:00.000Z"), open: 100, high: 103, low: 99, close: 102 },
          stubbed: false
        }
      })
    );

    expect(decision).toMatchObject({
      action: "no_trade",
      reason: "candle_market_mismatch",
      marketId: "472571"
    });
    expect(decision.metadata).toMatchObject({
      marketStartsAt: "2026-06-13T12:00:00.000Z",
      candleOpenTime: "2026-06-13T12:02:00.000Z",
      candleStartDeltaSeconds: 120,
      candleStartToleranceSeconds: 90,
      secondsSinceMarketStart: 120
    });
  });

  it("scales the required edge continuously lower as market time elapses", async () => {
    const earlyStrategy = new MomentumStrategySkill({}, () => new Date("2026-06-13T12:00:45.000Z"));
    const lateStrategy = new MomentumStrategySkill({}, () => new Date("2026-06-13T12:04:40.000Z"));

    const earlyDecision = await earlyStrategy.decide(
      context({ pricing: pricing({ up: { bestBid: 0.69, bestAsk: 0.71, impliedProbability: 0.7 } }) })
    );
    const lateDecision = await lateStrategy.decide(
      context({ pricing: pricing({ up: { bestBid: 0.84, bestAsk: 0.86, impliedProbability: 0.85 } }) })
    );

    expect(earlyDecision).toMatchObject({
      action: "no_trade",
      reason: "price_above_threshold",
      marketId: "472571",
      runMode: "paper"
    });
    expect(earlyDecision.metadata).toMatchObject({
      elapsedSeconds: 45,
      minRequiredEdge: 0.0525,
      edgeScale: "continuous_linear",
      askPrice: 0.71,
      maxAcceptableAsk: 0.707
    });

    expect(lateDecision).toMatchObject({
      action: "enter",
      marketId: "472571",
      direction: "UP",
      runMode: "paper"
    });
    expect(lateDecision.metadata).toMatchObject({
      elapsedSeconds: 280,
      minRequiredEdge: 0.0133,
      edgeScale: "continuous_linear",
      askPrice: 0.86,
      maxAcceptableAsk: 0.9068,
      edge: 0.0601
    });
  });

  it("skips when signal fires but ask is above edge-adjusted fair threshold", async () => {
    const strategy = new MomentumStrategySkill({ minEdge: 0.05 }, () => now);

    const decision = await strategy.decide(
      context({ pricing: pricing({ up: { bestBid: 0.78, bestAsk: 0.80, impliedProbability: 0.79 } }) })
    );

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

    const decision = await strategy.decide(
      context({
        candle: {
          capturedAt: now,
          source: "pyth-pro",
          symbol: "BTC",
          intervalMinutes: 5,
          latestCandleOpenTime: new Date("2026-06-13T12:00:00.000Z"),
          latestCandle: {
            openTime: new Date("2026-06-13T12:00:00.000Z"),
            open: 100,
            high: 101,
            low: 99,
            close: 100.01
          },
          stubbed: false
        }
      })
    );

    expect(decision).toMatchObject({ action: "no_trade", reason: "signal_not_triggered" });
  });
});
