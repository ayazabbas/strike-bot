import { z } from "zod";

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
  trustWalletAgentKitEnabled: booleanFromEnv.default(true),
  trustWalletAgentKitConfigPath: optionalSecret,
  bscRpcUrl: optionalSecret,
  databasePath: z.string().min(1).default("./data/strike-bot.sqlite"),
  maxPositionUsd: z.coerce.number().positive().max(100).default(5),
  maxDailyLossUsd: z.coerce.number().positive().max(1_000).default(10),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  liveTradingApproved: booleanFromEnv.default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse({
    runMode: env.RUN_MODE,
    cmcApiKey: env.CMC_API_KEY,
    pythProApiKey: env.PYTH_PRO_API_KEY,
    pythHistoryBaseUrl: env.PYTH_HISTORY_BASE_URL,
    pythHistoryChannel: env.PYTH_HISTORY_CHANNEL,
    pythHistorySymbol: env.PYTH_HISTORY_SYMBOL,
    pythHistoryLookbackMinutes: env.PYTH_HISTORY_LOOKBACK_MINUTES,
    predictFunBaseUrl: env.PREDICT_FUN_BASE_URL,
    predictFunApiKey: env.PREDICT_FUN_API_KEY,
    trustWalletAgentKitEnabled: env.TRUST_WALLET_AGENT_KIT_ENABLED,
    trustWalletAgentKitConfigPath: env.TRUST_WALLET_AGENT_KIT_CONFIG_PATH,
    bscRpcUrl: env.BSC_RPC_URL,
    databasePath: env.DATABASE_PATH,
    maxPositionUsd: env.MAX_POSITION_USD,
    maxDailyLossUsd: env.MAX_DAILY_LOSS_USD,
    logLevel: env.LOG_LEVEL,
    liveTradingApproved: env.LIVE_TRADING_APPROVED
  });
}
