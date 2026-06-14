import { loadConfig, runModeSchema, type AppConfig } from "./config.js";
import { StubCmcAdapter } from "./adapters/CmcAdapter.js";
import { RestPredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import { HistoryPythAdapter } from "./adapters/PythAdapter.js";
import { EnvTrustWalletAgentKitAdapter } from "./adapters/TrustWalletAgentKitAdapter.js";
import { NoopSqliteRunRepository } from "./storage/RunRepository.js";
import { JsonlPaperJournal } from "./storage/PaperJournal.js";
import { NoopStrategySkill } from "./strategy/NoopStrategySkill.js";
import { MomentumStrategySkill } from "./strategy/MomentumStrategySkill.js";
import { inspect, settlePaperJournal, tick } from "./app.js";

function makeDependencies(config: AppConfig) {
  return {
    cmc: new StubCmcAdapter(),
    pyth: new HistoryPythAdapter(config),
    predictFun: new RestPredictFunAdapter(config),
    twak: new EnvTrustWalletAgentKitAdapter(config),
    strategy:
      config.strategySkill === "momentum"
        ? new MomentumStrategySkill({
            minEdge: config.strategyMinEdge,
            candleStartToleranceSeconds: config.strategyCandleStartToleranceSeconds
          })
        : new NoopStrategySkill(),
    repository: new NoopSqliteRunRepository(config.databasePath),
    paperJournal: new JsonlPaperJournal(config.paperJournalPath)
  };
}

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) => (nestedValue instanceof Date ? nestedValue.toISOString() : nestedValue),
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

  if (command === "tick") {
    const mode = runModeSchema.parse(config.runMode);
    console.log(safeJson(await tick(config, dependencies, mode)));
    return;
  }

  if (command === "settle-paper") {
    console.log(safeJson(await settlePaperJournal(config, dependencies)));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
