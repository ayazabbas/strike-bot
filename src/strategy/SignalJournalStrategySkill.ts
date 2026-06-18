import { readFileSync } from "node:fs";
import type {
  DecisionReason,
  MarketDirection,
  MarketPricing,
  StrategyDecision,
  StrategyDecisionMetadata
} from "../domain/types.js";
import type { StrategyContext, StrategySkill } from "./StrategySkill.js";

export interface SignalJournalStrategyOptions {
  readonly journalPath: string;
  readonly maxAgeSeconds: number;
  readonly notionalUsd: number;
}

interface SignalJournalRow {
  readonly captured_at?: unknown;
  readonly status?: unknown;
  readonly reason?: unknown;
  readonly signals?: unknown;
  readonly safety?: unknown;
}

interface JournalSignal {
  readonly action?: unknown;
  readonly marketId?: unknown;
  readonly direction?: unknown;
  readonly notionalUsd?: unknown;
  readonly strategy?: unknown;
  readonly predictedProfitProbability?: unknown;
  readonly evEdge?: unknown;
  readonly directionEdge?: unknown;
  readonly directionProbability?: unknown;
  readonly rawAskPrice?: unknown;
  readonly signalTiming?: unknown;
  readonly thresholds?: unknown;
}

const MAX_PRICE_CHASE = 0.03;

export class SignalJournalStrategySkill implements StrategySkill {
  readonly name = "SignalJournalStrategySkill";

  constructor(private readonly options: SignalJournalStrategyOptions, private readonly now: () => Date = () => new Date()) {}

  async decide(context: StrategyContext): Promise<StrategyDecision> {
    const createdAt = this.now();
    const selected = context.selectedMarket;
    if (!selected) {
      return this.noTrade("market_not_selected", context, createdAt);
    }

    const row = readLatestJournalRow(this.options.journalPath);
    if (!row) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id);
    }

    const capturedAt = parseDate(row.captured_at);
    const signalAgeSeconds = capturedAt ? round((createdAt.getTime() - capturedAt.getTime()) / 1000) : undefined;
    const baseMetadata =
      capturedAt && signalAgeSeconds !== undefined
        ? {
            sourceCapturedAt: capturedAt.toISOString(),
            signalAgeSeconds
          }
        : undefined;

    if (!capturedAt || signalAgeSeconds === undefined || !Number.isFinite(signalAgeSeconds) || signalAgeSeconds < 0) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }
    if (signalAgeSeconds > this.options.maxAgeSeconds) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }

    if (row.status !== "signals") {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }

    const safety = record(row.safety);
    if (safety?.signing !== false || safety?.broadcasting !== false) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }

    const signal = firstSignal(row.signals);
    const direction = parseDirection(signal?.direction);
    const rawAskPrice = finiteNumber(signal?.rawAskPrice);
    if (!signal || signal.action !== "enter" || !direction || rawAskPrice === undefined) {
      return this.noTrade("signal_not_triggered", context, createdAt, selected.id, baseMetadata);
    }

    if (signal.marketId !== selected.id || selected.market.status !== "open") {
      return this.noTrade("market_not_supported", context, createdAt, selected.id, signalMetadata(baseMetadata, signal));
    }

    if (!context.pricing || context.pricing.status !== "available") {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, signalMetadata(baseMetadata, signal));
    }

    const currentAskPrice = askForDirection(context.pricing, direction);
    const metadata = signalMetadata(baseMetadata, signal, currentAskPrice);
    if (currentAskPrice === undefined) {
      return this.noTrade("pricing_unavailable", context, createdAt, selected.id, metadata);
    }
    if (currentAskPrice > rawAskPrice + MAX_PRICE_CHASE) {
      return this.noTrade("price_above_threshold", context, createdAt, selected.id, metadata);
    }

    return {
      action: "enter",
      marketId: selected.id,
      direction,
      notionalUsd: Math.min(finiteNumber(signal.notionalUsd) ?? this.options.notionalUsd, this.options.notionalUsd),
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
      metadata: { strategyName: this.name, ...metadata }
    };
  }
}

function readLatestJournalRow(path: string): SignalJournalRow | undefined {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }

  const lines = contents.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      return record(parsed) as SignalJournalRow | undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function signalMetadata(
  baseMetadata: StrategyDecisionMetadata | undefined,
  signal: JournalSignal,
  currentAskPrice?: number
): StrategyDecisionMetadata {
  return {
    ...baseMetadata,
    strategyName: typeof signal.strategy === "string" ? signal.strategy : undefined,
    predictedProfitProbability: finiteNumber(signal.predictedProfitProbability),
    evEdge: finiteNumber(signal.evEdge),
    directionEdge: finiteNumber(signal.directionEdge),
    directionProbability: finiteNumber(signal.directionProbability),
    rawAskPrice: finiteNumber(signal.rawAskPrice),
    currentAskPrice,
    signalTiming: primitiveRecord(signal.signalTiming),
    thresholds: primitiveRecord(signal.thresholds)
  };
}

function firstSignal(value: unknown): JournalSignal | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return record(value[0]) as JournalSignal | undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseDirection(value: unknown): MarketDirection | undefined {
  return value === "UP" || value === "DOWN" ? value : undefined;
}

function askForDirection(pricing: MarketPricing, direction: MarketDirection): number | undefined {
  return direction === "UP" ? pricing.up.bestAsk : pricing.down.bestAsk;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function primitiveRecord(value: unknown): Readonly<Record<string, string | number | boolean | null>> | undefined {
  const input = record(value);
  if (!input) {
    return undefined;
  }
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, nestedValue] of Object.entries(input)) {
    if (
      nestedValue === null ||
      typeof nestedValue === "string" ||
      typeof nestedValue === "boolean" ||
      (typeof nestedValue === "number" && Number.isFinite(nestedValue))
    ) {
      output[key] = nestedValue;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
