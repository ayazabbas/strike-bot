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
  predictFunBaseUrl: z.string().url().default("https://api.predict.fun"),
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
    predictFunBaseUrl: env.PREDICT_FUN_BASE_URL,
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
