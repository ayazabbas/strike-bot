import type { AppConfig } from "../config.js";
import type { MarketDirection, MarketSnapshot, PredictFunMarket } from "../domain/types.js";

export interface PredictFunAdapter {
  listMarkets(): Promise<MarketSnapshot>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export class RestPredictFunAdapter implements PredictFunAdapter {
  constructor(
    private readonly config: Pick<AppConfig, "predictFunBaseUrl" | "predictFunApiKey">,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async listMarkets(): Promise<MarketSnapshot> {
    const capturedAt = new Date();

    if (!this.config.predictFunApiKey) {
      return { capturedAt, markets: [] };
    }

    try {
      const url = new URL("/v1/markets", this.config.predictFunBaseUrl);
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-api-key": this.config.predictFunApiKey
        }
      });

      if (!response.ok) {
        return { capturedAt, markets: [] };
      }

      const payload = (await response.json()) as unknown;
      return {
        capturedAt,
        markets: extractMarketItems(payload).flatMap((item) => mapPredictFunMarket(item, capturedAt))
      };
    } catch {
      return { capturedAt, markets: [] };
    }
  }
}

export class StubPredictFunAdapter implements PredictFunAdapter {
  async listMarkets(): Promise<MarketSnapshot> {
    return {
      capturedAt: new Date(),
      markets: []
    };
  }
}

export function makeStubPredictFunMarket(overrides: Partial<PredictFunMarket> = {}): PredictFunMarket {
  const now = new Date();
  return {
    id: "stub-btc-5m",
    venue: "predict.fun",
    asset: "BTC",
    intervalMinutes: 5,
    directions: ["UP", "DOWN"],
    startsAt: now,
    closesAt: new Date(now.getTime() + 5 * 60 * 1000),
    resolvesAt: new Date(now.getTime() + 6 * 60 * 1000),
    liquidityUsd: 0,
    status: "open",
    ...overrides
  };
}

function extractMarketItems(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["markets", "data", "items", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value)) {
      const nested = extractMarketItems(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function mapPredictFunMarket(item: UnknownRecord, capturedAt: Date): PredictFunMarket[] {
  const id = firstString(item, ["id", "marketId", "market_id", "slug", "address"]);
  if (!id) {
    return [];
  }

  const text = [firstString(item, ["title", "name", "question", "description"]), firstString(item, ["symbol", "asset", "underlying", "ticker"])]
    .filter(Boolean)
    .join(" ");
  const asset = normalizeAsset(firstString(item, ["asset", "baseAsset", "underlying", "symbol", "ticker"]), text);
  const directions = normalizeDirections(item, text);

  const startsAt = firstDate(item, ["startsAt", "startTime", "start_time", "openTime", "open_time", "startDate"], capturedAt);
  const explicitClosesAt = firstDateOptional(item, ["closesAt", "closeTime", "close_time", "endTime", "end_time", "expirationTime", "expiresAt"]);
  const intervalMinutes = normalizeIntervalMinutes(item, text, startsAt, explicitClosesAt);
  const closesAt = firstDate(
    item,
    ["closesAt", "closeTime", "close_time", "endTime", "end_time", "expirationTime", "expiresAt"],
    new Date(startsAt.getTime() + intervalMinutes * 60 * 1000)
  );
  const resolvesAt = firstDate(
    item,
    ["resolvesAt", "resolveTime", "resolve_time", "settlementTime", "settlesAt"],
    new Date(closesAt.getTime() + 60 * 1000)
  );

  return [
    {
      id,
      venue: "predict.fun",
      asset,
      intervalMinutes,
      directions,
      startsAt,
      closesAt,
      resolvesAt,
      liquidityUsd: firstNumber(item, ["liquidityUsd", "liquidity_usd", "liquidity", "volumeUsd", "volume_usd"]),
      status: normalizeStatus(firstString(item, ["status", "state"]))
    }
  ];
}

function normalizeAsset(value: string | undefined, text: string): string {
  const candidate = value?.toUpperCase();
  if (candidate?.includes("BTC") || candidate?.includes("BITCOIN")) {
    return "BTC";
  }
  if (/\b(BTC|BITCOIN|CRYPTO\.BTC\/USD)\b/i.test(text)) {
    return "BTC";
  }
  return candidate ?? "UNKNOWN";
}

function normalizeIntervalMinutes(item: UnknownRecord, text: string, startsAt: Date, closesAt: Date | undefined): number {
  const direct = firstNumber(item, ["intervalMinutes", "interval_minutes", "durationMinutes", "duration_minutes", "resolution"]);
  if (direct && direct > 0) {
    return direct;
  }

  const timeframe = firstString(item, ["interval", "timeframe", "duration", "resolution"]);
  const parsedTimeframe = timeframe ? parseIntervalText(timeframe) : undefined;
  if (parsedTimeframe) {
    return parsedTimeframe;
  }

  if (closesAt && closesAt.getTime() > startsAt.getTime()) {
    const diffMinutes = (closesAt.getTime() - startsAt.getTime()) / 60_000;
    if (Number.isInteger(diffMinutes) && diffMinutes > 0) {
      return diffMinutes;
    }
  }

  const parsedText = parseIntervalText(text);
  if (parsedText) {
    return parsedText;
  }

  return 0;
}

function parseIntervalText(value: string): number | undefined {
  if (/\b5\s*(?:m|min|mins|minute|minutes)\b/i.test(value) || /\b5-minute\b/i.test(value)) {
    return 5;
  }
  return undefined;
}

function normalizeDirections(item: UnknownRecord, text: string): readonly MarketDirection[] {
  const values = [
    ...arrayStrings(item["directions"]),
    ...arrayStrings(item["outcomes"]),
    ...arrayStrings(item["options"])
  ].join(" ");
  const candidate = `${values} ${text}`;
  const hasUp = /\b(up|higher|above)\b/i.test(candidate);
  const hasDown = /\b(down|lower|below)\b/i.test(candidate);
  return hasUp && hasDown ? ["UP", "DOWN"] : [];
}

function normalizeStatus(value: string | undefined): PredictFunMarket["status"] {
  const normalized = value?.toLowerCase();
  if (normalized === "closed" || normalized === "resolving" || normalized === "settled") {
    return normalized;
  }
  if (normalized === "resolved") {
    return "settled";
  }
  return "open";
}

function firstString(item: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(item: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function firstDate(item: UnknownRecord, keys: string[], fallback: Date): Date {
  return firstDateOptional(item, keys) ?? fallback;
}

function firstDateOptional(item: UnknownRecord, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = item[key];
    const date = parseDate(value);
    if (date) {
      return date;
    }
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item : isRecord(item) ? firstString(item, ["name", "label", "title"]) : undefined))
    .filter((item): item is string => Boolean(item));
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
