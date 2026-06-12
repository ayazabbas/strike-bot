import type { AppConfig, RunMode } from "./config.js";
import type { CmcAdapter } from "./adapters/CmcAdapter.js";
import type { PredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import type { PythAdapter } from "./adapters/PythAdapter.js";
import type { TrustWalletAgentKitAdapter } from "./adapters/TrustWalletAgentKitAdapter.js";
import type { RunRepository } from "./storage/RunRepository.js";
import type { StrategySkill } from "./strategy/StrategySkill.js";
import { filterBtcFiveMinuteMarkets } from "./domain/marketFilter.js";
import { RiskManager } from "./risk/RiskManager.js";
import { PaperExecutor } from "./execution/PaperExecutor.js";

export interface AppDependencies {
  readonly cmc: CmcAdapter;
  readonly pyth: PythAdapter;
  readonly predictFun: PredictFunAdapter;
  readonly twak: TrustWalletAgentKitAdapter;
  readonly strategy: StrategySkill;
  readonly repository: RunRepository;
}

export async function inspect(config: AppConfig, dependencies: AppDependencies) {
  const [macro, candle, marketSnapshot, twak] = await Promise.all([
    dependencies.cmc.getMacroSnapshot(),
    dependencies.pyth.getBtcFiveMinuteCandleMetadata(),
    dependencies.predictFun.listMarkets(),
    dependencies.twak.checkReadiness()
  ]);
  const btcFiveMinuteMarkets = filterBtcFiveMinuteMarkets(marketSnapshot.markets);

  return {
    mode: config.runMode,
    macro,
    candle,
    markets: {
      total: marketSnapshot.markets.length,
      btcFiveMinuteUpDown: btcFiveMinuteMarkets.length
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
  const decision =
    mode === "inspect"
      ? {
          action: "no_trade" as const,
          reason: "inspect_mode" as const,
          runMode: mode,
          createdAt: new Date()
        }
      : await dependencies.strategy.decide({ runMode: mode, macro, candle, markets });

  const risk = new RiskManager(config).evaluate(decision);
  await dependencies.repository.recordDecision(run.id, decision);

  const twak = await dependencies.twak.checkReadiness();
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

  return {
    run,
    decision,
    risk,
    execution,
    twak,
    safety: {
      signing: false,
      broadcasting: false
    }
  };
}
