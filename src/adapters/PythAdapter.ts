import type { AppConfig } from "../config.js";
import type { BtcCandleMetadata } from "../domain/types.js";

export interface PythAdapter {
  getBtcFiveMinuteCandleMetadata(): Promise<BtcCandleMetadata>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HistoryPythAdapter implements PythAdapter {
  constructor(
    private readonly config: Pick<
      AppConfig,
      "pythHistoryBaseUrl" | "pythHistoryChannel" | "pythHistorySymbol" | "pythHistoryLookbackMinutes" | "pythProApiKey"
    >,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date()
  ) {}

  async getBtcFiveMinuteCandleMetadata(): Promise<BtcCandleMetadata> {
    const capturedAt = this.now();

    try {
      const to = Math.floor(capturedAt.getTime() / 1000);
      const from = to - this.config.pythHistoryLookbackMinutes * 60;
      const url = new URL(`${trimSlashes(this.config.pythHistoryChannel)}/history`, withTrailingSlash(this.config.pythHistoryBaseUrl));
      url.searchParams.set("symbol", this.config.pythHistorySymbol);
      url.searchParams.set("from", String(from));
      url.searchParams.set("to", String(to));
      url.searchParams.set("resolution", "5");

      const headers: Record<string, string> = { accept: "application/json" };
      if (this.config.pythProApiKey) {
        headers["x-api-key"] = this.config.pythProApiKey;
      }

      const response = await this.fetchImpl(url, { method: "GET", headers });
      if (!response.ok) {
        return stubbedMetadata(capturedAt);
      }

      const payload = (await response.json()) as unknown;
      const latestCandle = normalizeLatestCandle(payload);
      if (!latestCandle) {
        return stubbedMetadata(capturedAt);
      }

      return {
        capturedAt,
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        latestCandleOpenTime: latestCandle.openTime,
        latestCandle,
        stubbed: false
      };
    } catch {
      return stubbedMetadata(capturedAt);
    }
  }
}

export class StubPythAdapter implements PythAdapter {
  async getBtcFiveMinuteCandleMetadata(): Promise<BtcCandleMetadata> {
    return stubbedMetadata(new Date());
  }
}

function stubbedMetadata(capturedAt: Date): BtcCandleMetadata {
  return {
    capturedAt,
    source: "pyth-pro",
    symbol: "BTC",
    intervalMinutes: 5,
    stubbed: true
  };
}

function normalizeLatestCandle(payload: unknown): BtcCandleMetadata["latestCandle"] | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const times = numberArray(payload.t);
  const opens = numberArray(payload.o);
  const highs = numberArray(payload.h);
  const lows = numberArray(payload.l);
  const closes = numberArray(payload.c);
  const volumes = numberArray(payload.v);
  const length = Math.min(times.length, opens.length, highs.length, lows.length, closes.length);

  for (let index = length - 1; index >= 0; index -= 1) {
    const openTime = epochToDate(times[index]);
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];
    if (openTime && [open, high, low, close].every((value) => Number.isFinite(value))) {
      return {
        openTime,
        open,
        high,
        low,
        close,
        volume: volumes[index]
      };
    }
  }

  return undefined;
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "number" ? item : typeof item === "string" ? Number(item) : Number.NaN))
    .filter((item) => Number.isFinite(item));
}

function epochToDate(value: number): Date | undefined {
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
