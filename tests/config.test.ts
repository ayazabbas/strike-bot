import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({});

    expect(config.runMode).toBe("inspect");
    expect(config.maxPositionUsd).toBe(5);
    expect(config.liveTradingApproved).toBe(false);
    expect(config.trustWalletAgentKitEnabled).toBe(true);
  });

  it("rejects unsafe or unsupported run modes", () => {
    expect(() => loadConfig({ RUN_MODE: "mainnet_send" })).toThrow();
  });
});
