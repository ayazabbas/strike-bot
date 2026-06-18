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
    expect(config.predictFunRedemptionApproved).toBe(false);
    expect(config.cmcMcpUrl).toBe("https://mcp.coinmarketcap.com/mcp");
    expect(config.cmcMcpApiKey).toBeUndefined();
    expect(config.cmcAgentHubEnabled).toBe(false);
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
    expect(config.strategySignalJournalPath).toBe(
      "/home/ubuntu/.hermes/workspace/strike-bot-research/data/paper/live-ev-signals.jsonl"
    );
    expect(config.strategySignalMaxAgeSeconds).toBe(10);
    expect(config.strategyDynamicEdgeEnabled).toBe(true);
    expect(config.strategyMinEdge).toBe(0.05);
    expect(config.strategyNotionalUsd).toBe(1);
    expect(config.strategyCandleStartToleranceSeconds).toBe(90);
    expect(config.modelInferenceEndpointUrl).toBeUndefined();
    expect(config.modelInferenceTimeoutMs).toBe(500);
    expect(config.paperJournalPath).toBe("data/paper/trades.jsonl");
    expect(config.maxTestTradeUsd).toBe(1);
  });

  it("loads read-only adapter settings from environment names", () => {
    const config = loadConfig({
      PREDICT_FUN_API_KEY: "predict-test-key",
      PYTH_HISTORY_LOOKBACK_MINUTES: "30",
      PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE: "90",
      PREDICT_FUN_ACCOUNT_ADDRESS: "0x0000000000000000000000000000000000000001",
      PREDICT_FUN_PRIVY_KEY_FILE: "~/predict-privy-test-key",
      PREDICT_FUN_JWT_CACHE_FILE: "/tmp/predict-fun-jwt",
      STRATEGY_SKILL: "model",
      STRATEGY_SIGNAL_JOURNAL_PATH: "/tmp/live-ev-signals.jsonl",
      STRATEGY_SIGNAL_MAX_AGE_SECONDS: "7",
      STRATEGY_DYNAMIC_EDGE_ENABLED: "false",
      STRATEGY_MIN_EDGE: "0.07",
      STRATEGY_NOTIONAL_USD: "0.5",
      STRATEGY_CANDLE_START_TOLERANCE_SECONDS: "45",
      MODEL_INFERENCE_ENDPOINT_URL: "http://127.0.0.1:8765/infer",
      MODEL_INFERENCE_TIMEOUT_MS: "250",
      PAPER_JOURNAL_PATH: "tmp/paper.jsonl",
      MAX_TEST_TRADE_USD: "0.05",
      PREDICT_FUN_REDEMPTION_APPROVED: "true",
      CMC_MCP_URL: "https://mcp.coinmarketcap.com/mcp",
      CMC_MCP_API_KEY: "cmc-mcp-key",
      CMC_AGENT_HUB_ENABLED: "true"
    });

    expect(config.predictFunApiKey).toBe("predict-test-key");
    expect(config.cmcMcpUrl).toBe("https://mcp.coinmarketcap.com/mcp");
    expect(config.cmcMcpApiKey).toBe("cmc-mcp-key");
    expect(config.cmcAgentHubEnabled).toBe(true);
    expect(config.pythHistoryLookbackMinutes).toBe(30);
    expect(config.predictFunMinSecondsBeforeClose).toBe(90);
    expect(config.predictFunAccountAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(config.predictFunPrivyKeyFile).toMatch(/predict-privy-test-key$/);
    expect(config.predictFunJwtCacheFile).toBe("/tmp/predict-fun-jwt");
    expect(config.strategySkill).toBe("model");
    expect(config.strategySignalJournalPath).toBe("/tmp/live-ev-signals.jsonl");
    expect(config.strategySignalMaxAgeSeconds).toBe(7);
    expect(config.strategyDynamicEdgeEnabled).toBe(false);
    expect(config.strategyMinEdge).toBe(0.07);
    expect(config.strategyNotionalUsd).toBe(0.5);
    expect(config.strategyCandleStartToleranceSeconds).toBe(45);
    expect(config.modelInferenceEndpointUrl).toBe("http://127.0.0.1:8765/infer");
    expect(config.modelInferenceTimeoutMs).toBe(250);
    expect(config.paperJournalPath).toBe("tmp/paper.jsonl");
    expect(config.maxTestTradeUsd).toBe(0.05);
    expect(config.predictFunRedemptionApproved).toBe(true);
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

  it("loads CMC MCP API key from an external file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-config-"));
    const keyPath = join(dir, "cmc-mcp-key");

    try {
      writeFileSync(keyPath, "cmc-file-key\n", { mode: 0o600 });
      const config = loadConfig({
        CMC_MCP_API_KEY_FILE: keyPath
      });

      expect(config.cmcMcpApiKey).toBe("cmc-file-key");
      expect(config.cmcMcpApiKeyFile).toBe(keyPath);
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

  it("rejects test-trade caps over one dollar", () => {
    expect(() => loadConfig({ MAX_TEST_TRADE_USD: "1.01" })).toThrow();
  });
});
