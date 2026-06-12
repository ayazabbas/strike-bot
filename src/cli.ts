import { loadConfig, runModeSchema, type AppConfig } from "./config.js";
import { StubCmcAdapter } from "./adapters/CmcAdapter.js";
import { StubPredictFunAdapter } from "./adapters/PredictFunAdapter.js";
import { StubPythAdapter } from "./adapters/PythAdapter.js";
import { StubTrustWalletAgentKitAdapter } from "./adapters/TrustWalletAgentKitAdapter.js";
import { NoopSqliteRunRepository } from "./storage/RunRepository.js";
import { NoopStrategySkill } from "./strategy/NoopStrategySkill.js";
import { inspect, tick } from "./app.js";

function makeDependencies(config: AppConfig) {
  return {
    cmc: new StubCmcAdapter(),
    pyth: new StubPythAdapter(),
    predictFun: new StubPredictFunAdapter(),
    twak: new StubTrustWalletAgentKitAdapter(config),
    strategy: new NoopStrategySkill(),
    repository: new NoopSqliteRunRepository(config.databasePath)
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

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
