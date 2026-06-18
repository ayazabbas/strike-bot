import { createHash } from "node:crypto";
import type { CmcAgentHubSnapshot, StrategyTuningSpec } from "../domain/types.js";
import type { RiskCheckResult } from "../risk/RiskManager.js";

export interface CmcStrategyTunerInput {
  readonly cmc: CmcAgentHubSnapshot;
  readonly risk: {
    readonly maxDailyLossUsd: number;
    readonly maxPositionUsd: number;
    readonly drawdownUsd?: number;
    readonly openExposureUsd?: number;
  };
  readonly guard?: RiskCheckResult;
  readonly pricing?: {
    readonly spread?: number;
    readonly stale?: boolean;
  };
}

export class CmcStrategyTuner {
  tune(input: CmcStrategyTunerInput): StrategyTuningSpec {
    const reasoning: string[] = [];
    const forceNoTradeReasons: string[] = [];
    const macroBias = classifyMacroBias(input.cmc);
    const volatilityRegime = classifyVolatilityRegime(input.cmc);
    const confidence = confidenceScore(input.cmc);

    if (input.cmc.status === "unavailable") {
      forceNoTradeReasons.push("cmc_agent_hub_unavailable");
    }
    if (volatilityRegime === "extreme") {
      forceNoTradeReasons.push("extreme_volatility");
    }
    if (input.risk.drawdownUsd !== undefined && input.risk.drawdownUsd >= input.risk.maxDailyLossUsd) {
      forceNoTradeReasons.push("daily_drawdown_cap_hit");
    }
    if (input.pricing?.stale) {
      forceNoTradeReasons.push("pricing_stale");
    }
    if (input.pricing?.spread !== undefined && input.pricing.spread > 0.12) {
      forceNoTradeReasons.push("pricing_spread_wide");
    }
    if (input.guard && !input.guard.approved) {
      forceNoTradeReasons.push(...input.guard.reasons.map((reason) => `risk_${reason}`));
    }

    reasoning.push(`cmc_status=${input.cmc.status}`);
    reasoning.push(`macro_bias=${macroBias}`);
    reasoning.push(`volatility_regime=${volatilityRegime}`);
    if (forceNoTradeReasons.length > 0) {
      reasoning.push(...forceNoTradeReasons);
    }

    const riskOff = macroBias === "risk_off" || forceNoTradeReasons.length > 0;
    return {
      schemaVersion: 1,
      strategyFamily: "prediction_market_ev_hgb",
      market: "BTC_5M_UP_DOWN",
      regime: {
        macroBias,
        volatilityRegime,
        confidence,
        validForMinutes: riskOff ? 15 : 60
      },
      parameterDeltas: {
        probabilityThresholdDelta: clamp(riskOff ? 0.05 : macroBias === "neutral" ? 0 : -0.01, -0.03, 0.05),
        maxEntryPriceDelta: clamp(riskOff ? -0.05 : macroBias === "bullish" ? 0.01 : 0, -0.05, 0.03),
        minEvEdgeDelta: clamp(riskOff ? 0.05 : volatilityRegime === "high" ? 0.02 : -0.005, -0.03, 0.05),
        maxNotionalMultiplier: clamp(riskOff ? 0 : volatilityRegime === "high" ? 0.75 : confidence >= 0.7 ? 1.2 : 1, 0, 1.5)
      },
      riskLimits: {
        maxTradesPerHour: riskOff ? 0 : volatilityRegime === "high" ? 3 : 6,
        maxDailyDrawdownUsd: input.risk.maxDailyLossUsd,
        maxOpenExposureUsd: input.risk.maxPositionUsd,
        forceNoTrade: forceNoTradeReasons.length > 0
      },
      reasoning,
      backtestSpec: {
        features: ["cmc_global_metrics", "cmc_btc_ta", "cmc_derivatives", "pyth_lazer_realtime", "predict_fun_odds"],
        labels: "predict_fun_btc_5m_settlement_direction",
        executionAssumptions: { fillPenalty: 0.01, fees: 0, slippage: 0.01 }
      }
    };
  }

  hash(spec: StrategyTuningSpec): string {
    return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16);
  }
}

function classifyMacroBias(snapshot: CmcAgentHubSnapshot): StrategyTuningSpec["regime"]["macroBias"] {
  const btc24h = snapshot.btc.percentChange24h ?? 0;
  const global24h = snapshot.global.totalMarketCapChange24h ?? 0;
  const fearGreed = snapshot.global.fearGreed;
  const fundingBias = snapshot.derivatives.fundingBias?.toLowerCase();

  if (fearGreed !== undefined && fearGreed < 20) {
    return "risk_off";
  }
  if (btc24h < -4 || global24h < -3 || fundingBias === "negative_extreme") {
    return "risk_off";
  }
  if (btc24h > 1.5 && global24h >= 0) {
    return "bullish";
  }
  if (btc24h < -1.5 && global24h <= 0) {
    return "bearish";
  }
  return "neutral";
}

function classifyVolatilityRegime(snapshot: CmcAgentHubSnapshot): StrategyTuningSpec["regime"]["volatilityRegime"] {
  const move = Math.abs(snapshot.btc.percentChange24h ?? 0);
  const rsi = snapshot.btc.rsi;
  if (move >= 8 || (rsi !== undefined && (rsi <= 15 || rsi >= 85))) {
    return "extreme";
  }
  if (move >= 4 || (rsi !== undefined && (rsi <= 25 || rsi >= 75))) {
    return "high";
  }
  if (move <= 0.75) {
    return "low";
  }
  return "normal";
}

function confidenceScore(snapshot: CmcAgentHubSnapshot): number {
  if (snapshot.status === "unavailable") {
    return 0;
  }
  let score = snapshot.status === "available" ? 0.45 : 0.25;
  if (snapshot.btc.priceUsd !== undefined) score += 0.1;
  if (snapshot.btc.rsi !== undefined) score += 0.1;
  if (snapshot.global.btcDominance !== undefined || snapshot.global.fearGreed !== undefined) score += 0.1;
  if (snapshot.derivatives.fundingBias || snapshot.derivatives.openInterestTrend) score += 0.1;
  if (snapshot.narratives.length > 0) score += 0.05;
  if (snapshot.macroEvents.length > 0) score += 0.05;
  return round(clamp(score, 0, 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
