import { z } from "zod";
import type { ModelInferenceClient, ModelInferenceRequest, ModelInferenceResult } from "./types.js";

export interface LocalPythonInferenceClientOptions {
  readonly endpointUrl: string;
  readonly timeoutMs?: number;
}

const finiteProbability = z.number().finite().min(0).max(1).optional();
const finiteNumber = z.number().finite().optional();

const responseSchema = z.object({
  status: z.literal("ok"),
  capturedAt: z.string().datetime(),
  modelVersion: z.string().min(1).optional(),
  candidates: z
    .array(
        z.object({
          direction: z.enum(["UP", "DOWN"]),
          entryAsk: finiteNumber,
          entryBid: finiteNumber,
          profitabilityProbability: finiteProbability,
        directionProbability: finiteProbability,
        predictedEv: finiteNumber,
        directionEdge: finiteNumber,
        modelScore: finiteNumber
      })
    )
    .min(1),
  raw: z.record(z.unknown()).optional()
});

export class LocalPythonInferenceClient implements ModelInferenceClient {
  constructor(private readonly options: LocalPythonInferenceClientOptions, private readonly fetchFn: typeof fetch = fetch) {}

  async infer(request: ModelInferenceRequest): Promise<ModelInferenceResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 500);

    try {
      const response = await this.fetchFn(this.options.endpointUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      if (!response.ok) {
        return { status: "unavailable", reason: "http_error", httpStatus: response.status };
      }

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return { status: "unavailable", reason: "invalid_response", error: parsed.error.message };
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { status: "unavailable", reason: "invalid_response", error: error.message };
      }
      return { status: "unavailable", reason: "endpoint_unreachable", error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
