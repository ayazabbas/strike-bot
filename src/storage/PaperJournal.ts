import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunMode } from "../config.js";
import type {
  BtcCandleMetadata,
  ExecutionResult,
  MarketPricing,
  SelectedBtcFiveMinuteMarket,
  StrategyDecision,
  StrategyDecisionMetadata
} from "../domain/types.js";
import type { RiskCheckResult } from "../risk/RiskManager.js";
import type { RunRecord } from "./RunRepository.js";

export interface PaperJournalContext {
  readonly run: RunRecord;
  readonly mode: RunMode;
  readonly strategyName: string;
  readonly selectedMarket?: SelectedBtcFiveMinuteMarket;
  readonly pricing?: MarketPricing;
  readonly candle: BtcCandleMetadata;
  readonly strategyDecision?: StrategyDecision;
  readonly decision: StrategyDecision;
  readonly risk: RiskCheckResult;
  readonly execution: ExecutionResult;
  readonly safety: {
    readonly signing: boolean;
    readonly broadcasting: boolean;
  };
}

export interface PaperJournal {
  append(context: PaperJournalContext): Promise<void>;
}

export class JsonlPaperJournal implements PaperJournal {
  constructor(private readonly path: string) {}

  async append(context: PaperJournalContext): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(buildPaperTradeRecord(context))}\n`, "utf8");
  }
}

export function buildPaperTradeRecord(context: PaperJournalContext) {
  const decision = context.execution.decision;
  const metadata = normalizeMetadata(decision.metadata);
  const fillPrice = decision.action === "enter" ? askForDirection(context.pricing, decision.direction) : null;
  const notionalUsd = decision.action === "enter" ? decision.notionalUsd : null;

  return {
    schemaVersion: 1,
    runId: context.run.id,
    runStartedAt: context.run.startedAt.toISOString(),
    timestamp: decision.createdAt.toISOString(),
    mode: context.mode,
    strategy: metadata.strategyName ?? context.strategyName,
    market: normalizeMarket(context.selectedMarket),
    selectedOutcome: decision.action === "enter" ? { direction: decision.direction } : null,
    strategyDecision: normalizeDecision(context.strategyDecision ?? context.decision),
    decision: normalizeDecision(context.decision),
    pricing: normalizePricing(context.pricing),
    strategyMetadata: metadata,
    pythCandle: normalizeCandle(context.candle),
    risk: {
      approved: context.risk.approved,
      reasons: [...context.risk.reasons]
    },
    safety: context.safety,
    execution: {
      mode: context.execution.mode,
      status: context.execution.status,
      broadcast: context.execution.broadcast,
      simulated: context.mode === "paper",
      fill: {
        status: decision.action === "enter" && context.execution.status === "paper_recorded" ? "filled" : "skipped",
        filledAt: decision.action === "enter" && context.execution.status === "paper_recorded" ? decision.createdAt.toISOString() : null,
        direction: decision.action === "enter" ? decision.direction : null,
        price: fillPrice,
        notionalUsd,
        quantity: fillPrice && notionalUsd ? round(notionalUsd / fillPrice) : null
      },
      reason: context.execution.reason ?? null
    },
    settlement: {
      status: "unknown",
      checkedAt: null,
      resolvedAt: null,
      winningDirection: null,
      payoutUsd: null,
      pnlUsd: null
    }
  };
}

function normalizeMarket(selected: SelectedBtcFiveMinuteMarket | undefined) {
  return {
    id: selected?.id ?? null,
    slug: selected?.categorySlug ?? null,
    category: selected ? "btc-5m-up-down" : null,
    venue: selected?.market.venue ?? null,
    asset: selected?.market.asset ?? null,
    intervalMinutes: selected?.market.intervalMinutes ?? null,
    status: selected?.market.status ?? null,
    startsAt: selected?.startsAt.toISOString() ?? null,
    closesAt: selected?.closesAt.toISOString() ?? null,
    resolvesAt: selected?.market.resolvesAt.toISOString() ?? null,
    secondsRemaining: selected?.timeRemainingSeconds ?? null,
    liquidityUsd: selected?.market.liquidityUsd ?? null
  };
}

function normalizePricing(pricing: MarketPricing | undefined) {
  return {
    marketId: pricing?.marketId ?? null,
    capturedAt: pricing?.capturedAt.toISOString() ?? null,
    source: pricing?.source ?? null,
    status: pricing?.status ?? "unknown",
    up: normalizeSidePricing(pricing?.up),
    down: normalizeSidePricing(pricing?.down),
    spread: pricing?.spread ?? null
  };
}

function normalizeSidePricing(side: MarketPricing["up"] | undefined) {
  return {
    bid: side?.bestBid ?? null,
    ask: side?.bestAsk ?? null,
    implied: side?.impliedProbability ?? null
  };
}

function normalizeMetadata(metadata: StrategyDecisionMetadata | undefined) {
  return {
    strategyName: metadata?.strategyName ?? null,
    triggerName: metadata?.triggerName ?? null,
    fairThreshold: metadata?.fairThreshold ?? null,
    maxAcceptableAsk: metadata?.maxAcceptableAsk ?? null,
    askPrice: metadata?.askPrice ?? null,
    edge: metadata?.edge ?? null,
    elapsedMinutes: metadata?.elapsedMinutes ?? null,
    partialReturnBps: metadata?.partialReturnBps ?? null,
    closeLocation: metadata?.closeLocation ?? null
  };
}

function normalizeCandle(candle: BtcCandleMetadata) {
  return {
    capturedAt: candle.capturedAt.toISOString(),
    source: candle.source,
    symbol: candle.symbol,
    intervalMinutes: candle.intervalMinutes,
    timestamp: candle.latestCandle?.openTime.toISOString() ?? candle.latestCandleOpenTime?.toISOString() ?? null,
    open: candle.latestCandle?.open ?? null,
    high: candle.latestCandle?.high ?? null,
    low: candle.latestCandle?.low ?? null,
    close: candle.latestCandle?.close ?? null,
    volume: candle.latestCandle?.volume ?? null,
    stubbed: candle.stubbed
  };
}

function normalizeDecision(decision: StrategyDecision) {
  return {
    action: decision.action,
    reason: decision.action === "no_trade" ? decision.reason : null,
    marketId: decision.marketId ?? null,
    direction: decision.action === "enter" ? decision.direction : null,
    notionalUsd: decision.action === "enter" ? decision.notionalUsd : null,
    runMode: decision.runMode,
    createdAt: decision.createdAt.toISOString(),
    metadata: normalizeMetadata(decision.metadata)
  };
}

function askForDirection(pricing: MarketPricing | undefined, direction: "UP" | "DOWN"): number | null {
  const ask = direction === "UP" ? pricing?.up.bestAsk : pricing?.down.bestAsk;
  return ask ?? null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
