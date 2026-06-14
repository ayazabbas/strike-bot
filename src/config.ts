import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

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
  pythProApiKey: optionalSecret,
  pythHistoryBaseUrl: z.string().url().default("https://pyth.dourolabs.app/v1"),
  pythHistoryChannel: z.string().min(1).default("real_time"),
  pythHistorySymbol: z.string().min(1).default("Crypto.BTC/USD"),
  pythHistoryLookbackMinutes: z.coerce.number().int().positive().max(24 * 60).default(60),
  predictFunBaseUrl: z.string().url().default("https://api.predict.fun"),
  predictFunApiKey: optionalSecret,
  predictFunApiKeyFile: optionalSecret,
  predictFunMinSecondsBeforeClose: z.coerce.number().int().nonnegative().default(60),
  strategySkill: z.enum(["noop", "momentum"]).default("noop"),
  strategyMinEdge: z.coerce.number().nonnegative().max(1).default(0.05),
  trustWalletAgentKitEnabled: booleanFromEnv.default(true),
  trustWalletAgentKitConfigPath: optionalSecret,
  bscRpcUrl: optionalSecret,
  databasePath: z.string().min(1).default("./data/strike-bot.sqlite"),
  paperJournalPath: z.string().min(1).default("data/paper/trades.jsonl"),
  maxPositionUsd: z.coerce.number().positive().max(100).default(5),
  maxDailyLossUsd: z.coerce.number().positive().max(1_000).default(10),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  liveTradingApproved: booleanFromEnv.default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const predictFunApiKeyFile = resolveSecretFilePath(env.PREDICT_FUN_API_KEY_FILE) ?? defaultPredictFunApiKeyFile();
  const predictFunApiKey =
    env.PREDICT_FUN_API_KEY && env.PREDICT_FUN_API_KEY.trim().length > 0
      ? env.PREDICT_FUN_API_KEY
      : readOptionalSecretFile(predictFunApiKeyFile);

  return configSchema.parse({
    runMode: env.RUN_MODE,
    cmcApiKey: env.CMC_API_KEY,
    pythProApiKey: env.PYTH_PRO_API_KEY,
    pythHistoryBaseUrl: env.PYTH_HISTORY_BASE_URL,
    pythHistoryChannel: env.PYTH_HISTORY_CHANNEL,
    pythHistorySymbol: env.PYTH_HISTORY_SYMBOL,
    pythHistoryLookbackMinutes: env.PYTH_HISTORY_LOOKBACK_MINUTES,
    predictFunBaseUrl: env.PREDICT_FUN_BASE_URL,
    predictFunApiKey,
    predictFunApiKeyFile,
    predictFunMinSecondsBeforeClose: env.PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE,
    strategySkill: env.STRATEGY_SKILL,
    strategyMinEdge: env.STRATEGY_MIN_EDGE,
    trustWalletAgentKitEnabled: env.TRUST_WALLET_AGENT_KIT_ENABLED,
    trustWalletAgentKitConfigPath: env.TRUST_WALLET_AGENT_KIT_CONFIG_PATH,
    bscRpcUrl: env.BSC_RPC_URL,
    databasePath: env.DATABASE_PATH,
    paperJournalPath: env.PAPER_JOURNAL_PATH,
    maxPositionUsd: env.MAX_POSITION_USD,
    maxDailyLossUsd: env.MAX_DAILY_LOSS_USD,
    logLevel: env.LOG_LEVEL,
    liveTradingApproved: env.LIVE_TRADING_APPROVED
  });
}

function defaultPredictFunApiKeyFile(): string | undefined {
  const candidate = resolve(homedir(), ".pfkey");
  return existsSync(candidate) ? candidate : undefined;
}

function resolveSecretFilePath(value: string | undefined): string | undefined {
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

function readOptionalSecretFile(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!existsSync(path)) {
    throw new Error("Configured predict.fun API key file does not exist");
  }
  const value = readFileSync(path, "utf8").trim();
  return value.length > 0 ? value : undefined;
}
