import type { RunMode } from "../config.js";

export type AssetSymbol = "BTC";
export type MarketDirection = "UP" | "DOWN";
export type SettlementWinningDirection = MarketDirection | "TIE" | null;
export type DecisionAction = "no_trade" | "enter";
export type DecisionReason =
  | "inspect_mode"
  | "strategy_not_configured"
  | "market_not_supported"
  | "market_not_selected"
  | "market_not_started"
  | "candle_unavailable"
  | "candle_market_mismatch"
  | "signal_not_triggered"
  | "model_unavailable"
  | "model_not_configured"
  | "pricing_unavailable"
  | "price_above_threshold"
  | "duplicate_market_attempt"
  | "risk_rejected"
  | "live_not_approved"
  | "twak_not_ready";

export interface PredictFunMarket {
  readonly id: string;
  readonly venue: "predict.fun";
  readonly asset: string;
  readonly intervalMinutes: number;
  readonly directions: readonly MarketDirection[];
  readonly outcomeOnChainIds?: Partial<Record<MarketDirection, string>>;
  readonly feeRateBps?: number;
  readonly isNegRisk?: boolean;
  readonly isYieldBearing?: boolean;
  readonly tradingStatus?: string;
  readonly categorySlug?: string;
  readonly startsAt: Date;
  readonly closesAt: Date;
  readonly resolvesAt: Date;
  readonly liquidityUsd?: number;
  readonly status: "open" | "closed" | "resolving" | "settled";
}

export interface BtcFiveMinuteMarket extends PredictFunMarket {
  readonly asset: AssetSymbol;
  readonly intervalMinutes: 5;
  readonly directions: readonly ["UP", "DOWN"];
}

export interface SelectedBtcFiveMinuteMarket {
  readonly id: string;
  readonly categorySlug?: string;
  readonly startsAt: Date;
  readonly closesAt: Date;
  readonly timeRemainingSeconds: number;
  readonly market: BtcFiveMinuteMarket;
}

export interface MarketSidePricing {
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly impliedProbability?: number;
}

export interface MarketPricing {
  readonly marketId: string;
  readonly capturedAt: Date;
  readonly source: "predict.fun";
  readonly status: "available" | "unknown";
  readonly up: MarketSidePricing;
  readonly down: MarketSidePricing;
  readonly spread?: number;
}

export interface MarketSettlement {
  readonly marketId: string;
  readonly capturedAt: Date;
  readonly source: "predict.fun";
  readonly status: "resolved" | "unresolved" | "unknown";
  readonly winningDirection: SettlementWinningDirection;
}

export interface MarketSnapshot {
  readonly capturedAt: Date;
  readonly markets: readonly PredictFunMarket[];
}

export interface PredictFunPosition {
  readonly walletAddress: string;
  readonly marketId?: string;
  readonly conditionId?: string;
  readonly indexSet?: string;
  readonly token?: string;
  readonly outcome?: string;
  readonly direction?: MarketDirection;
  readonly amount: string;
  readonly amountDisplay?: number;
  readonly isNegRisk?: boolean;
  readonly isYieldBearing?: boolean;
  readonly status?: string;
  readonly redeemable?: boolean;
  readonly mergeable?: boolean;
  readonly capturedAt: Date;
  readonly source: "predict.fun";
  readonly raw?: Record<string, unknown>;
}

export interface PredictFunPositionsSnapshot {
  readonly walletAddress: string;
  readonly capturedAt: Date;
  readonly source: "predict.fun";
  readonly status: "available" | "unavailable";
  readonly reason?: string;
  readonly apiError?: string;
  readonly positions: readonly PredictFunPosition[];
}

export type PredictFunRedemptionAction = "redeem";
export type PredictFunRedemptionSkipReason =
  | "non_redeemable"
  | "missing_condition_id"
  | "missing_index_set"
  | "missing_amount"
  | "missing_is_neg_risk"
  | "missing_is_yield_bearing"
  | "max_actions_exceeded";

export interface PredictFunRedemptionSdkParams {
  readonly conditionId: string;
  readonly indexSet: string;
  readonly isNegRisk: boolean;
  readonly isYieldBearing: boolean;
  readonly amount?: string;
}

export interface PredictFunRedemptionIntent {
  readonly action: PredictFunRedemptionAction;
  readonly marketId?: string;
  readonly conditionId: string;
  readonly indexSet: string;
  readonly amount?: string;
  readonly amountRaw: string;
  readonly direction?: MarketDirection;
  readonly outcome?: string;
  readonly status?: string;
  readonly isNegRisk: boolean;
  readonly isYieldBearing: boolean;
  readonly sdkParams: PredictFunRedemptionSdkParams;
}

export interface PredictFunRedemptionSkippedPosition {
  readonly reason: PredictFunRedemptionSkipReason;
  readonly marketId?: string;
  readonly conditionId?: string;
  readonly indexSet?: string;
  readonly amountRaw?: string;
  readonly direction?: MarketDirection;
  readonly outcome?: string;
  readonly status?: string;
  readonly redeemable?: boolean;
}

