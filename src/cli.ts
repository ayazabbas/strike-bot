import { loadConfig, runModeSchema, type AppConfig } from "./config.js";
import { RestCmcAdapter } from "./adapters/CmcAdapter.js";
import { RestPredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import { PredictFunSdkAuthSigner, RestPredictFunAuthAdapter } from "./adapters/PredictFunAuthAdapter.js";
import { RestPredictFunPositionsAdapter } from "./adapters/PredictFunPositionsAdapter.js";
import { FilePredictFunExecutionWalletAdapter } from "./adapters/PredictFunExecutionWalletAdapter.js";
import { HistoryPythAdapter } from "./adapters/PythAdapter.js";
import { EnvTrustWalletAgentKitAdapter } from "./adapters/TrustWalletAgentKitAdapter.js";
import { NoopSqliteRunRepository } from "./storage/RunRepository.js";
import { JsonlPaperJournal } from "./storage/PaperJournal.js";
import { PredictFunOrderExecutor } from "./execution/PredictFunOrderExecutor.js";
import { NoopStrategySkill } from "./strategy/NoopStrategySkill.js";
import { MomentumStrategySkill } from "./strategy/MomentumStrategySkill.js";
import {
  inspect,
  inspectPositions,
  liveReadiness,
  redeemPositionsDryRun,
  redeemPositionsLive,
  settlePaperJournal,
  tick
} from "./app.js";

function makeDependencies(config: AppConfig) {
  return {
    cmc: new RestCmcAdapter(config),
    pyth: new HistoryPythAdapter(config),
    predictFun: new RestPredictFunAdapter(config),
    predictFunAuth: new RestPredictFunAuthAdapter(config, new PredictFunSdkAuthSigner(config)),
    predictFunExecutionWallet: new FilePredictFunExecutionWalletAdapter(config),
    twak: new EnvTrustWalletAgentKitAdapter(config),
    strategy:
      config.strategySkill === "momentum"
        ? new MomentumStrategySkill({
            ...(config.strategyDynamicEdgeEnabled ? {} : { minEdge: config.strategyMinEdge }),
            notionalUsd: config.strategyNotionalUsd,
            candleStartToleranceSeconds: config.strategyCandleStartToleranceSeconds
          })
        : new NoopStrategySkill(),
    repository: new NoopSqliteRunRepository(config.databasePath),
    paperJournal: new JsonlPaperJournal(config.paperJournalPath),
    predictFunOrderExecutor: new PredictFunOrderExecutor(config),
    predictFunPositions: new RestPredictFunPositionsAdapter(config)
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) =>
      nestedValue instanceof Date ? nestedValue.toISOString() : typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    2
  );
}

async function main() {
  const command = process.argv[2] ?? "inspect";
  const config = loadConfig();
  const dependencies = makeDependencies(config);

  if (command === "inspect") {
    console.log(safeJson(await inspect(config, dependencies)));
    return;
  }

  if (command === "live-readiness") {
    console.log(safeJson(await liveReadiness(config, dependencies)));
    return;
  }

  if (command === "tick") {
    const mode = runModeSchema.parse(config.runMode);
    console.log(safeJson(await tick(config, dependencies, mode)));
    return;
  }

  if (command === "settle-paper") {
    console.log(safeJson(await settlePaperJournal(config, dependencies)));
    return;
  }

  if (command === "positions") {
    console.log(safeJson(await inspectPositions(config, new RestPredictFunPositionsAdapter(config))));
    return;
  }

  if (command === "redeem-positions") {
    const live = process.argv.slice(3).includes("--live");
    const adapter = new RestPredictFunPositionsAdapter(config);
    console.log(safeJson(live ? await redeemPositionsLive(config, adapter) : await redeemPositionsDryRun(config, adapter)));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
