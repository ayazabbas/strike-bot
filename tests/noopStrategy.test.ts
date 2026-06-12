import { describe, expect, it } from "vitest";
import { NoopStrategySkill } from "../src/strategy/NoopStrategySkill.js";

describe("NoopStrategySkill", () => {
  it("always returns explicit no-trade while strategy is unconfigured", async () => {
    const strategy = new NoopStrategySkill();
    const decision = await strategy.decide({
      runMode: "paper",
      macro: { capturedAt: new Date(), source: "coinmarketcap", stubbed: true },
      candle: {
        capturedAt: new Date(),
        source: "pyth-pro",
        symbol: "BTC",
        intervalMinutes: 5,
        stubbed: true
      },
      markets: []
    });

    expect(decision).toMatchObject({
      action: "no_trade",
      reason: "strategy_not_configured",
      runMode: "paper"
    });
  });
});
