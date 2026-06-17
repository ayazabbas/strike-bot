import { describe, expect, it } from "vitest";
import { RestCmcAdapter } from "../src/adapters/CmcAdapter.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("RestCmcAdapter", () => {
  it("returns a stubbed macro snapshot when no CMC key is configured", async () => {
    const adapter = new RestCmcAdapter({ cmcApiKey: undefined });

    await expect(adapter.getMacroSnapshot()).resolves.toMatchObject({
      source: "coinmarketcap",
      stubbed: true
    });
  });

  it("fetches CMC BTC/ETH/BNB macro quotes without exposing the key", async () => {
    const calls: Array<{ url: string; headers: RequestInit["headers"] | undefined }> = [];
    const adapter = new RestCmcAdapter({ cmcApiKey: "secret-cmc-key" }, async (input, init) => {
      calls.push({ url: input.toString(), headers: init?.headers });
      return jsonResponse({
        data: {
          BTC: { quote: { USD: { price: 65000, percent_change_24h: 1.2, percent_change_7d: 4.5, volume_change_24h: 7 } } },
          ETH: { quote: { USD: { price: 3500, percent_change_24h: -0.4, percent_change_7d: 2.1, volume_change_24h: -3 } } },
          BNB: { quote: { USD: { price: 640, percent_change_24h: 0.8, percent_change_7d: 3.0, volume_change_24h: 5 } } }
        }
      });
    });

    const snapshot = await adapter.getMacroSnapshot();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v2/cryptocurrency/quotes/latest");
    expect(calls[0].url).toContain("symbol=BTC%2CETH%2CBNB");
    expect(calls[0].headers).toMatchObject({ "X-CMC_PRO_API_KEY": "secret-cmc-key" });
    expect(snapshot).toMatchObject({
      source: "coinmarketcap",
      stubbed: false,
      btcUsd: 65000,
      btc24hChangePct: 1.2,
      btc7dChangePct: 4.5,
      ethUsd: 3500,
      bnbUsd: 640,
      bnb24hChangePct: 0.8
    });
  });
});
