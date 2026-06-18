import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { inspectPositions } from "../src/app.js";
import { RestPredictFunPositionsAdapter } from "../src/adapters/PredictFunPositionsAdapter.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("RestPredictFunPositionsAdapter", () => {
  it("handles the verified empty data array success shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ cursor: null, data: [], success: true }));
    const adapter = new RestPredictFunPositionsAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    const snapshot = await adapter.getPositions();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "https://api.predict.fun/v1/positions/0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55"
    );
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      accept: "application/json",
      "x-api-key": "test-key"
    });
    expect(snapshot).toMatchObject({
      source: "predict.fun",
      status: "available",
      walletAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
      positions: []
    });
  });

  it("normalizes representative non-empty position payloads", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: {
          positions: [
            {
              amount: "1000000000000000000",
              averageBuyPriceUsd: "0.45",
              id: Buffer.from(JSON.stringify({ marketId: 472369, outcomeId: 99, indexSet: 2 })).toString("base64"),
              market: {
                id: 472369,
                conditionId: "0xcondition",
                isNegRisk: true,
                isYieldBearing: false,
                status: "RESOLVED"
              },
              outcome: {
                indexSet: 2,
                name: "Down",
                onChainId: "123",
                status: "WON"
              },
              apiKey: "should-not-leak"
            }
          ]
        }
      })
    );
    const adapter = new RestPredictFunPositionsAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    const snapshot = await adapter.getPositions();

    expect(snapshot.status).toBe("available");
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({
      walletAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
      marketId: "472369",
      conditionId: "0xcondition",
      indexSet: "2",
      token: "123",
      outcome: "Down",
      direction: "DOWN",
      amount: "1000000000000000000",
      amountDisplay: 1,
      isNegRisk: true,
      isYieldBearing: false,
      status: "WON",
      redeemable: true,
      source: "predict.fun"
    });
    expect(JSON.stringify(snapshot)).not.toContain("should-not-leak");
  });

  it("returns a safe unavailable snapshot without calling the network when the API key is missing", async () => {
    const fetchImpl = vi.fn();
    const adapter = new RestPredictFunPositionsAdapter(
      { ...loadConfig({}), predictFunApiKey: undefined },
      fetchImpl
    );

    await expect(adapter.getPositions()).resolves.toMatchObject({
      status: "unavailable",
      reason: "predict_fun_api_key_missing",
      positions: []
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable snapshot for non-2xx responses with redacted errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ error: "denied", apiKey: "secret-value" }, 403));
    const adapter = new RestPredictFunPositionsAdapter(loadConfig({ PREDICT_FUN_API_KEY: "test-key" }), fetchImpl);

    const snapshot = await adapter.getPositions();

    expect(snapshot).toMatchObject({
      status: "unavailable",
      reason: "predict_fun_positions_fetch_failed_403",
      positions: []
    });
    expect(snapshot.apiError).toContain("[redacted]");
    expect(snapshot.apiError).not.toContain("secret-value");
  });

  it("exposes the positions adapter through the app wrapper", async () => {
    const adapter = {
      async getPositions() {
        return {
          walletAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
          capturedAt: new Date(),
          source: "predict.fun" as const,
          status: "available" as const,
          positions: []
        };
      }
    };

    await expect(inspectPositions(loadConfig({}), adapter)).resolves.toMatchObject({
      status: "available",
      positions: []
    });
  });
});
