import type { AppConfig } from "../config.js";
import type { CmcAgentHubSnapshot, MacroSnapshot } from "../domain/types.js";
import type { CmcAdapter } from "./CmcAdapter.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export interface CmcAgentHubAdapter {
  getSnapshot(): Promise<CmcAgentHubSnapshot>;
}

export class RestCmcAgentHubAdapter implements CmcAgentHubAdapter {
  private cached?: CmcAgentHubSnapshot;

  constructor(
    private readonly config: Pick<AppConfig, "cmcAgentHubEnabled" | "cmcMcpApiKey" | "cmcMcpUrl">,
    private readonly fallback: CmcAdapter,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async getSnapshot(): Promise<CmcAgentHubSnapshot> {
    const reasons: string[] = [];

    if (!this.config.cmcAgentHubEnabled) {
      reasons.push("cmc_agent_hub_disabled");
      return this.fallbackSnapshot("unavailable", reasons);
    }
    if (!this.config.cmcMcpApiKey) {
      reasons.push("cmc_mcp_api_key_missing");
      return this.fallbackSnapshot("unavailable", reasons);
    }

    try {
      const [quotes, global, technical, derivatives, narratives, macroEvents] = await Promise.allSettled([
        this.callTool("get_crypto_quotes_latest", { symbol: "BTC", convert: "USD" }),
        this.callTool("get_global_metrics_latest", {}),
        this.callTool("get_crypto_technical_analysis", { symbol: "BTC" }),
        this.callTool("get_global_crypto_derivatives_metrics", {}),
        this.callTool("trending_crypto_narratives", {}),
        this.callTool("get_upcoming_macro_events", {})
      ]);
      const snapshot = this.normalize({
        quotes: settledValue(quotes, reasons, "quotes_unavailable"),
        global: settledValue(global, reasons, "global_metrics_unavailable"),
        technical: settledValue(technical, reasons, "technical_analysis_unavailable"),
        derivatives: settledValue(derivatives, reasons, "derivatives_unavailable"),
        narratives: settledValue(narratives, reasons, "narratives_unavailable"),
        macroEvents: settledValue(macroEvents, reasons, "macro_events_unavailable"),
        reasons
      });
      if (snapshot.status === "unavailable") {
        return this.fallbackSnapshot("unavailable", [...reasons, "cmc_agent_hub_all_tools_failed"]);
      }
      this.cached = snapshot;
      return snapshot;
    } catch {
      reasons.push("cmc_agent_hub_fetch_failed");
      if (this.cached) {
        return { ...this.cached, status: "partial", reasons: [...this.cached.reasons, "last_good_cached_snapshot"] };
      }
      return this.fallbackSnapshot("unavailable", reasons);
    }
  }

  private async callTool(name: string, args: UnknownRecord): Promise<unknown> {
    const response = await this.fetchImpl(this.config.cmcMcpUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-CMC-MCP-API-KEY": this.config.cmcMcpApiKey ?? ""
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${name}-${Date.now()}`,
        method: "tools/call",
        params: {
          name,
          arguments: args
        }
      })
    });
    if (!response.ok) {
      throw new Error(`CMC Agent Hub request failed: ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && payload.error) {
      throw new Error("CMC Agent Hub tool returned an error");
    }
    return unwrapMcpResult(payload);
  }

  private normalize(input: {
    readonly quotes?: unknown;
    readonly global?: unknown;
    readonly technical?: unknown;
    readonly derivatives?: unknown;
    readonly narratives?: unknown;
    readonly macroEvents?: unknown;
    readonly reasons: string[];
  }): CmcAgentHubSnapshot {
    const btcQuote = findFirstRecord(input.quotes, ["BTC", "bitcoin", "1"]);
    const quoteUsd = quoteUsdRecord(btcQuote) ?? btcQuote;
    const global = findFirstRecord(input.global, ["data", "global"]) ?? (isRecord(input.global) ? input.global : undefined);
    const technical = findFirstRecord(input.technical, ["data", "technical"]) ?? (isRecord(input.technical) ? input.technical : undefined);
    const derivatives = findFirstRecord(input.derivatives, ["data", "derivatives"]) ?? (isRecord(input.derivatives) ? input.derivatives : undefined);
    const narratives = arrayRecords(input.narratives)
      .map((item) => ({
        name: stringField(item, "name") ?? stringField(item, "title") ?? "unknown",
        performance24h: numberField(item, "performance24h") ?? numberField(item, "performance_24h"),
        volumeChange24h: numberField(item, "volumeChange24h") ?? numberField(item, "volume_change_24h")
      }))
      .slice(0, 5);
    const macroEvents = arrayRecords(input.macroEvents)
      .map((item) => ({
        title: stringField(item, "title") ?? stringField(item, "name") ?? "unknown",
        date: stringField(item, "date") ?? stringField(item, "time") ?? new Date().toISOString(),
        expectedImpact: stringField(item, "expectedImpact") ?? stringField(item, "expected_impact") ?? stringField(item, "impact")
      }))
      .slice(0, 5);

    const status = input.reasons.length === 0 ? "available" : input.reasons.length < 6 ? "partial" : "unavailable";
    return {
      capturedAt: new Date().toISOString(),
      btc: {
        id: Math.trunc(numberField(btcQuote, "id") ?? 1),
        priceUsd: numberField(quoteUsd, "price") ?? numberField(btcQuote, "priceUsd") ?? numberField(btcQuote, "price_usd"),
        percentChange1h: numberField(quoteUsd, "percent_change_1h") ?? numberField(btcQuote, "percentChange1h"),
        percentChange24h: numberField(quoteUsd, "percent_change_24h") ?? numberField(btcQuote, "percentChange24h"),
        percentChange7d: numberField(quoteUsd, "percent_change_7d") ?? numberField(btcQuote, "percentChange7d"),
        dominance: numberField(global, "btc_dominance") ?? numberField(global, "btcDominance"),
        rsi: numberField(technical, "rsi") ?? numberField(technical, "RSI"),
        macdSignal: stringField(technical, "macdSignal") ?? stringField(technical, "macd_signal") ?? stringField(technical, "macd"),
        emaTrend: stringField(technical, "emaTrend") ?? stringField(technical, "ema_trend") ?? stringField(technical, "trend")
      },
      global: {
        totalMarketCapChange24h: numberField(global, "total_market_cap_yesterday_percentage_change") ?? numberField(global, "totalMarketCapChange24h"),
        fearGreed: numberField(global, "fear_greed") ?? numberField(global, "fearGreed"),
        altcoinSeason: numberField(global, "altcoin_season") ?? numberField(global, "altcoinSeason"),
        btcDominance: numberField(global, "btc_dominance") ?? numberField(global, "btcDominance"),
        ethDominance: numberField(global, "eth_dominance") ?? numberField(global, "ethDominance")
      },
      derivatives: {
        fundingBias: stringField(derivatives, "fundingBias") ?? stringField(derivatives, "funding_bias"),
        openInterestTrend: stringField(derivatives, "openInterestTrend") ?? stringField(derivatives, "open_interest_trend"),
        liquidationSkew: stringField(derivatives, "liquidationSkew") ?? stringField(derivatives, "liquidation_skew")
      },
      narratives,
      macroEvents,
      source: "cmc-agent-hub",
      status,
      reasons: input.reasons
    };
  }

  private async fallbackSnapshot(status: CmcAgentHubSnapshot["status"], reasons: string[]): Promise<CmcAgentHubSnapshot> {
    const fallbackMacro = await this.fallback.getMacroSnapshot();
    return snapshotFromMacro(fallbackMacro, status, reasons);
  }
}

export class DisabledCmcAgentHubAdapter implements CmcAgentHubAdapter {
  constructor(private readonly fallback: CmcAdapter) {}

