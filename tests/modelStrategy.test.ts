import { describe, expect, it, vi } from "vitest";
import type { MarketPricing, SelectedBtcFiveMinuteMarket } from "../src/domain/types.js";
import type { ModelInferenceClient } from "../src/inference/types.js";
import { ModelStrategySkill } from "../src/strategy/ModelStrategySkill.js";
import type { StrategyContext } from "../src/strategy/StrategySkill.js";

const now = new Date("2026-06-18T12:02:00.000Z");
const startsAt = new Date("2026-06-18T12:00:00.000Z");
const closesAt = new Date("2026-06-18T12:05:00.000Z");

function selectedMarket(): SelectedBtcFiveMinuteMarket {
  return {
    id: "511762",
    categorySlug: "btc-updown-5m-1781784000",
    startsAt,
    closesAt,
    timeRemainingSeconds: 180,
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
    capturedAt: now,
    source: "predict.fun",
    status: "available",
    up: { bestBid: 0.44, bestAsk: 0.47 },
    down: { bestBid: 0.49, bestAsk: 0.52 },
    spread: 0.03,
    ...overrides
  };
}

function context(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    runMode: "paper",
    macro: { capturedAt: now, source: "coinmarketcap", stubbed: false, btcUsd: 104000 },
    candle: {
      capturedAt: now,
      source: "pyth-pro",
      symbol: "BTC",
      intervalMinutes: 5,
      latestCandleOpenTime: startsAt,
      latestCandle: { openTime: startsAt, open: 103900, high: 104100, low: 103850, close: 104000 },
      stubbed: false
    },
    markets: [],
    selectedMarket: selectedMarket(),
    pricing: pricing(),
    ...overrides
  };
}

describe("ModelStrategySkill", () => {
  it("calls local inference and enters the best eligible model candidate", async () => {
    const infer = vi.fn<ModelInferenceClient["infer"]>(async (request) => {
      expect(request.features.featureState).toMatchObject({
        elapsed_seconds: 120,
        up_ask: 0.47,
        down_ask: 0.52
      });
      return {
        status: "ok",
        capturedAt: "2026-06-18T12:02:00.100Z",
        modelVersion: "test-model",
        candidates: [
          { direction: "UP", entryAsk: 0.47, profitabilityProbability: 0.62, predictedEv: 0.15, directionProbability: 0.7, directionEdge: 0.23 },
          { direction: "DOWN", entryAsk: 0.52, profitabilityProbability: 0.4, predictedEv: -0.12, directionProbability: 0.3, directionEdge: -0.22 }
        ]
      };
    });
    const strategy = new ModelStrategySkill({ infer }, { notionalUsd: 1 }, () => now);

    const decision = await strategy.decide(context());

    expect(infer).toHaveBeenCalledTimes(1);
    expect(decision).toMatchObject({
      action: "enter",
      marketId: "511762",
      direction: "UP",
      notionalUsd: 1,
      runMode: "paper",
      metadata: {
        strategyName: "ModelStrategySkill",
        triggerName: "model_ev_direction_ensemble",
        modelVersion: "test-model",
        predictedProfitProbability: 0.62,
        evEdge: 0.15,
        directionEdge: 0.23,
        rawAskPrice: 0.47,
        currentAskPrice: 0.47
      }
    });
  });

  it("returns no trade when endpoint is not configured or unavailable", async () => {
    await expect(new ModelStrategySkill(undefined, { notionalUsd: 1 }, () => now).decide(context())).resolves.toMatchObject({
      action: "no_trade",
      reason: "model_not_configured"
    });

    await expect(
      new ModelStrategySkill(
        {
          async infer() {
            return { status: "unavailable", reason: "endpoint_unreachable" };
          }
        },
        { notionalUsd: 1 },
        () => now
      ).decide(context())
    ).resolves.toMatchObject({
      action: "no_trade",
      reason: "model_unavailable",
      metadata: { modelUnavailableReason: "endpoint_unreachable" }
    });
  });

  it("preserves current pricing checks after model inference", async () => {
    const strategy = new ModelStrategySkill(
      {
        async infer() {
          return {
            status: "ok",
            capturedAt: "2026-06-18T12:02:00.100Z",
            candidates: [
              { direction: "UP", entryAsk: 0.4, profitabilityProbability: 0.7, predictedEv: 0.3, directionProbability: 0.8, directionEdge: 0.33 }
            ]
          };
        }
      },
      { notionalUsd: 1, maxPriceChase: 0.03 },
      () => now
    );

    await expect(strategy.decide(context())).resolves.toMatchObject({
      action: "no_trade",
      reason: "price_above_threshold",
      marketId: "511762"
    });
  });
});
