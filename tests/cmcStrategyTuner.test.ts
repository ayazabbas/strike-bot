import { describe, expect, it } from "vitest";
import { CmcStrategyTuner } from "../src/strategy/CmcStrategyTuner.js";
import type { CmcAgentHubSnapshot } from "../src/domain/types.js";

function snapshot(overrides: Partial<CmcAgentHubSnapshot> = {}): CmcAgentHubSnapshot {
  return {
    capturedAt: "2026-06-18T00:00:00.000Z",
    source: "cmc-agent-hub",
    status: "available",
    reasons: [],
    btc: { id: 1, priceUsd: 70000, percentChange24h: 2, percentChange7d: 5, rsi: 58 },
    global: { totalMarketCapChange24h: 1, fearGreed: 60, btcDominance: 58 },
    derivatives: { fundingBias: "positive", openInterestTrend: "rising" },
    narratives: [{ name: "Bitcoin", performance24h: 1 }],
    macroEvents: [],
    ...overrides
  };
}

describe("CmcStrategyTuner", () => {
  it("produces bounded tuning deltas for normal available context", () => {
    const spec = new CmcStrategyTuner().tune({
      cmc: snapshot(),
      risk: { maxDailyLossUsd: 10, maxPositionUsd: 5 },
      pricing: { spread: 0.04 }
    });

    expect(spec.regime.macroBias).toBe("bullish");
    expect(spec.regime.volatilityRegime).toBe("normal");
    expect(spec.riskLimits.forceNoTrade).toBe(false);
    expect(spec.parameterDeltas.probabilityThresholdDelta).toBeGreaterThanOrEqual(-0.03);
    expect(spec.parameterDeltas.probabilityThresholdDelta).toBeLessThanOrEqual(0.05);
    expect(spec.parameterDeltas.maxEntryPriceDelta).toBeLessThanOrEqual(0.03);
    expect(spec.parameterDeltas.maxNotionalMultiplier).toBeLessThanOrEqual(1.5);
  });

  it("forces no-trade for unavailable CMC or wide pricing", () => {
    const spec = new CmcStrategyTuner().tune({
      cmc: snapshot({ status: "unavailable", reasons: ["cmc_mcp_api_key_missing"] }),
      risk: { maxDailyLossUsd: 10, maxPositionUsd: 5 },
      pricing: { spread: 0.2 }
    });

    expect(spec.riskLimits.forceNoTrade).toBe(true);
    expect(spec.parameterDeltas).toMatchObject({
      probabilityThresholdDelta: 0.05,
      maxEntryPriceDelta: -0.05,
      minEvEdgeDelta: 0.05,
      maxNotionalMultiplier: 0
    });
    expect(spec.reasoning).toEqual(expect.arrayContaining(["cmc_agent_hub_unavailable", "pricing_spread_wide"]));
  });

  it("forces no-trade when daily drawdown cap is hit", () => {
    const spec = new CmcStrategyTuner().tune({
      cmc: snapshot(),
      risk: { maxDailyLossUsd: 10, maxPositionUsd: 5, drawdownUsd: 10 }
    });

    expect(spec.riskLimits.forceNoTrade).toBe(true);
    expect(spec.riskLimits.maxTradesPerHour).toBe(0);
    expect(spec.reasoning).toContain("daily_drawdown_cap_hit");
  });
});
