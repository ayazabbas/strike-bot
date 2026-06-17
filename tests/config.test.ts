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
    expect(config.predictFunMinSecondsBeforeClose).toBe(60);
    expect(config.predictFunAccountAddress).toBe("0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55");
    expect(config.predictFunPrivyKeyFile).toMatch(/\.predict_privy_key$/);
    expect(config.predictFunJwtCacheFile).toMatch(/\.predict_fun_jwt$/);
    expect(config.strategySkill).toBe("noop");
    expect(config.strategyDynamicEdgeEnabled).toBe(true);
    expect(config.strategyMinEdge).toBe(0.05);
    expect(config.strategyCandleStartToleranceSeconds).toBe(90);
    expect(config.paperJournalPath).toBe("data/paper/trades.jsonl");
  });

  it("loads read-only adapter settings from environment names", () => {
    const config = loadConfig({
      PREDICT_FUN_API_KEY: "predict-test-key",
      PYTH_HISTORY_LOOKBACK_MINUTES: "30",
      PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE: "90",
      PREDICT_FUN_ACCOUNT_ADDRESS: "0x0000000000000000000000000000000000000001",
      PREDICT_FUN_PRIVY_KEY_FILE: "~/predict-privy-test-key",
      PREDICT_FUN_JWT_CACHE_FILE: "/tmp/predict-fun-jwt",
      STRATEGY_SKILL: "momentum",
      STRATEGY_DYNAMIC_EDGE_ENABLED: "false",
      STRATEGY_MIN_EDGE: "0.07",
      STRATEGY_CANDLE_START_TOLERANCE_SECONDS: "45",
      PAPER_JOURNAL_PATH: "tmp/paper.jsonl"
    });

    expect(config.predictFunApiKey).toBe("predict-test-key");
    expect(config.pythHistoryLookbackMinutes).toBe(30);
    expect(config.predictFunMinSecondsBeforeClose).toBe(90);
    expect(config.predictFunAccountAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(config.predictFunPrivyKeyFile).toMatch(/predict-privy-test-key$/);
    expect(config.predictFunJwtCacheFile).toBe("/tmp/predict-fun-jwt");
    expect(config.strategySkill).toBe("momentum");
    expect(config.strategyDynamicEdgeEnabled).toBe(false);
    expect(config.strategyMinEdge).toBe(0.07);
    expect(config.strategyCandleStartToleranceSeconds).toBe(45);
    expect(config.paperJournalPath).toBe("tmp/paper.jsonl");
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