export interface PredictFunRedemptionPlan {
  readonly mode: "dry_run";
  readonly dryRun: true;
  readonly capturedAt: Date;
  readonly sourceCapturedAt: Date;
  readonly walletAddress: string;
  readonly intents: readonly PredictFunRedemptionIntent[];
  readonly skipped: readonly PredictFunRedemptionSkippedPosition[];
  readonly safety: {
    readonly signing: false;
    readonly broadcasting: false;
  };
}

export interface RedactedPredictFunRedemptionTxResult {
  readonly intentIndex: number;
  readonly conditionId: string;
  readonly indexSet: string;
  readonly txHash?: string;
  readonly status?: string;
}

export interface PredictFunRedemptionExecutionResult {
  readonly mode: "dry_run" | "live";
  readonly dryRun: boolean;
  readonly status: "skipped" | "prepared_not_broadcast" | "broadcast" | "failed";
  readonly reason?: string;
  readonly intentsCount: number;
  readonly safety: {
    readonly signing: boolean;
    readonly broadcasting: boolean;
  };
  readonly plan?: PredictFunRedemptionPlan;
  readonly txResults?: readonly RedactedPredictFunRedemptionTxResult[];
}

export interface MacroSnapshot {
  readonly capturedAt: Date;
  readonly source: "coinmarketcap";
  readonly btcUsd?: number;
  readonly btc24hChangePct?: number;
  readonly btc7dChangePct?: number;
  readonly btcVolumeChange24hPct?: number;
  readonly ethUsd?: number;
  readonly eth24hChangePct?: number;
  readonly eth7dChangePct?: number;
  readonly bnbUsd?: number;
  readonly bnb24hChangePct?: number;
  readonly bnb7dChangePct?: number;
  readonly stubbed: boolean;
  readonly error?: string;
}

export interface BtcCandleMetadata {
  readonly capturedAt: Date;
  readonly source: "pyth-pro";
  readonly symbol: AssetSymbol;
  readonly intervalMinutes: number;
  readonly latestCandleOpenTime?: Date;
  readonly latestCandle?: {
    readonly openTime: Date;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume?: number;
  };
  readonly recentCandles?: readonly {
    readonly openTime: Date;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume?: number;
  }[];
  readonly stubbed: boolean;
}

export interface StrategyDecisionMetadata {
  readonly strategyName?: string;
  readonly triggerName?: string;
  readonly sourceCapturedAt?: string;
  readonly signalAgeSeconds?: number;
  readonly predictedProfitProbability?: number;
  readonly evEdge?: number;
  readonly directionEdge?: number;
  readonly directionProbability?: number;
  readonly rawAskPrice?: number;
  readonly currentAskPrice?: number;
  readonly signalTiming?: Readonly<Record<string, string | number | boolean | null>>;
  readonly thresholds?: Readonly<Record<string, string | number | boolean | null>>;
  readonly modelVersion?: string;
  readonly modelUnavailableReason?: string;
  readonly modelInference?: Readonly<Record<string, unknown>>;
  readonly fairThreshold?: number;
  readonly maxAcceptableAsk?: number;
  readonly askPrice?: number;
  readonly edge?: number;
  readonly edgeScale?: string;
  readonly minRequiredEdge?: number;
  readonly elapsedSeconds?: number;
  readonly elapsedMinutes?: number;
  readonly partialReturnBps?: number;
  readonly closeLocation?: number;
  readonly marketStartsAt?: string;
  readonly candleOpenTime?: string;
  readonly candleStartDeltaSeconds?: number;
  readonly candleStartToleranceSeconds?: number;
  readonly marketStartDeltaSeconds?: number;
  readonly secondsSinceMarketStart?: number;
}

export interface NoTradeDecision {
  readonly action: "no_trade";
  readonly reason: DecisionReason;
  readonly marketId?: string;
  readonly runMode: RunMode;
  readonly createdAt: Date;
  readonly metadata?: StrategyDecisionMetadata;
}

export interface EnterDecision {
  readonly action: "enter";
  readonly marketId: string;
  readonly direction: MarketDirection;
  readonly notionalUsd: number;
  readonly runMode: RunMode;
  readonly createdAt: Date;
  readonly metadata?: StrategyDecisionMetadata;
}

export type StrategyDecision = NoTradeDecision | EnterDecision;

export interface RedactedPredictFunOrderDetails {
  readonly marketId: string;
  readonly direction: MarketDirection;
  readonly tokenId: string;
  readonly hash: string;
  readonly pricePerShare: string;
  readonly pricePerShareWei: string;
  readonly makerAmount: string;
  readonly takerAmount: string;
  readonly feeRateBps: number;
  readonly strategy: "LIMIT";
  readonly isPostOnly: false;
  readonly selfTradePrevention: "CANCEL_MAKER";
  readonly apiStatus?: number;
  readonly apiError?: string;
}

export interface ExecutionResult {
  readonly mode: RunMode;
  readonly broadcast: boolean;
  readonly status: "skipped" | "paper_recorded" | "prepared_not_broadcast" | "broadcast";
  readonly reason?: DecisionReason | "no_trade" | string;
  readonly decision: StrategyDecision;
  readonly details?: RedactedPredictFunOrderDetails;
}
