import type { AppConfig, RunMode } from "./config.js";
import type { CmcAdapter } from "./adapters/CmcAdapter.js";
import type { PredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import type { PredictFunAuthAdapter } from "./adapters/PredictFunAuthAdapter.js";
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
  const liveBlockedByTwak = mode === "live" && decision.action === "enter" && !twak.ready;
  const blockedDecision =
    !risk.approved && decision.action === "enter"
      ? {
          action: "no_trade" as const,
          reason: "risk_rejected" as const,
          marketId: decision.marketId,
          runMode: mode,
          createdAt: new Date()
        }
      : liveBlockedByTwak
        ? {
            action: "no_trade" as const,
            reason: "twak_not_ready" as const,
            marketId: decision.marketId,
            runMode: mode,
            createdAt: new Date()
          }
        : decision;
  const executor = new PaperExecutor();
  const execution = await executor.execute(blockedDecision, mode);
  await dependencies.repository.recordExecution(run.id, execution);
  const safety = {
    signing: false,
    broadcasting: false
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

function formatSelectedMarket(selected: ReturnType<typeof selectNearestTradableBtcFiveMinuteMarket>) {
  if (!selected) {
    return null;
  }
  return {
    id: selected.id,
    categorySlug: selected.categorySlug,
    startsAt: selected.startsAt,
    closesAt: selected.closesAt,
    timeRemainingSeconds: selected.timeRemainingSeconds
  };
}
