import type { RunMode } from "../config.js";
import { buildModelInferenceRequest } from "../inference/buildModelInferenceRequest.js";
import type { ModelInferenceCandidateOutput, ModelInferenceClient, ModelInferenceRequest } from "../inference/types.js";
import type {
  DecisionReason,
  MarketDirection,
  MarketPricing,
  StrategyDecision,
  StrategyDecisionMetadata
} from "../domain/types.js";
import { PREDICT_FUN_MIN_ORDER_NOTIONAL_USD } from "../domain/predictFunLimits.js";
import type { StrategyContext, StrategySkill } from "./StrategySkill.js";

export interface ModelStrategyOptions {
  readonly notionalUsd: number;
  readonly probabilityThreshold?: number;
  readonly maxEntryPrice?: number;
  readonly minEvEdge?: number;
  readonly directionMinEdge?: number;
  readonly maxPriceChase?: number;
  readonly minElapsedSeconds?: number;
  readonly minSecondsToClose?: number;
}

const DEFAULT_OPTIONS = {
  probabilityThreshold: 0.45,
  maxEntryPrice: 0.55,
  minEvEdge: 0.01,
  directionMinEdge: 0.2,
  maxPriceChase: 0.03,
  minElapsedSeconds: 60,
  minSecondsToClose: 60
} as const;

export class ModelStrategySkill implements StrategySkill {
  readonly name = "ModelStrategySkill";
  private readonly options: Required<ModelStrategyOptions>;

  constructor(
    private readonly client: ModelInferenceClient | undefined,
    options: ModelStrategyOptions,
    private readonly now: () => Date = () => new Date()
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async decide(context: StrategyContext): Promise<StrategyDecision> {
    const createdAt = this.now();
    const selected = context.selectedMarket;
    if (!selected) {
      return this.noTrade("market_not_selected", context, createdAt);
    }
    if (createdAt.getTime() < selected.startsAt.getTime()) {
      return this.noTrade("market_not_started", context, createdAt, selected.id, this.timingMetadata(createdAt, selected));
    }
    if (!context.pricing || context.pricing.status !== "available") {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, this.timingMetadata(createdAt, selected));
    }
    if (!this.client) {
      return this.noTrade("model_not_configured", context, createdAt, selected.id, this.timingMetadata(createdAt, selected));
    }

    const elapsedSeconds = Math.max(0, (createdAt.getTime() - selected.startsAt.getTime()) / 1000);
    if (elapsedSeconds < this.options.minElapsedSeconds) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, {
        ...this.timingMetadata(createdAt, selected),
        elapsedSeconds: round(elapsedSeconds),
        thresholds: this.thresholdMetadata()
      });
    }
    if (selected.timeRemainingSeconds < this.options.minSecondsToClose) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, {
        ...this.timingMetadata(createdAt, selected),
        elapsedSeconds: round(elapsedSeconds),
        thresholds: this.thresholdMetadata()
      });
    }

    const request = buildModelInferenceRequest({
      requestId: `${context.runMode}-${selected.id}-${createdAt.getTime()}`,
      capturedAt: createdAt,
      runMode: context.runMode,
      selectedMarket: selected,
      pricing: context.pricing,
      macro: context.macro,
      candle: context.candle
    });
    if (!request) {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, this.timingMetadata(createdAt, selected));
    }

    const result = await this.client.infer(request);
    if (result.status !== "ok") {
      return this.noTrade("model_unavailable", context, createdAt, selected.id, {
        ...this.timingMetadata(createdAt, selected),
        modelUnavailableReason: result.reason,
        thresholds: this.thresholdMetadata()
      });
    }

    const best = bestEligibleCandidate(result.candidates, context.pricing, this.options);
    const inferenceContext = modelInferenceMetadata(request, result.candidates, result.modelVersion, best?.direction);
    if (!best) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, {
        ...this.timingMetadata(createdAt, selected),
        modelVersion: result.modelVersion,
        modelInference: inferenceContext,
        thresholds: this.thresholdMetadata()
      });
    }

    const currentAskPrice = askForDirection(context.pricing, best.direction);
    const metadata = this.candidateMetadata(best, currentAskPrice, result.modelVersion, inferenceContext);
    if (currentAskPrice === undefined) {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, metadata);
    }
    if (best.entryAsk !== undefined && currentAskPrice > best.entryAsk + this.options.maxPriceChase) {
      return this.noTrade("price_above_threshold", context, createdAt, selected.id, metadata);
    }

    return {
      action: "enter",
      marketId: selected.id,
      direction: best.direction,
      notionalUsd: Math.max(PREDICT_FUN_MIN_ORDER_NOTIONAL_USD, this.options.notionalUsd),
      runMode: context.runMode,
      createdAt,
      metadata
    };
  }

  private noTrade(
    reason: DecisionReason,
    context: Pick<StrategyContext, "runMode">,
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
      metadata: { strategyName: this.name, ...metadata }
    };
  }

  private timingMetadata(createdAt: Date, selected: NonNullable<StrategyContext["selectedMarket"]>): StrategyDecisionMetadata {
    return {
      strategyName: this.name,
      marketStartsAt: selected.startsAt.toISOString(),
      marketStartDeltaSeconds: round((createdAt.getTime() - selected.startsAt.getTime()) / 1000),
      secondsSinceMarketStart: Math.max(0, round((createdAt.getTime() - selected.startsAt.getTime()) / 1000)),
      elapsedSeconds: Math.max(0, round((createdAt.getTime() - selected.startsAt.getTime()) / 1000))
    };
  }

  private candidateMetadata(
    candidate: ModelInferenceCandidateOutput,
    currentAskPrice: number | undefined,
    modelVersion: string | undefined,
    modelInference: Readonly<Record<string, unknown>>
  ): StrategyDecisionMetadata {
    return {
      strategyName: this.name,
      triggerName: "model_ev_direction_ensemble",
      modelVersion,
      predictedProfitProbability: candidate.profitabilityProbability,
      evEdge: candidate.predictedEv,
      directionProbability: candidate.directionProbability,
      directionEdge: candidate.directionEdge,
      rawAskPrice: candidate.entryAsk,
      currentAskPrice,
      modelInference,
      thresholds: this.thresholdMetadata()
    };
  }

  private thresholdMetadata(): Readonly<Record<string, string | number | boolean | null>> {
    return {
      probabilityThreshold: this.options.probabilityThreshold,
      maxEntryPrice: this.options.maxEntryPrice,
      minEvEdge: this.options.minEvEdge,
      directionMinEdge: this.options.directionMinEdge,
      maxPriceChase: this.options.maxPriceChase,
      minElapsedSeconds: this.options.minElapsedSeconds,
      minSecondsToClose: this.options.minSecondsToClose
    };
  }
}

