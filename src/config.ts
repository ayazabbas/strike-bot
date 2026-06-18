import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { PREDICT_FUN_MIN_ORDER_NOTIONAL_USD } from "./domain/predictFunLimits.js";

export const runModeSchema = z.enum(["inspect", "paper", "dry_run", "live"]);
export type RunMode = z.infer<typeof runModeSchema>;

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  return value.toLowerCase() === "true";
}, z.boolean());

const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const configSchema = z.object({
  runMode: runModeSchema.default("inspect"),
  cmcApiKey: optionalSecret,
  cmcMcpUrl: z.string().url().default("https://mcp.coinmarketcap.com/mcp"),
  cmcMcpApiKey: optionalSecret,
  cmcMcpApiKeyFile: optionalSecret,
  cmcAgentHubEnabled: booleanFromEnv.default(false),
  pythProApiKey: optionalSecret,
  pythHistoryBaseUrl: z.string().url().default("https://pyth.dourolabs.app/v1"),
  pythHistoryChannel: z.string().min(1).default("real_time"),
  pythHistorySymbol: z.string().min(1).default("Crypto.BTC/USD"),
  pythHistoryLookbackMinutes: z.coerce.number().int().positive().max(24 * 60).default(60),
  predictFunBaseUrl: z.string().url().default("https://api.predict.fun"),
  predictFunAccountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default("0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55"),
  predictFunApiKey: optionalSecret,
  predictFunApiKeyFile: optionalSecret,
  predictFunPrivyKeyFile: z.string().min(1).default(resolve(homedir(), ".predict_privy_key")),
  predictFunJwtCacheFile: z.string().min(1).default(resolve(homedir(), ".predict_fun_jwt")),
  predictFunMinSecondsBeforeClose: z.coerce.number().int().nonnegative().default(60),
  strategySkill: z.enum(["noop", "momentum", "signal", "model"]).default("noop"),
  strategySignalJournalPath: z
    .string()
    .min(1)
    .default("/home/ubuntu/.hermes/workspace/strike-bot-research/data/paper/live-ev-signals.jsonl"),
  strategySignalMaxAgeSeconds: z.coerce.number().int().positive().default(10),
  strategyDynamicEdgeEnabled: booleanFromEnv.default(true),
  strategyMinEdge: z.coerce.number().nonnegative().max(1).default(0.05),
  strategyNotionalUsd: z.coerce.number().positive().max(5).default(PREDICT_FUN_MIN_ORDER_NOTIONAL_USD),
  strategyCandleStartToleranceSeconds: z.coerce.number().int().nonnegative().default(90),
  modelInferenceEndpointUrl: optionalSecret.pipe(z.string().url().optional()),
  modelInferenceTimeoutMs: z.coerce.number().int().positive().max(30_000).default(500),
  trustWalletAgentKitEnabled: booleanFromEnv.default(true),
  trustWalletAgentKitConfigPath: optionalSecret,
  bscRpcUrl: optionalSecret,
  databasePath: z.string().min(1).default("./data/strike-bot.sqlite"),
  paperJournalPath: z.string().min(1).default("data/paper/trades.jsonl"),
  maxTestTradeUsd: z.coerce.number().positive().max(1).default(PREDICT_FUN_MIN_ORDER_NOTIONAL_USD),
  maxPositionUsd: z.coerce.number().positive().max(100).default(5),
  maxDailyLossUsd: z.coerce.number().positive().max(1_000).default(10),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  liveTradingApproved: booleanFromEnv.default(false),
  predictFunRedemptionApproved: booleanFromEnv.default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const predictFunApiKeyFile = resolveSecretFilePath(env.PREDICT_FUN_API_KEY_FILE) ?? defaultPredictFunApiKeyFile();
  const predictFunApiKey =
    env.PREDICT_FUN_API_KEY && env.PREDICT_FUN_API_KEY.trim().length > 0
      ? env.PREDICT_FUN_API_KEY
      : readOptionalSecretFile(predictFunApiKeyFile, "predict.fun API key");
  const cmcMcpApiKeyFile = resolveSecretFilePath(env.CMC_MCP_API_KEY_FILE);
  const cmcMcpApiKey =
    env.CMC_MCP_API_KEY && env.CMC_MCP_API_KEY.trim().length > 0 ? env.CMC_MCP_API_KEY : readOptionalSecretFile(cmcMcpApiKeyFile, "CMC MCP API key");
  const predictFunPrivyKeyFile = resolveSecretFilePath(env.PREDICT_FUN_PRIVY_KEY_FILE) ?? resolve(homedir(), ".predict_privy_key");
  const predictFunJwtCacheFile = resolveSecretFilePath(env.PREDICT_FUN_JWT_CACHE_FILE) ?? resolve(homedir(), ".predict_fun_jwt");

  return configSchema.parse({
    runMode: env.RUN_MODE,
    cmcApiKey: env.CMC_API_KEY,
    cmcMcpUrl: env.CMC_MCP_URL,
    cmcMcpApiKey,
    cmcMcpApiKeyFile,
    cmcAgentHubEnabled: env.CMC_AGENT_HUB_ENABLED,
    pythProApiKey: env.PYTH_PRO_API_KEY,
    pythHistoryBaseUrl: env.PYTH_HISTORY_BASE_URL,
    pythHistoryChannel: env.PYTH_HISTORY_CHANNEL,
    pythHistorySymbol: env.PYTH_HISTORY_SYMBOL,
    pythHistoryLookbackMinutes: env.PYTH_HISTORY_LOOKBACK_MINUTES,
    predictFunBaseUrl: env.PREDICT_FUN_BASE_URL,
    predictFunAccountAddress: env.PREDICT_FUN_ACCOUNT_ADDRESS,
    predictFunApiKey,
    predictFunApiKeyFile,
    predictFunPrivyKeyFile,
    predictFunJwtCacheFile,
    predictFunMinSecondsBeforeClose: env.PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE,
    strategySkill: env.STRATEGY_SKILL,
    strategySignalJournalPath: env.STRATEGY_SIGNAL_JOURNAL_PATH,
    strategySignalMaxAgeSeconds: env.STRATEGY_SIGNAL_MAX_AGE_SECONDS,
    strategyDynamicEdgeEnabled: env.STRATEGY_DYNAMIC_EDGE_ENABLED,
    strategyMinEdge: env.STRATEGY_MIN_EDGE,
    strategyNotionalUsd: env.STRATEGY_NOTIONAL_USD,
    strategyCandleStartToleranceSeconds: env.STRATEGY_CANDLE_START_TOLERANCE_SECONDS,
    modelInferenceEndpointUrl: env.MODEL_INFERENCE_ENDPOINT_URL,
    modelInferenceTimeoutMs: env.MODEL_INFERENCE_TIMEOUT_MS,
    trustWalletAgentKitEnabled: env.TRUST_WALLET_AGENT_KIT_ENABLED,
    trustWalletAgentKitConfigPath: env.TRUST_WALLET_AGENT_KIT_CONFIG_PATH,
    bscRpcUrl: env.BSC_RPC_URL,
    databasePath: env.DATABASE_PATH,
    paperJournalPath: env.PAPER_JOURNAL_PATH,
    maxTestTradeUsd: env.MAX_TEST_TRADE_USD,
    maxPositionUsd: env.MAX_POSITION_USD,
    maxDailyLossUsd: env.MAX_DAILY_LOSS_USD,
    logLevel: env.LOG_LEVEL,
    liveTradingApproved: env.LIVE_TRADING_APPROVED,
    predictFunRedemptionApproved: env.PREDICT_FUN_REDEMPTION_APPROVED
  });
}

function defaultPredictFunApiKeyFile(): string | undefined {
  const candidate = resolve(homedir(), ".pfkey");
  return existsSync(candidate) ? candidate : undefined;
}

export function resolveSecretFilePath(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith("~/")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

function readOptionalSecretFile(path: string | undefined, label: string): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!existsSync(path)) {
    throw new Error(`Configured ${label} file does not exist`);
  }
  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}
