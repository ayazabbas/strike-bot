import { describe, expect, it } from "vitest";
import { shouldEmitAttemptedMarketHeartbeat } from "../src/liveRunnerHeartbeat.js";

describe("shouldEmitAttemptedMarketHeartbeat", () => {
  it("emits immediately for a newly attempted market", () => {
    expect(shouldEmitAttemptedMarketHeartbeat("512312", {}, 1_000)).toBe(true);
    expect(shouldEmitAttemptedMarketHeartbeat("512313", { marketId: "512312", emittedAtMs: 1_000 }, 1_001)).toBe(true);
  });

  it("throttles repeated attempted-market heartbeats for the same market", () => {
    const last = { marketId: "512312", emittedAtMs: 1_000 };

    expect(shouldEmitAttemptedMarketHeartbeat("512312", last, 10_999)).toBe(false);
    expect(shouldEmitAttemptedMarketHeartbeat("512312", last, 11_000)).toBe(true);
  });

  it("does not emit without a market id", () => {
    expect(shouldEmitAttemptedMarketHeartbeat(undefined, {}, 1_000)).toBe(false);
  });
});
