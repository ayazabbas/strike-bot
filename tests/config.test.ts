import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads safe defaults", () => {
    const config = loadConfig({});

    expect(config.runMode).toBe("inspect");
    expect(config.maxPositionUsd).toBe(5);
    expect(config.liveTradingApproved).toBe(false);
    expect(config.trustWalletAgentKitEnabled).toBe(true);
    expect(config.pythHistoryBaseUrl).toBe("https://pyth.dourolabs.app/v1");
    expect(config.pythHistoryChannel).toBe("real_time");
    expect(config.pythHistorySymbol).toBe("Crypto.BTC/USD");
    expect(config.pythHistoryLookbackMinutes).toBe(60);
  });

  it("loads read-only adapter settings from environment names", () => {
    const config = loadConfig({
      PREDICT_FUN_API_KEY: "predict-test-key",
      PYTH_HISTORY_LOOKBACK_MINUTES: "30"
    });

    expect(config.predictFunApiKey).toBe("predict-test-key");
    expect(config.pythHistoryLookbackMinutes).toBe(30);
  });

  it("rejects unsafe or unsupported run modes", () => {
    expect(() => loadConfig({ RUN_MODE: "mainnet_send" })).toThrow();
  });
});
