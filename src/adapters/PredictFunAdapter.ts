import type { MarketSnapshot, PredictFunMarket } from "../domain/types.js";

export interface PredictFunAdapter {
  listMarkets(): Promise<MarketSnapshot>;
}

export class StubPredictFunAdapter implements PredictFunAdapter {
  async listMarkets(): Promise<MarketSnapshot> {
    return {
      capturedAt: new Date(),
      markets: []
    };
  }
}

export function makeStubPredictFunMarket(overrides: Partial<PredictFunMarket> = {}): PredictFunMarket {
  const now = new Date();
  return {
    id: "stub-btc-5m",
    venue: "predict.fun",
    asset: "BTC",
    intervalMinutes: 5,
    directions: ["UP", "DOWN"],
    startsAt: now,
    closesAt: new Date(now.getTime() + 5 * 60 * 1000),
    resolvesAt: new Date(now.getTime() + 6 * 60 * 1000),
    liquidityUsd: 0,
    status: "open",
    ...overrides
  };
}
