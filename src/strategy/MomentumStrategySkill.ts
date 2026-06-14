import type { DecisionReason, MarketDirection, MarketPricing, StrategyDecision, StrategyDecisionMetadata } from "../domain/types.js";
import type { StrategyContext, StrategySkill } from "./StrategySkill.js";

export interface MomentumEdgeScale {
  readonly startEdge: number;
  readonly endEdge: number;
  readonly durationSeconds: number;
}

export interface MomentumStrategyOptions {
  readonly minAbsReturnBps?: number;
  readonly minUpCloseLocation?: number;
  readonly maxDownCloseLocation?: number;
  readonly minEdge?: number;
  readonly edgeScale?: MomentumEdgeScale;
  readonly notionalUsd?: number;
  readonly candleStartToleranceSeconds?: number;
}

const DEFAULT_EDGE_SCALE: MomentumEdgeScale = {
  startEdge: 0.06,
  endEdge: 0.01,
  durationSeconds: 300
};

const DEFAULT_OPTIONS = {
  minAbsReturnBps: 5,
  minUpCloseLocation: 0.7,
  maxDownCloseLocation: 0.3,
  minEdge: 0.05,
  edgeScale: DEFAULT_EDGE_SCALE,
  notionalUsd: 1,
  candleStartToleranceSeconds: 90
} as const;

const FAIR_THRESHOLDS: Record<number, Record<MarketDirection, number>> = {
  1: { UP: 0.7595, DOWN: 0.7733 },
  2: { UP: 0.8248, DOWN: 0.8375 },
  3: { UP: 0.8824, DOWN: 0.8786 },
  4: { UP: 0.9201, DOWN: 0.9303 }
};

export class MomentumStrategySkill implements StrategySkill {
  readonly name = "MomentumStrategySkill";
  private readonly options: Required<Omit<MomentumStrategyOptions, "edgeScale">> & {
    readonly edgeScale?: MomentumEdgeScale;
  };

  constructor(options: MomentumStrategyOptions = {}, private readonly now: () => Date = () => new Date()) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      edgeScale: options.minEdge !== undefined && options.edgeScale === undefined ? undefined : (options.edgeScale ?? DEFAULT_EDGE_SCALE)
    };
  }

  async decide(context: StrategyContext): Promise<StrategyDecision> {
    const createdAt = this.now();
    const selected = context.selectedMarket;
    if (!selected) {
      return this.noTrade("market_not_selected", context, createdAt);
    }

    const latest = context.candle.latestCandle;
    if (context.candle.stubbed || !latest) {
      return this.noTrade("candle_unavailable", context, createdAt, selected.id);
    }

    const startMetadata = marketStartMetadata(createdAt, selected.startsAt);
    if (createdAt.getTime() < selected.startsAt.getTime()) {
      return this.noTrade("market_not_started", context, createdAt, selected.id, startMetadata);
    }

    const candleMetadata = candleStartMetadata(
      selected.startsAt,
      latest.openTime,
      this.options.candleStartToleranceSeconds
    );
    const baseMetadata: StrategyDecisionMetadata = {
      ...startMetadata,
      ...candleMetadata
    };

    const candleStartDeltaSeconds = round((latest.openTime.getTime() - selected.startsAt.getTime()) / 1000);
    if (Math.abs(candleStartDeltaSeconds) > this.options.candleStartToleranceSeconds) {
      return this.noTrade("candle_market_mismatch", context, createdAt, selected.id, baseMetadata);
    }

    if (!context.pricing || context.pricing.status !== "available") {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, baseMetadata);
    }

    const elapsedSeconds = Math.max(0, Math.floor((createdAt.getTime() - selected.startsAt.getTime()) / 1000));
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    const clampedElapsedMinutes = clamp(elapsedMinutes, 1, 4);
    const range = latest.high - latest.low;
    if (range <= 0 || latest.open <= 0) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }

    const partialReturnBps = ((latest.close - latest.open) / latest.open) * 10_000;
    const closeLocation = (latest.close - latest.low) / range;
    const direction = triggerDirection(partialReturnBps, closeLocation, this.options);
    const signalMetadata: StrategyDecisionMetadata = {
      ...baseMetadata,
      strategyName: this.name,
      triggerName: direction ? "momentum_continuation" : undefined,
      elapsedMinutes: clampedElapsedMinutes,
      partialReturnBps: round(partialReturnBps),
      closeLocation: round(closeLocation)
    };

    if (!direction) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, signalMetadata);
    }

    const askPrice = askForDirection(context.pricing, direction);
    if (askPrice === undefined) {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, signalMetadata);
    }

    const fairThreshold = FAIR_THRESHOLDS[clampedElapsedMinutes]?.[direction];
    const edgeRequirement = minEdgeForElapsedSeconds(elapsedSeconds, this.options);
    const minRequiredEdge = edgeRequirement.minEdge;
    const maxAcceptableAsk = fairThreshold - minRequiredEdge;
    const edge = fairThreshold - askPrice;
    const metadata = {
      ...signalMetadata,
      elapsedSeconds,
      edgeScale: edgeRequirement.scale,
      minRequiredEdge: round(minRequiredEdge),
      fairThreshold,
      maxAcceptableAsk: round(maxAcceptableAsk),
      askPrice,
      edge: round(edge)
    };

    if (askPrice > maxAcceptableAsk) {
      return this.noTrade("price_above_threshold", context, createdAt, selected.id, metadata);
    }

    return {
      action: "enter",
      marketId: selected.id,
      direction,
      notionalUsd: this.options.notionalUsd,
      runMode: context.runMode,
      createdAt,
      metadata
    };
  }

  private noTrade(
    reason: DecisionReason,
    context: StrategyContext,
    createdAt: Date,
    marketId?: string,
    metadata?: StrategyDecisionMetadata
  ): StrategyDecision {
    return {
      action: "no_trade",
      reason,
      marketId,
      runMode: context.runMode,
      createdAt,
      metadata: metadata ? { strategyName: this.name, ...metadata } : { strategyName: this.name }
    };
  }
}

