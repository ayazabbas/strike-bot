# Local Model Inference Contract

The TypeScript bot owns realtime market, Pyth, CMC, pricing, and candidate construction state. A Python service may be used only for local sklearn inference.

Configure the client with:

```bash
MODEL_INFERENCE_ENDPOINT_URL=http://127.0.0.1:8765/infer
MODEL_INFERENCE_TIMEOUT_MS=500
```

When unset, inference is disabled and the current signal-journal bridge remains unchanged.

## Request

`POST /infer` with `content-type: application/json`.

The request contains:

- `requestId`, `capturedAt`, and `runMode`.
- `market`: selected BTC 5-minute predict.fun market metadata.
- `pricing`: current predict.fun UP/DOWN bid/ask pricing from the TS adapter.
- `features`: TS-owned macro and Pyth candle-derived inputs.
- `candidates`: explicit UP and DOWN candidate params, including entry ask.

Python should not fetch live market, Pyth, CMC, or predict.fun state for this endpoint.

## Response

Return HTTP 200 with:

```json
{
  "status": "ok",
  "capturedAt": "2026-06-18T12:00:05.100Z",
  "modelVersion": "sklearn-ev-dir-20260618",
  "candidates": [
    {
      "direction": "UP",
      "profitabilityProbability": 0.61,
      "directionProbability": 0.7,
      "predictedEv": 0.14,
      "directionEdge": 0.23
    }
  ]
}
```

The TS client treats endpoint failures, non-2xx responses, and malformed response bodies as unavailable model output.
