import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { RiskManager } from "../src/risk/RiskManager.js";

describe("RiskManager", () => {
  it("allows no-trade decisions", () => {
    const risk = new RiskManager(loadConfig({}));

    expect(
      risk.evaluate({
        action: "no_trade",
        reason: "strategy_not_configured",
        runMode: "paper",
        createdAt: new Date()
      })
    ).toEqual({ approved: true, reasons: ["no_trade"] });
  });

  it("rejects live entries without explicit approval", () => {
    const risk = new RiskManager(loadConfig({ RUN_MODE: "live", MAX_POSITION_USD: "5" }));

    expect(
      risk.evaluate({
        action: "enter",
        marketId: "m1",
        direction: "UP",
        notionalUsd: 3,
        runMode: "live",
        createdAt: new Date()
      })
    ).toEqual({ approved: false, reasons: ["live_not_approved"] });
  });
});
