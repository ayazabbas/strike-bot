import { describe, expect, it } from "vitest";
import { RestCmcAgentHubAdapter } from "../src/adapters/CmcAgentHubAdapter.js";
import type { CmcAdapter } from "../src/adapters/CmcAdapter.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const fallback: CmcAdapter = {
  async getMacroSnapshot() {
    return {
      capturedAt: new Date("2026-06-18T00:00:00.000Z"),
      source: "coinmarketcap",
      stubbed: false,
      btcUsd: 65000,
      btc24hChangePct: 1.2,
      btc7dChangePct: 4.5
    };
  }
};

describe("RestCmcAgentHubAdapter", () => {
  it("uses fallback macro snapshot when Agent Hub is disabled", async () => {
    const adapter = new RestCmcAgentHubAdapter(
      { cmcAgentHubEnabled: false, cmcMcpApiKey: undefined, cmcMcpUrl: "https://mcp.coinmarketcap.com/mcp" },
      fallback
    );

    await expect(adapter.getSnapshot()).resolves.toMatchObject({
      source: "cmc-agent-hub",
      status: "unavailable",
      reasons: ["cmc_agent_hub_disabled"],
      btc: { id: 1, priceUsd: 65000, percentChange24h: 1.2 }
    });
  });

  it("calls MCP tools with header auth and normalizes available fields", async () => {
    const calls: Array<{ body: unknown; headers: RequestInit["headers"] | undefined }> = [];
    const adapter = new RestCmcAgentHubAdapter(
      { cmcAgentHubEnabled: true, cmcMcpApiKey: "secret-mcp-key", cmcMcpUrl: "https://mcp.coinmarketcap.com/mcp" },
      fallback,
      async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { params?: { name?: string } };
        calls.push({ body, headers: init?.headers });
        const name = body.params?.name;
        if (name === "get_crypto_quotes_latest") {
          return jsonResponse({ result: { content: [{ type: "json", json: { BTC: { id: 1, quote: { USD: { price: 70000, percent_change_24h: 2 } } } } }] } });
        }
        if (name === "get_global_metrics_latest") {
          return jsonResponse({ result: { content: [{ type: "json", json: { data: { btc_dominance: 58, fear_greed: 64 } } }] } });
        }
        if (name === "get_crypto_technical_analysis") {
          return jsonResponse({ result: { content: [{ type: "json", json: { data: { rsi: 61, macd_signal: "bullish", ema_trend: "up" } } }] } });
        }
        if (name === "get_global_crypto_derivatives_metrics") {
          return jsonResponse({ result: { content: [{ type: "json", json: { data: { funding_bias: "positive", open_interest_trend: "rising" } } }] } });
        }
        if (name === "trending_crypto_narratives") {
          return jsonResponse({ result: { content: [{ type: "json", json: { data: [{ name: "Bitcoin", performance_24h: 1.5 }] } }] } });
        }
        return jsonResponse({ result: { content: [{ type: "json", json: { data: [{ title: "FOMC", date: "2026-06-20", expected_impact: "high" }] } }] } });
      }
    );

    const snapshot = await adapter.getSnapshot();

    expect(calls).toHaveLength(6);
    expect(calls[0].headers).toMatchObject({ "X-CMC-MCP-API-KEY": "secret-mcp-key" });
    expect(snapshot).toMatchObject({
      status: "available",
      btc: { id: 1, priceUsd: 70000, percentChange24h: 2, dominance: 58, rsi: 61, macdSignal: "bullish", emaTrend: "up" },
      global: { btcDominance: 58, fearGreed: 64 },
      derivatives: { fundingBias: "positive", openInterestTrend: "rising" }
    });
    expect(snapshot.narratives).toEqual([{ name: "Bitcoin", performance24h: 1.5, volumeChange24h: undefined }]);
    expect(snapshot.macroEvents).toEqual([{ title: "FOMC", date: "2026-06-20", expectedImpact: "high" }]);
  });

  it("falls back to REST macro context when all MCP tools fail", async () => {
    const adapter = new RestCmcAgentHubAdapter(
      { cmcAgentHubEnabled: true, cmcMcpApiKey: "secret-mcp-key", cmcMcpUrl: "https://mcp.coinmarketcap.com/mcp" },
      fallback,
      async () => new Response("denied", { status: 503 })
    );

    const snapshot = await adapter.getSnapshot();

    expect(snapshot).toMatchObject({
      status: "unavailable",
      btc: { priceUsd: 65000, percentChange24h: 1.2 },
      fallbackMacro: { stubbed: false }
    });
    expect(snapshot.reasons).toContain("cmc_agent_hub_all_tools_failed");
  });
});
