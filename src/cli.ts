import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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
import { SignalJournalStrategySkill } from "./strategy/SignalJournalStrategySkill.js";
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
    strategy: makeStrategy(config),
    repository: new NoopSqliteRunRepository(config.databasePath),
    paperJournal: new JsonlPaperJournal(config.paperJournalPath),
    predictFunOrderExecutor: new PredictFunOrderExecutor(config),
    predictFunPositions: new RestPredictFunPositionsAdapter(config)
  };
}

function makeStrategy(config: AppConfig) {
  if (config.strategySkill === "momentum") {
    return new MomentumStrategySkill({
      ...(config.strategyDynamicEdgeEnabled ? {} : { minEdge: config.strategyMinEdge }),
      notionalUsd: config.strategyNotionalUsd,
      candleStartToleranceSeconds: config.strategyCandleStartToleranceSeconds
    });
  }

  if (config.strategySkill === "signal") {
    return new SignalJournalStrategySkill({
      journalPath: config.strategySignalJournalPath,
      maxAgeSeconds: config.strategySignalMaxAgeSeconds,
      notionalUsd: config.strategyNotionalUsd
    });
  }

  return new NoopStrategySkill();
}

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nestedValue) =>
      nestedValue instanceof Date ? nestedValue.toISOString() : typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    2
  );
}

interface LiveRunnerState {
  readonly attemptedMarketIds?: readonly string[];
}

function emitJsonLine(value: unknown): void {
  console.log(JSON.stringify(value, (_key, nestedValue) => (nestedValue instanceof Date ? nestedValue.toISOString() : nestedValue)));
}

function readLatestSignalCandidate(journalPath: string, maxAgeSeconds: number): { marketId: string; ageSeconds: number; capturedAt: string } | undefined {
  let contents: string;
  try {
    contents = readFileSync(journalPath, "utf8");
  } catch {
    return undefined;
  }
  const now = Date.now();
  const lines = contents.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const row = parsed as Record<string, unknown>;
    const capturedAt = typeof row.captured_at === "string" ? row.captured_at : undefined;
    if (!capturedAt) {
      continue;
    }
    const ageSeconds = (now - new Date(capturedAt).getTime()) / 1000;
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
      continue;
    }
    if (row.status !== "signals") {
      continue;
    }
    const signals = Array.isArray(row.signals) ? row.signals : [];
    const first = signals[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      continue;
    }
    const signal = first as Record<string, unknown>;
    if (signal.action !== "enter" || typeof signal.marketId !== "string") {
      continue;
    }
    return { marketId: signal.marketId, ageSeconds: Math.round(ageSeconds * 1000) / 1000, capturedAt };
  }
  return undefined;
}

function loadAttempted(path: string): Set<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LiveRunnerState;
    return new Set((parsed.attemptedMarketIds ?? []).map(String));
  } catch {
    return new Set();
  }
}

function saveAttempted(path: string, attempted: Set<string>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ attemptedMarketIds: Array.from(attempted).sort() }, null, 2));
}

async function runLiveRunner(config: AppConfig, dependencies: ReturnType<typeof makeDependencies>): Promise<void> {
  const pollMs = Number(process.env.STRIKE_BOT_LIVE_RUNNER_POLL_MS ?? "250");
  const statePath = process.env.STRIKE_BOT_LIVE_RUNNER_STATE ?? "data/live-runner/attempted-markets.json";
  const attempted = loadAttempted(statePath);
  emitJsonLine({ event: "runner_start", mode: "node_live_runner", pollMs, journal: config.strategySignalJournalPath, state: statePath, ts: new Date() });
  const readiness = await liveReadiness(config, dependencies);
  emitJsonLine({ event: "preflight", ready: readiness.summary.ready, blockers: readiness.summary.blockers, warnings: readiness.summary.warnings, ts: new Date() });
  if (!readiness.summary.ready) {
    throw new Error("live_runner_preflight_failed");
  }
  for (;;) {
    const candidate = readLatestSignalCandidate(config.strategySignalJournalPath, config.strategySignalMaxAgeSeconds);
    if (candidate && !attempted.has(candidate.marketId)) {
      attempted.add(candidate.marketId);
      saveAttempted(statePath, attempted);
      emitJsonLine({ event: "live_tick_attempt", ...candidate, ts: new Date() });
      const result = await tick(config, dependencies, "live");
      emitJsonLine({
        event: "live_tick_result",
        marketId: candidate.marketId,
        decisionAction: result.decision.action,
        decisionReason: "reason" in result.decision ? result.decision.reason : undefined,
        executionStatus: result.execution.status,
        executionReason: "reason" in result.execution ? result.execution.reason : undefined,
        broadcast: result.execution.broadcast,
        safety: result.safety,
        details: "details" in result.execution ? result.execution.details : undefined,
        ts: new Date()
      });
    }
    await new Promise((resolve) => setTimeout(resolve, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 250));
  }
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

  if (command === "live-runner") {
    await runLiveRunner(config, dependencies);
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
