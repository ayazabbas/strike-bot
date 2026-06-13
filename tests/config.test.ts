import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

  it("loads predict.fun API key from an external file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-config-"));
    const keyPath = join(dir, "pfkey");

    try {
      writeFileSync(keyPath, "predict-file-key\n", { mode: 0o600 });
      const config = loadConfig({
        PREDICT_FUN_API_KEY_FILE: keyPath
      });

      expect(config.predictFunApiKey).toBe("predict-file-key");
      expect(config.predictFunApiKeyFile).toBe(keyPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prefers explicit predict.fun API key over the key file", () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-config-"));
    const keyPath = join(dir, "pfkey");

    try {
      writeFileSync(keyPath, "predict-file-key\n", { mode: 0o600 });
      const config = loadConfig({
        PREDICT_FUN_API_KEY: "predict-env-key",
        PREDICT_FUN_API_KEY_FILE: keyPath
      });

      expect(config.predictFunApiKey).toBe("predict-env-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a configured predict.fun API key file that does not exist", () => {
    expect(() => loadConfig({ PREDICT_FUN_API_KEY_FILE: "/tmp/strike-bot-missing-pfkey" })).toThrow(
      "Configured predict.fun API key file does not exist"
    );
  });

  it("rejects unsafe or unsupported run modes", () => {
    expect(() => loadConfig({ RUN_MODE: "mainnet_send" })).toThrow();
  });
});