function modelInferenceMetadata(
  request: ModelInferenceRequest,
  candidates: readonly ModelInferenceCandidateOutput[],
  modelVersion: string | undefined,
  selectedCandidateDirection: MarketDirection | undefined
): Readonly<Record<string, unknown>> {
  return {
    requestId: request.requestId,
    capturedAt: request.capturedAt,
    modelVersion,
    market: request.market,
    pricing: request.pricing,
    selectedCandidateDirection,
    candidates: candidates.map((candidate) => ({ ...candidate })),
    features: request.features.featureState ?? {},
    latestCandle: request.features.latestCandle
  };
}

function bestEligibleCandidate(
  candidates: readonly ModelInferenceCandidateOutput[],
  pricing: MarketPricing,
  options: Required<ModelStrategyOptions>
): ModelInferenceCandidateOutput | undefined {
  return candidates
    .filter((candidate) => {
      const currentAsk = askForDirection(pricing, candidate.direction);
      return (
        currentAsk !== undefined &&
        (candidate.profitabilityProbability ?? Number.NEGATIVE_INFINITY) >= options.probabilityThreshold &&
        currentAsk <= options.maxEntryPrice &&
        (candidate.predictedEv ?? Number.NEGATIVE_INFINITY) >= options.minEvEdge &&
        (candidate.directionEdge ?? Number.NEGATIVE_INFINITY) >= options.directionMinEdge
      );
    })
    .sort((left, right) => (right.predictedEv ?? Number.NEGATIVE_INFINITY) - (left.predictedEv ?? Number.NEGATIVE_INFINITY))[0];
}

function askForDirection(pricing: MarketPricing, direction: MarketDirection): number | undefined {
  return direction === "UP" ? pricing.up.bestAsk : pricing.down.bestAsk;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
