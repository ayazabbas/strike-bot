import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PredictFunAdapter } from "../adapters/PredictFunAdapter.js";
import type { RunMode } from "../config.js";
import type {
  BtcCandleMetadata,
  ExecutionResult,
  MarketPricing,
  MarketSettlement,
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

export interface PaperSettlementEnrichmentResult {
  readonly path: string;
  readonly scannedRows: number;
  readonly eligibleRows: number;
  readonly updatedRows: number;
}

export class JsonlPaperJournal implements PaperJournal {
  constructor(private readonly path: string) {}

  async append(context: PaperJournalContext): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(buildPaperTradeRecord(context))}\n`, "utf8");
  }

  async enrichSettlements(predictFun: PredictFunAdapter): Promise<PaperSettlementEnrichmentResult> {
    return enrichPaperJournalSettlements(this.path, predictFun);
  }
}

type JsonRecord = Record<string, unknown>;

export async function enrichPaperJournalSettlements(
  path: string,
  predictFun: PredictFunAdapter
): Promise<PaperSettlementEnrichmentResult> {
  const content = await readJournalIfPresent(path);
  if (content === undefined) {
    return { path, scannedRows: 0, eligibleRows: 0, updatedRows: 0 };
  }

  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }

  const settlementByMarketId = new Map<string, MarketSettlement>();
  let scannedRows = 0;
  let eligibleRows = 0;
  let updatedRows = 0;
  const rewrittenLines: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      rewrittenLines.push(line);
      continue;
    }

    scannedRows += 1;
    const row = parseJsonRecord(line);
    if (!row) {
      rewrittenLines.push(line);
      continue;
    }

    const marketId = settlementMarketId(row);
    if (!marketId || !isSettlementEligible(row)) {
      rewrittenLines.push(line);
      continue;
    }

    eligibleRows += 1;
    const officialSettlement = await cachedSettlement(marketId, settlementByMarketId, predictFun);
    if (officialSettlement.status !== "resolved") {
      rewrittenLines.push(line);
      continue;
    }

    rewrittenLines.push(JSON.stringify({ ...row, settlement: enrichedSettlement(row, officialSettlement) }));
    updatedRows += 1;
  }

  if (updatedRows > 0) {
    const nextContent = `${rewrittenLines.join("\n")}${hasTrailingNewline ? "\n" : ""}`;
    await writeFileAtomic(path, nextContent);
  }

  return { path, scannedRows, eligibleRows, updatedRows };
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
    closeLocation: metadata?.closeLocation ?? null,
    marketStartsAt: metadata?.marketStartsAt ?? null,
    candleOpenTime: metadata?.candleOpenTime ?? null,
    candleStartDeltaSeconds: metadata?.candleStartDeltaSeconds ?? null,
    candleStartToleranceSeconds: metadata?.candleStartToleranceSeconds ?? null,
    marketStartDeltaSeconds: metadata?.marketStartDeltaSeconds ?? null,
    secondsSinceMarketStart: metadata?.secondsSinceMarketStart ?? null
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

async function readJournalIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, path);
}

function parseJsonRecord(line: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSettlementEligible(row: JsonRecord): boolean {
  const decision = recordValue(row["decision"]);
  if (decision?.["action"] !== "enter") {
    return false;
  }

  const settlement = recordValue(row["settlement"]);
  const status = typeof settlement?.["status"] === "string" ? settlement["status"] : undefined;
  return status === undefined || status === "unknown" || status === "unresolved";
}

function settlementMarketId(row: JsonRecord): string | undefined {
  const decision = recordValue(row["decision"]);
  const decisionMarketId = stringValue(decision?.["marketId"]);
  if (decisionMarketId) {
    return decisionMarketId;
  }

  const market = recordValue(row["market"]);
  return stringValue(market?.["id"]);
}

async function cachedSettlement(
  marketId: string,
  cache: Map<string, MarketSettlement>,
  predictFun: PredictFunAdapter
): Promise<MarketSettlement> {
  const cached = cache.get(marketId);
  if (cached) {
    return cached;
  }
  const settlement = await predictFun.getMarketSettlement(marketId);
  cache.set(marketId, settlement);
  return settlement;
}

function enrichedSettlement(row: JsonRecord, officialSettlement: MarketSettlement) {
  const economics = settlementEconomics(row, officialSettlement);
  return {
    status: officialSettlement.status,
    checkedAt: officialSettlement.capturedAt.toISOString(),
    resolvedAt: resolvedAt(row, officialSettlement),
    winningDirection: officialSettlement.winningDirection,
    payoutUsd: economics.payoutUsd,
    pnlUsd: economics.pnlUsd
  };
}

function settlementEconomics(row: JsonRecord, officialSettlement: MarketSettlement) {
  const direction = selectedDirection(row);
  const notionalUsd = selectedNotional(row);
  const ask = selectedAsk(row, direction);
  if (!direction || notionalUsd === undefined || ask === undefined || ask <= 0 || officialSettlement.winningDirection === null) {
    return { payoutUsd: null, pnlUsd: null };
  }
  if (officialSettlement.winningDirection === "TIE") {
    return { payoutUsd: round(notionalUsd), pnlUsd: 0 };
  }

  const payoutUsd = officialSettlement.winningDirection === direction ? round(notionalUsd / ask) : 0;
  return {
    payoutUsd,
    pnlUsd: round(payoutUsd - notionalUsd)
  };
}

function selectedDirection(row: JsonRecord): "UP" | "DOWN" | undefined {
  const fill = recordValue(recordValue(row["execution"])?.["fill"]);
  const fillDirection = stringValue(fill?.["direction"]);
  if (fillDirection === "UP" || fillDirection === "DOWN") {
    return fillDirection;
  }

  const decisionDirection = stringValue(recordValue(row["decision"])?.["direction"]);
  return decisionDirection === "UP" || decisionDirection === "DOWN" ? decisionDirection : undefined;
}

function selectedNotional(row: JsonRecord): number | undefined {
  const fill = recordValue(recordValue(row["execution"])?.["fill"]);
  return numberValue(fill?.["notionalUsd"]) ?? numberValue(recordValue(row["decision"])?.["notionalUsd"]);
}

function selectedAsk(row: JsonRecord, direction: "UP" | "DOWN" | undefined): number | undefined {
  const fill = recordValue(recordValue(row["execution"])?.["fill"]);
  const fillPrice = numberValue(fill?.["price"]);
  if (fillPrice !== undefined) {
    return fillPrice;
  }
  if (!direction) {
    return undefined;
  }

  const pricing = recordValue(row["pricing"]);
  const side = recordValue(pricing?.[direction === "UP" ? "up" : "down"]);
  return numberValue(side?.["ask"]);
}

function resolvedAt(row: JsonRecord, officialSettlement: MarketSettlement): string {
  const market = recordValue(row["market"]);
  return stringValue(market?.["resolvesAt"]) ?? officialSettlement.capturedAt.toISOString();
}

function recordValue(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
