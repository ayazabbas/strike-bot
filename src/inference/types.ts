import type { MarketDirection } from "../domain/types.js";
import type { RunMode } from "../config.js";

export interface ModelInferenceCandidateInput {
  readonly direction: MarketDirection;
  readonly entryAsk: number;
  readonly entryBid?: number;
}

export interface ModelInferenceRequest {
  readonly requestId: string;
  readonly capturedAt: string;
  readonly runMode: RunMode;
  readonly market: {
    readonly id: string;
    readonly categorySlug?: string;
    readonly startsAt: string;
    readonly closesAt: string;
    readonly timeRemainingSeconds: number;
    readonly status: string;
  };
  readonly pricing: {
    readonly marketId: string;
    readonly capturedAt: string;
    readonly status: "available";
    readonly up: {
      readonly bestBid?: number;
      readonly bestAsk: number;
    };
    readonly down: {
      readonly bestBid?: number;
      readonly bestAsk: number;
    };
    readonly spread?: number;
  };
  readonly features: {
    readonly elapsedSeconds: number;
    readonly btcUsd?: number;
    readonly btc24hChangePct?: number;
    readonly btc7dChangePct?: number;
    readonly btcVolumeChange24hPct?: number;
    readonly latestCandle?: {
      readonly openTime: string;
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly volume?: number;
    };
  };
  readonly candidates: readonly ModelInferenceCandidateInput[];
}

export interface ModelInferenceCandidateOutput {
  readonly direction: MarketDirection;
  readonly profitabilityProbability?: number;
  readonly directionProbability?: number;
  readonly predictedEv?: number;
  readonly directionEdge?: number;
  readonly modelScore?: number;
}

export type ModelInferenceResult =
  | {
      readonly status: "ok";
      readonly capturedAt: string;
      readonly modelVersion?: string;
      readonly candidates: readonly ModelInferenceCandidateOutput[];
      readonly raw?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "unavailable";
      readonly reason: "endpoint_unreachable" | "http_error" | "invalid_response";
      readonly httpStatus?: number;
      readonly error?: string;
    };

export interface ModelInferenceClient {
  infer(request: ModelInferenceRequest): Promise<ModelInferenceResult>;
}
