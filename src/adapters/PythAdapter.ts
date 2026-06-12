import type { BtcCandleMetadata } from "../domain/types.js";

export interface PythAdapter {
  getBtcFiveMinuteCandleMetadata(): Promise<BtcCandleMetadata>;
}

export class StubPythAdapter implements PythAdapter {
  async getBtcFiveMinuteCandleMetadata(): Promise<BtcCandleMetadata> {
    return {
      capturedAt: new Date(),
      source: "pyth-pro",
      symbol: "BTC",
      intervalMinutes: 5,
      stubbed: true
    };
  }
}
