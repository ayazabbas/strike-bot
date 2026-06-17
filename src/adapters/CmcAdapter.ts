import type { AppConfig } from "../config.js";
import type { MacroSnapshot } from "../domain/types.js";

export interface CmcAdapter {
  getMacroSnapshot(): Promise<MacroSnapshot>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export class RestCmcAdapter implements CmcAdapter {
  constructor(
    private readonly config: Pick<AppConfig, "cmcApiKey">,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://pro-api.coinmarketcap.com"
  ) {}

  async getMacroSnapshot(): Promise<MacroSnapshot> {
    const capturedAt = new Date();
    if (!this.config.cmcApiKey) {
      return stubbedMacroSnapshot(capturedAt);
    }

    try {
      const payload = await this.fetchJson("/v2/cryptocurrency/quotes/latest", { symbol: "BTC,ETH,BNB", convert: "USD" });
      const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
      const btc = quoteUsd(data.BTC);
      const eth = quoteUsd(data.ETH);
      const bnb = quoteUsd(data.BNB);
      return {
        capturedAt,
        source: "coinmarketcap",
        stubbed: false,
        btcUsd: numberField(btc, "price"),
        btc24hChangePct: numberField(btc, "percent_change_24h"),
        btc7dChangePct: numberField(btc, "percent_change_7d"),
        btcVolumeChange24hPct: numberField(btc, "volume_change_24h"),
        ethUsd: numberField(eth, "price"),
        eth24hChangePct: numberField(eth, "percent_change_24h"),
        eth7dChangePct: numberField(eth, "percent_change_7d"),
        bnbUsd: numberField(bnb, "price"),
        bnb24hChangePct: numberField(bnb, "percent_change_24h"),
        bnb7dChangePct: numberField(bnb, "percent_change_7d")
      };
    } catch {
      return { ...stubbedMacroSnapshot(capturedAt), error: "cmc_fetch_failed" };
    }
  }

  private async fetchJson(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-CMC_PRO_API_KEY": this.config.cmcApiKey ?? ""
      }
    });
    if (!response.ok) {
      throw new Error(`CMC request failed: ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  }
}

export class StubCmcAdapter implements CmcAdapter {
  async getMacroSnapshot(): Promise<MacroSnapshot> {
    return stubbedMacroSnapshot(new Date());
  }
}

function stubbedMacroSnapshot(capturedAt: Date): MacroSnapshot {
  return {
    capturedAt,
    source: "coinmarketcap",
    stubbed: true
  };
}

function quoteUsd(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value) || !isRecord(value.quote) || !isRecord(value.quote.USD)) {
    return undefined;
  }
  return value.quote.USD;
}

function numberField(record: UnknownRecord | undefined, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
