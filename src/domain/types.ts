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
  | "pricing_unavailable"
  | "price_above_threshold"
  | "risk_rejected"
  | "live_not_approved"
  | "twak_not_ready";

export interface PredictFunMarket {
  readonly id: string;
  readonly venue: "predict.fun";
  readonly asset: string;
  readonly intervalMinutes: number;
  readonly directions: readonly MarketDirection[];
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

export interface MacroSnapshot {
  readonly capturedAt: Date;
  readonly source: "coinmarketcap";
  readonly btcUsd?: number;
  readonly stubbed: boolean;
}

export interface BtcCandleMetadata {
  readonly capturedAt: Date;
  readonly source: "pyth-pro";
  readonly symbol: AssetSymbol;
  readonly intervalMinutes: 5;
  readonly latestCandleOpenTime?: Date;
  readonly latestCandle?: {
    readonly openTime: Date;
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume?: number;
  };
  readonly stubbed: boolean;
}

export interface StrategyDecisionMetadata {
  readonly strategyName?: string;
  readonly triggerName?: string;
  readonly fairThreshold?: number;
  readonly maxAcceptableAsk?: number;
  readonly askPrice?: number;
  readonly edge?: number;
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

export interface ExecutionResult {
  readonly mode: RunMode;
  readonly broadcast: false;
  readonly status: "skipped" | "paper_recorded" | "prepared_not_broadcast";
  readonly reason?: DecisionReason | "no_trade";
  readonly decision: StrategyDecision;
}