function triggerDirection(
  partialReturnBps: number,
  closeLocation: number,
  options: Pick<Required<MomentumStrategyOptions>, "minAbsReturnBps" | "minUpCloseLocation" | "maxDownCloseLocation">
): MarketDirection | undefined {
  if (partialReturnBps >= options.minAbsReturnBps && closeLocation >= options.minUpCloseLocation) {
    return "UP";
  }
  if (partialReturnBps <= -options.minAbsReturnBps && closeLocation <= options.maxDownCloseLocation) {
    return "DOWN";
  }
  return undefined;
}

function minEdgeForElapsedSeconds(
  elapsedSeconds: number,
  options: { readonly minEdge: number; readonly edgeScale?: MomentumEdgeScale }
): { readonly minEdge: number; readonly scale: string } {
  if (!options.edgeScale) {
    return { minEdge: options.minEdge, scale: "uniform" };
  }
  const elapsedRatio = clamp(elapsedSeconds / options.edgeScale.durationSeconds, 0, 1);
  const scaledEdge = options.edgeScale.startEdge - (options.edgeScale.startEdge - options.edgeScale.endEdge) * elapsedRatio;
  return { minEdge: scaledEdge, scale: "continuous_linear" };
}

function askForDirection(pricing: MarketPricing, direction: MarketDirection): number | undefined {
  return direction === "UP" ? pricing.up.bestAsk : pricing.down.bestAsk;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function marketStartMetadata(createdAt: Date, marketStartsAt: Date): StrategyDecisionMetadata {
  const marketStartDeltaSeconds = round((createdAt.getTime() - marketStartsAt.getTime()) / 1000);
  return {
    marketStartsAt: marketStartsAt.toISOString(),
    marketStartDeltaSeconds,
    secondsSinceMarketStart: marketStartDeltaSeconds >= 0 ? marketStartDeltaSeconds : undefined
  };
}

function candleStartMetadata(
  marketStartsAt: Date,
  candleOpenTime: Date,
  candleStartToleranceSeconds: number
): StrategyDecisionMetadata {
  return {
    marketStartsAt: marketStartsAt.toISOString(),
    candleOpenTime: candleOpenTime.toISOString(),
    candleStartDeltaSeconds: round((candleOpenTime.getTime() - marketStartsAt.getTime()) / 1000),
    candleStartToleranceSeconds
  };
}
