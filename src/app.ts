import type { AppConfig, RunMode } from "./config.js";
import { existsSync } from "node:fs";
import type { CmcAdapter } from "./adapters/CmcAdapter.js";
import type { PredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import type { PredictFunAuthAdapter } from "./adapters/PredictFunAuthAdapter.js";
import { RestPredictFunPositionsAdapter, type PredictFunPositionsAdapter } from "./adapters/PredictFunPositionsAdapter.js";
import type { PythAdapter } from "./adapters/PythAdapter.js";
import type { TrustWalletAgentKitAdapter } from "./adapters/TrustWalletAgentKitAdapter.js";
import type { PredictFunExecutionWalletAdapter } from "./adapters/PredictFunExecutionWalletAdapter.js";
import type { RunRepository } from "./storage/RunRepository.js";
import type { PaperJournal } from "./storage/PaperJournal.js";
import { enrichPaperJournalSettlements } from "./storage/PaperJournal.js";
import type { StrategySkill } from "./strategy/StrategySkill.js";
import { filterBtcFiveMinuteMarkets, selectNearestTradableBtcFiveMinuteMarket } from "./domain/marketFilter.js";
import { RiskManager } from "./risk/RiskManager.js";
import { PaperExecutor } from "./execution/PaperExecutor.js";
import { PredictFunOrderExecutor } from "./execution/PredictFunOrderExecutor.js";
import { PredictFunRedemptionExecutor } from "./execution/PredictFunRedemptionExecutor.js";
import { PredictFunRedemptionPlanner } from "./execution/PredictFunRedemptionPlanner.js";
import { PREDICT_FUN_MIN_ORDER_NOTIONAL_USD } from "./domain/predictFunLimits.js";

export interface AppDependencies {
  readonly cmc: CmcAdapter;
  readonly pyth: PythAdapter;
  readonly predictFun: PredictFunAdapter;
  readonly predictFunAuth: PredictFunAuthAdapter;
  readonly predictFunExecutionWallet: PredictFunExecutionWalletAdapter;
  readonly twak: TrustWalletAgentKitAdapter;
  readonly strategy: StrategySkill;
  readonly repository: RunRepository;
  readonly paperJournal?: PaperJournal;
  readonly predictFunOrderExecutor?: PredictFunOrderExecutor;
  readonly predictFunPositions?: PredictFunPositionsAdapter;
}

export async function inspect(config: AppConfig, dependencies: AppDependencies) {
  const [macro, candle, marketSnapshot, predictFunAuth, predictFunExecutionWallet, twak] = await Promise.all([
    dependencies.cmc.getMacroSnapshot(),
    dependencies.pyth.getBtcFiveMinuteCandleMetadata(),
    dependencies.predictFun.listMarkets(),
    dependencies.predictFunAuth.checkReadiness({ acquireJwt: true }),
    dependencies.predictFunExecutionWallet.getStatus(),
    dependencies.twak.checkReadiness()
  ]);
  const btcFiveMinuteMarkets = filterBtcFiveMinuteMarkets(marketSnapshot.markets);
  const selectedMarket = selectNearestTradableBtcFiveMinuteMarket(marketSnapshot.markets, {
    minSecondsBeforeClose: config.predictFunMinSecondsBeforeClose
  });
  const pricing = selectedMarket ? await dependencies.predictFun.getOrderbookPricing(selectedMarket.id) : undefined;

  return {
    mode: config.runMode,
    macro,
    candle,
    markets: {
      total: marketSnapshot.markets.length,
      btcFiveMinuteUpDown: btcFiveMinuteMarkets.length,
      selected: formatSelectedMarket(selectedMarket)
    },
    pricing: pricing ?? null,
    funding: {
      predictFunExecutionAddress: predictFunExecutionWallet.address,
      predictFunAuth,
      predictFunExecutionWallet,
      twakFundingWallet: formatTwakFundingWallet(twak)
    },
    twak,
    safety: {
      signing: false,
      broadcasting: false
    }
  };
}

export async function tick(config: AppConfig, dependencies: AppDependencies, mode: RunMode) {
  await dependencies.repository.init();
  const run = await dependencies.repository.createRun(mode);
  const macro = await dependencies.cmc.getMacroSnapshot();
  const candle = await dependencies.pyth.getBtcFiveMinuteCandleMetadata();
  const marketSnapshot = await dependencies.predictFun.listMarkets();
  await dependencies.repository.recordMarketSnapshot(run.id, marketSnapshot);

  const markets = filterBtcFiveMinuteMarkets(marketSnapshot.markets);
  const selectedMarket = selectNearestTradableBtcFiveMinuteMarket(marketSnapshot.markets, {
    minSecondsBeforeClose: config.predictFunMinSecondsBeforeClose
  });
  const pricing = selectedMarket ? await dependencies.predictFun.getOrderbookPricing(selectedMarket.id) : undefined;
  const decision =
    mode === "inspect"
      ? {
          action: "no_trade" as const,
          reason: "inspect_mode" as const,
          runMode: mode,
          createdAt: new Date()
        }
      : await dependencies.strategy.decide({
          runMode: mode,
          macro,
          candle,
          markets,
          selectedMarket: selectedMarket ?? undefined,
          pricing
        });

  const risk = new RiskManager(config).evaluate(decision);
  await dependencies.repository.recordDecision(run.id, decision);

  const [predictFunAuth, predictFunExecutionWallet, twak] = await Promise.all([
    dependencies.predictFunAuth.checkReadiness({ acquireJwt: mode === "dry_run" }),
    dependencies.predictFunExecutionWallet.getStatus(),
    dependencies.twak.checkReadiness()
  ]);
  const blockedDecision =
    !risk.approved && decision.action === "enter"
      ? {
          action: "no_trade" as const,
          reason: "risk_rejected" as const,
          marketId: decision.marketId,
          runMode: mode,
          createdAt: new Date()
        }
      : decision;
  const execution =
    mode === "dry_run" || mode === "live"
      ? await (dependencies.predictFunOrderExecutor ?? new PredictFunOrderExecutor(config)).execute(blockedDecision, mode, {
          selectedMarket: selectedMarket?.market,
          pricing,
          risk
        })
      : await new PaperExecutor().execute(blockedDecision, mode);
  await dependencies.repository.recordExecution(run.id, execution);
  const safety = {
    signing:
      blockedDecision.action === "enter" &&
      (execution.status === "prepared_not_broadcast" || execution.status === "broadcast"),
    broadcasting: execution.broadcast
  };

  if (mode === "paper") {
    await dependencies.paperJournal?.append({
      run,
      mode,
      strategyName: dependencies.strategy.name,
      selectedMarket: selectedMarket ?? undefined,
      pricing,
      candle,
      decision: blockedDecision,
      strategyDecision: decision,
      risk,
      execution,
      safety
    });
  }

  return {
    run,
    decision,
    risk,
    execution,
    market: formatSelectedMarket(selectedMarket),
    pricing: pricing ?? null,
    funding: {
      predictFunExecutionAddress: predictFunExecutionWallet.address,
      predictFunAuth,
      predictFunExecutionWallet,
      twakFundingWallet: formatTwakFundingWallet(twak)
    },
    twak,
    safety
  };
}

export async function liveReadiness(config: AppConfig, dependencies: AppDependencies) {
  const capturedAt = new Date();
  const [marketSnapshot, predictFunAuth, twak, positionsSnapshot] = await Promise.all([
    dependencies.predictFun.listMarkets(),
    dependencies.predictFunAuth.checkReadiness({ acquireJwt: false }),
    dependencies.twak.checkReadiness(),
    (dependencies.predictFunPositions ?? new RestPredictFunPositionsAdapter(config)).getPositions()
  ]);
  const btcFiveMinuteMarkets = filterBtcFiveMinuteMarkets(marketSnapshot.markets);
  const selectedMarket = selectNearestTradableBtcFiveMinuteMarket(marketSnapshot.markets, {
    minSecondsBeforeClose: config.predictFunMinSecondsBeforeClose
  });
  const pricing = selectedMarket ? await dependencies.predictFun.getOrderbookPricing(selectedMarket.id) : undefined;
  const redemptionDryRun = new PredictFunRedemptionPlanner().plan(positionsSnapshot);
  const credentials = {
    predictFunApiKeyConfigured: Boolean(config.predictFunApiKey),
    predictFunJwtCachePresent: predictFunAuth.tokenCachePresent,
    privyKeyFilePresent: existsSync(config.predictFunPrivyKeyFile),
    bscRpcConfigured: Boolean(config.bscRpcUrl),
    liveTradingApproved: config.liveTradingApproved,
    predictFunRedemptionApproved: config.predictFunRedemptionApproved,
    maxTestTradeUsd: config.maxTestTradeUsd,
    predictFunMinOrderNotionalUsd: PREDICT_FUN_MIN_ORDER_NOTIONAL_USD
  };
  const strategy = {
    configuredSkillName: dependencies.strategy.name,
    noop: dependencies.strategy.name.toLowerCase().includes("noop"),
    notionalUsd: config.strategyNotionalUsd,
    predictFunMinOrderNotionalUsd: PREDICT_FUN_MIN_ORDER_NOTIONAL_USD
  };
  const pricingStatus = selectedMarket ? pricing?.status ?? "unknown" : "not_requested";
  const blockers = liveReadinessBlockers({
    credentials,
    strategy,
    selectedMarket,
    pricingStatus,
    twakReady: twak.ready
  });
  const warnings = [
    ...predictFunAuth.reasons,
    ...twak.reasons,
    ...(positionsSnapshot.status === "unavailable" ? [positionsSnapshot.reason ?? "positions_unavailable"] : [])
  ];

  return {
    mode: "live_readiness" as const,
    capturedAt,
    safety: {
      signing: false as const,
      broadcasting: false as const
    },
    summary: {
      ready: blockers.length === 0,
      blockers,
      warnings: Array.from(new Set(warnings))
    },
    market: {
      total: marketSnapshot.markets.length,
      btcFiveMinuteUpDown: btcFiveMinuteMarkets.length,
      selected: formatSelectedMarket(selectedMarket),
      pricing: {
        status: pricingStatus,
        upAskPresent: pricing?.up.bestAsk !== undefined,
        downAskPresent: pricing?.down.bestAsk !== undefined
      }
    },
    credentials,
    strategy,
    funding: {
      predictFunAuth,
      twakFundingWallet: formatTwakFundingWallet(twak)
    },
    twak,
    positions: {
      status: positionsSnapshot.status,
      count: positionsSnapshot.positions.length,
      redeemableCount: positionsSnapshot.positions.filter((position) => position.redeemable === true).length,
      redemptionDryRunIntentCount: redemptionDryRun.intents.length
    }
  };
}

function formatTwakFundingWallet(twak: Awaited<ReturnType<TrustWalletAgentKitAdapter["checkReadiness"]>>) {
  return {
    ready: twak.ready,
    credentialsCliRpcReady: twak.credentialsCliRpcReady,
    agentWalletConfigured: twak.agentWalletConfigured,
    agentWalletPasswordAvailable: twak.agentWalletPasswordAvailable,
    address: twak.address,
    reasons: twak.reasons
  };
}

export async function settlePaperJournal(config: AppConfig, dependencies: Pick<AppDependencies, "predictFun">) {
  return enrichPaperJournalSettlements(config.paperJournalPath, dependencies.predictFun);
}

export async function inspectPositions(_config: AppConfig, adapter: PredictFunPositionsAdapter) {
  return adapter.getPositions();
}

export async function redeemPositionsDryRun(_config: AppConfig, adapter: PredictFunPositionsAdapter) {
  const snapshot = await adapter.getPositions();
  return new PredictFunRedemptionPlanner().plan(snapshot);
}

export async function redeemPositionsLive(config: AppConfig, adapter: PredictFunPositionsAdapter) {
  const plan = await redeemPositionsDryRun(config, adapter);
  return new PredictFunRedemptionExecutor(config).execute(plan, "live");
}

function formatSelectedMarket(selected: ReturnType<typeof selectNearestTradableBtcFiveMinuteMarket>) {
  if (!selected) {
    return null;
  }
  return {
    id: selected.id,
    categorySlug: selected.categorySlug,
    startsAt: selected.startsAt,
    closesAt: selected.closesAt,
    timeRemainingSeconds: selected.timeRemainingSeconds,
    outcomeTokenIdsPresent: Boolean(selected.market.outcomeOnChainIds?.UP && selected.market.outcomeOnChainIds?.DOWN),
    marketFlagsPresent: selected.market.isNegRisk !== undefined && selected.market.isYieldBearing !== undefined
  };
}

function liveReadinessBlockers(input: {
  readonly credentials: {
    readonly predictFunApiKeyConfigured: boolean;
    readonly predictFunJwtCachePresent: boolean;
    readonly privyKeyFilePresent: boolean;
    readonly bscRpcConfigured: boolean;
    readonly liveTradingApproved: boolean;
    readonly predictFunRedemptionApproved: boolean;
    readonly maxTestTradeUsd: number;
  };
  readonly strategy: {
    readonly noop: boolean;
    readonly notionalUsd: number;
  };
  readonly selectedMarket: ReturnType<typeof selectNearestTradableBtcFiveMinuteMarket>;
  readonly pricingStatus: string;
  readonly twakReady: boolean;
}): string[] {
  const blockers: string[] = [];

  if (!input.credentials.predictFunApiKeyConfigured) {
    blockers.push("predict_fun_api_key_missing");
  }
  if (!input.credentials.predictFunJwtCachePresent) {
    blockers.push("predict_fun_jwt_cache_missing");
  }
  if (!input.credentials.privyKeyFilePresent) {
    blockers.push("predict_fun_privy_key_file_missing");
  }
  if (!input.credentials.bscRpcConfigured) {
    blockers.push("bsc_rpc_url_missing");
  }
  if (!input.credentials.liveTradingApproved) {
    blockers.push("live_trading_not_approved");
  }
  if (!input.credentials.predictFunRedemptionApproved) {
    blockers.push("predict_fun_redemption_not_approved");
  }
  if (input.credentials.maxTestTradeUsd < PREDICT_FUN_MIN_ORDER_NOTIONAL_USD) {
    blockers.push("max_test_trade_below_predict_fun_minimum");
  }
  if (input.strategy.noop) {
    blockers.push("live_strategy_is_noop");
  }
  if (input.strategy.notionalUsd < PREDICT_FUN_MIN_ORDER_NOTIONAL_USD) {
    blockers.push("strategy_notional_below_predict_fun_minimum");
  }
  if (!input.selectedMarket) {
    blockers.push("btc_five_minute_market_not_selected");
  } else {
    if (!input.selectedMarket.market.outcomeOnChainIds?.UP || !input.selectedMarket.market.outcomeOnChainIds.DOWN) {
      blockers.push("selected_market_outcome_token_ids_missing");
    }
    if (input.selectedMarket.market.isNegRisk === undefined || input.selectedMarket.market.isYieldBearing === undefined) {
      blockers.push("selected_market_flags_missing");
    }
  }
  if (input.selectedMarket && input.pricingStatus !== "available") {
    blockers.push("pricing_unavailable");
  }
  if (!input.twakReady) {
    blockers.push("twak_not_ready");
  }

  return blockers;
}