  async getSnapshot(): Promise<CmcAgentHubSnapshot> {
    const fallbackMacro = await this.fallback.getMacroSnapshot();
    return snapshotFromMacro(fallbackMacro, "unavailable", ["cmc_agent_hub_disabled"]);
  }
}

export function snapshotFromMacro(
  fallbackMacro: MacroSnapshot,
  status: CmcAgentHubSnapshot["status"],
  reasons: readonly string[]
): CmcAgentHubSnapshot {
  return {
    capturedAt: fallbackMacro.capturedAt.toISOString(),
    btc: {
      id: 1,
      priceUsd: fallbackMacro.btcUsd,
      percentChange24h: fallbackMacro.btc24hChangePct,
      percentChange7d: fallbackMacro.btc7dChangePct
    },
    global: {},
    derivatives: {},
    narratives: [],
    macroEvents: [],
    source: "cmc-agent-hub",
    status,
    reasons,
    fallbackMacro
  };
}

function settledValue(result: PromiseSettledResult<unknown>, reasons: string[], reason: string): unknown | undefined {
  if (result.status === "fulfilled") {
    return result.value;
  }
  reasons.push(reason);
  return undefined;
}

function unwrapMcpResult(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const result = payload.result;
  if (!isRecord(result)) {
    return result ?? payload;
  }
  const content = result.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      if (isRecord(item.json)) {
        return item.json;
      }
      if (typeof item.text === "string") {
        try {
          return JSON.parse(item.text) as unknown;
        } catch {
          return item.text;
        }
      }
    }
  }
  return result.structuredContent ?? result;
}

function findFirstRecord(value: unknown, keys: readonly string[]): UnknownRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const nested = value[key];
    if (isRecord(nested)) {
      return nested;
    }
  }
  if (isRecord(value.data)) {
    return findFirstRecord(value.data, keys) ?? value.data;
  }
  return value;
}

function arrayRecords(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    if (Array.isArray(value.data)) {
      return value.data.filter(isRecord);
    }
    if (Array.isArray(value.items)) {
      return value.items.filter(isRecord);
    }
  }
  return [];
}

function quoteUsdRecord(value: UnknownRecord | undefined): UnknownRecord | undefined {
  if (!isRecord(value?.quote) || !isRecord(value.quote.USD)) {
    return undefined;
  }
  return value.quote.USD;
}

function numberField(record: UnknownRecord | undefined, field: string): number | undefined {
  const value = record?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(record: UnknownRecord | undefined, field: string): string | undefined {
  const value = record?.[field];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
