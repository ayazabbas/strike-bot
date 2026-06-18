import { describe, expect, it, vi } from "vitest";
import { LocalPythonInferenceClient } from "../src/inference/LocalPythonInferenceClient.js";
import type { ModelInferenceRequest } from "../src/inference/types.js";

const request: ModelInferenceRequest = {
  requestId: "req-1",
  capturedAt: "2026-06-18T12:00:05.000Z",
  runMode: "paper",
  market: {
    id: "511762",
    startsAt: "2026-06-18T12:00:00.000Z",
    closesAt: "2026-06-18T12:05:00.000Z",
    timeRemainingSeconds: 295,
    status: "open"
  },
  pricing: {
    marketId: "511762",
    capturedAt: "2026-06-18T12:00:04.900Z",
    status: "available",
    up: { bestBid: 0.44, bestAsk: 0.47 },
    down: { bestBid: 0.49, bestAsk: 0.52 },
    spread: 0.03
  },
  features: {
    elapsedSeconds: 5,
    btcUsd: 104000,
    latestCandle: {
      openTime: "2026-06-18T12:00:00.000Z",
      open: 103900,
      high: 104100,
      low: 103850,
      close: 104000
    }
  },
  candidates: [
    { direction: "UP", entryAsk: 0.47, entryBid: 0.44 },
    { direction: "DOWN", entryAsk: 0.52, entryBid: 0.49 }
  ]
};

describe("LocalPythonInferenceClient", () => {
  it("posts TS-owned features and candidate params to the configured endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual(request);
      return new Response(
        JSON.stringify({
          status: "ok",
          capturedAt: "2026-06-18T12:00:05.100Z",
          modelVersion: "sklearn-ev-dir-20260618",
          candidates: [
            {
              direction: "UP",
              profitabilityProbability: 0.61,
              directionProbability: 0.7,
              predictedEv: 0.14,
              directionEdge: 0.23
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const client = new LocalPythonInferenceClient({ endpointUrl: "http://127.0.0.1:8765/infer" }, fetchMock as typeof fetch);

    const result = await client.infer(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/infer",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" }
      })
    );
    expect(result).toMatchObject({
      status: "ok",
      modelVersion: "sklearn-ev-dir-20260618",
      candidates: [{ direction: "UP", predictedEv: 0.14 }]
    });
  });

  it("returns unavailable instead of throwing when the local endpoint is down", async () => {
    const client = new LocalPythonInferenceClient(
      { endpointUrl: "http://127.0.0.1:8765/infer" },
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch
    );

    await expect(client.infer(request)).resolves.toMatchObject({
      status: "unavailable",
      reason: "endpoint_unreachable"
    });
  });

  it("rejects malformed successful responses", async () => {
    const client = new LocalPythonInferenceClient(
      { endpointUrl: "http://127.0.0.1:8765/infer" },
      vi.fn(async () => new Response(JSON.stringify({ status: "ok", candidates: [{ direction: "SIDEWAYS" }] }), { status: 200 })) as typeof fetch
    );

    await expect(client.infer(request)).resolves.toMatchObject({
      status: "unavailable",
      reason: "invalid_response"
    });
  });
});
