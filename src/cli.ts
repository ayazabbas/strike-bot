import { readFileSync } from "node:fs";
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
import { loadAttemptedMarketIds, saveAttemptedMarketIds, tryClaimMarketAttempt } from "./storage/MarketAttemptStore.js";
import { PredictFunOrderExecutor } from "./execution/PredictFunOrderExecutor.js";
import { NoopStrategySkill } from "./strategy/NoopStrategySkill.js";
import { MomentumStrategySkill } from "./strategy/MomentumStrategySkill.js";
import { SignalJournalStrategySkill } from "./strategy/SignalJournalStrategySkill.js";
import { ModelStrategySkill } from "./strategy/ModelStrategySkill.js";
import { selectNearestTradableBtcFiveMinuteMarket } from "./domain/marketFilter.js";
import { RiskManager } from "./risk/RiskManager.js";
import type { BtcCandleMetadata, MacroSnapshot, MarketPricing, SelectedBtcFiveMinuteMarket } from "./domain/types.js";
import { LocalPythonInferenceClient } from "./inference/LocalPythonInferenceClient.js";
import { buildModelInferenceRequest } from "./inference/buildModelInferenceRequest.js";
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
  const modelInferenceClient = config.modelInferenceEndpointUrl
    ? new LocalPythonInferenceClient({
        endpointUrl: config.modelInferenceEndpointUrl,
        timeoutMs: config.modelInferenceTimeoutMs
      })
    : undefined;
  return {
    cmc: new RestCmcAdapter(config),
    pyth: new HistoryPythAdapter(config),
    predictFun: new RestPredictFunAdapter(config),
    predictFunAuth: new RestPredictFunAuthAdapter(config, new PredictFunSdkAuthSigner(config)),
    predictFunExecutionWallet: new FilePredictFunExecutionWalletAdapter(config),
    twak: new EnvTrustWalletAgentKitAdapter(config),
    strategy: makeStrategy(config, modelInferenceClient),
    repository: new NoopSqliteRunRepository(config.databasePath),
    paperJournal: new JsonlPaperJournal(config.paperJournalPath),
    predictFunOrderExecutor: new PredictFunOrderExecutor(config),
    predictFunPositions: new RestPredictFunPositionsAdapter(config),
    modelInferenceClient
  };
}

function makeStrategy(config: AppConfig, modelInferenceClient?: LocalPythonInferenceClient) {
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

  if (config.strategySkill === "model") {
    return new ModelStrategySkill(modelInferenceClient, {
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

interface HotMarketState {
  selected?: SelectedBtcFiveMinuteMarket;
  pricing?: MarketPricing;
  macro?: MacroSnapshot;
  candle?: BtcCandleMetadata;
  updatedAt?: Date;
  refreshInFlight?: Promise<void>;
}

async function refreshHotMarketState(config: AppConfig, dependencies: ReturnType<typeof makeDependencies>, state: HotMarketState): Promise<void> {
  const [marketSnapshot, macro, candle] = dependencies.modelInferenceClient
    ? await Promise.all([
        dependencies.predictFun.listMarkets(),
        dependencies.cmc.getMacroSnapshot(),
        dependencies.pyth.getBtcFiveMinuteCandleMetadata()
      ])
    : [await dependencies.predictFun.listMarkets(), undefined, undefined];
  const selected = selectNearestTradableBtcFiveMinuteMarket(marketSnapshot.markets, {
    minSecondsBeforeClose: config.predictFunMinSecondsBeforeClose
  });
  state.selected = selected;
  state.pricing = selected ? await dependencies.predictFun.getOrderbookPricing(selected.id) : undefined;
  state.macro = macro;
  state.candle = candle;
  state.updatedAt = new Date();
}

function maybeRefreshHotMarketState(config: AppConfig, dependencies: ReturnType<typeof makeDependencies>, state: HotMarketState): void {
  const maxAgeMs = Number(process.env.STRIKE_BOT_HOT_STATE_MAX_AGE_MS ?? "750");
  const ageMs = state.updatedAt ? Date.now() - state.updatedAt.getTime() : Number.POSITIVE_INFINITY;
  if (state.refreshInFlight || ageMs < maxAgeMs) {
    return;
  }
  state.refreshInFlight = refreshHotMarketState(config, dependencies, state)
    .catch((error: unknown) => {
      emitJsonLine({ event: "hot_state_refresh_failed", error: error instanceof Error ? error.message : String(error), ts: new Date() });
    })
    .finally(() => {
      state.refreshInFlight = undefined;
    });
}

async function executeHotSignal(
  config: AppConfig,
  dependencies: ReturnType<typeof makeDependencies>,
  hotState: HotMarketState,
  beforeEnter?: (marketId: string) => boolean | Promise<boolean>
) {
  if (hotState.refreshInFlight) {
    await hotState.refreshInFlight;
  }
  if (!hotState.selected || !hotState.pricing) {
    throw new Error("hot_state_unavailable");
  }
  const now = new Date();
  const decision = await dependencies.strategy.decide({
    runMode: "live",
    macro: hotState.macro ?? { capturedAt: now, source: "coinmarketcap", stubbed: true },
    candle: hotState.candle ?? { capturedAt: now, source: "pyth-pro", symbol: "BTC", intervalMinutes: 1, stubbed: true },
    markets: [hotState.selected.market],
    selectedMarket: hotState.selected,
    pricing: hotState.pricing
  });
  const risk = new RiskManager(config).evaluate(decision);
  const blockedDecision =
    !risk.approved && decision.action === "enter"
      ? {
          action: "no_trade" as const,
          reason: "risk_rejected" as const,
          marketId: decision.marketId,
          runMode: "live" as const,
          createdAt: new Date()
        }
      : decision;
  if (blockedDecision.action === "enter") {
    const claimed = await beforeEnter?.(blockedDecision.marketId);
    if (claimed === false) {
      const duplicateDecision = {
        action: "no_trade" as const,
        reason: "duplicate_market_attempt" as const,
        marketId: blockedDecision.marketId,
        runMode: "live" as const,
        createdAt: new Date(),
        metadata: blockedDecision.metadata
      };
      const execution = await dependencies.predictFunOrderExecutor.execute(duplicateDecision, "live", {
        selectedMarket: hotState.selected.market,
        pricing: hotState.pricing,
        risk
      });
      return {
        decision: duplicateDecision,
        risk,
        execution,
        market: { id: hotState.selected.id, categorySlug: hotState.selected.categorySlug, stateAgeMs: hotState.updatedAt ? Date.now() - hotState.updatedAt.getTime() : undefined },
        safety: { signing: false, broadcasting: false }
      };
    }
  }
  const execution = await dependencies.predictFunOrderExecutor.execute(blockedDecision, "live", {
    selectedMarket: hotState.selected.market,
    pricing: hotState.pricing,
    risk
  });
  return {
    decision,
    risk,
    execution,
    market: { id: hotState.selected.id, categorySlug: hotState.selected.categorySlug, stateAgeMs: hotState.updatedAt ? Date.now() - hotState.updatedAt.getTime() : undefined },
    safety: {
      signing: blockedDecision.action === "enter" && (execution.status === "prepared_not_broadcast" || execution.status === "broadcast"),
      broadcasting: execution.broadcast
    }
  };
}

async function inferHotMarketState(
  dependencies: ReturnType<typeof makeDependencies>,
  hotState: HotMarketState,
  runMode: "live",
  requestId: string
): Promise<void> {
  if (!dependencies.modelInferenceClient || !hotState.macro || !hotState.candle) {
    return;
  }

  const request = buildModelInferenceRequest({
    requestId,
    capturedAt: new Date(),
    runMode,
    selectedMarket: hotState.selected,
    pricing: hotState.pricing,
    macro: hotState.macro,
    candle: hotState.candle
  });
  if (!request) {
    emitJsonLine({ event: "model_inference_skipped", reason: "request_unavailable", requestId, ts: new Date() });
    return;
  }

  const result = await dependencies.modelInferenceClient.infer(request);
  emitJsonLine({
    event: "model_inference_result",
    requestId,
    status: result.status,
    modelVersion: result.status === "ok" ? result.modelVersion : undefined,
    reason: result.status === "unavailable" ? result.reason : undefined,
    candidates: result.status === "ok" ? result.candidates : undefined,
    ts: new Date()
  });
}

async function runLiveRunner(config: AppConfig, dependencies: ReturnType<typeof makeDependencies>): Promise<void> {
  const pollMs = Number(process.env.STRIKE_BOT_LIVE_RUNNER_POLL_MS ?? "250");
  const statePath = process.env.STRIKE_BOT_LIVE_RUNNER_STATE ?? "data/live-runner/attempted-markets.json";
  const attempted = loadAttemptedMarketIds(statePath);
  const hotState: HotMarketState = {};
  const modelDriven = dependencies.strategy.name === "ModelStrategySkill";
  emitJsonLine({
    event: "runner_start",
    mode: modelDriven ? "node_hot_model_live_runner" : "node_hot_live_runner",
    pollMs,
    journal: modelDriven ? undefined : config.strategySignalJournalPath,
    state: statePath,
    strategy: dependencies.strategy.name,
    ts: new Date()
  });
  const readiness = await liveReadiness(config, dependencies);
  emitJsonLine({ event: "preflight", ready: readiness.summary.ready, blockers: readiness.summary.blockers, warnings: readiness.summary.warnings, ts: new Date() });
  if (!readiness.summary.ready) {
    throw new Error("live_runner_preflight_failed");
  }
  await refreshHotMarketState(config, dependencies, hotState);
  emitJsonLine({ event: "hot_state_ready", marketId: hotState.selected?.id, pricingStatus: hotState.pricing?.status, ts: new Date() });
  for (;;) {
    maybeRefreshHotMarketState(config, dependencies, hotState);
    if (modelDriven) {
      try {
        if (hotState.refreshInFlight) {
          await hotState.refreshInFlight;
        }
        const hotMarketId = hotState.selected?.id;
        if (hotMarketId && !attempted.has(hotMarketId)) {
          const result = await executeHotSignal(config, dependencies, hotState, (marketId) => {
            const claimed = tryClaimMarketAttempt(statePath, marketId);
            if (claimed) {
              attempted.add(marketId);
            }
            return claimed;
          });
          emitJsonLine({
            event: "model_live_tick_result",
            hotMarket: result.market,
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
      } catch (error) {
        emitJsonLine({ event: "model_live_tick_failed", error: error instanceof Error ? error.message : String(error), ts: new Date() });
      }
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 250));
      continue;
    }
    const candidate = readLatestSignalCandidate(config.strategySignalJournalPath, config.strategySignalMaxAgeSeconds);
    if (candidate && !attempted.has(candidate.marketId)) {
      attempted.add(candidate.marketId);
      saveAttemptedMarketIds(statePath, attempted);
      emitJsonLine({ event: "live_tick_attempt", ...candidate, hotMarketId: hotState.selected?.id, hotStateAgeMs: hotState.updatedAt ? Date.now() - hotState.updatedAt.getTime() : undefined, ts: new Date() });
      try {
        await inferHotMarketState(dependencies, hotState, "live", `live-runner-${Date.now()}`);
        const result = await executeHotSignal(config, dependencies, hotState);
        emitJsonLine({
          event: "live_tick_result",
          marketId: candidate.marketId,
          hotMarket: result.market,
          decisionAction: result.decision.action,
          decisionReason: "reason" in result.decision ? result.decision.reason : undefined,
          executionStatus: result.execution.status,
          executionReason: "reason" in result.execution ? result.execution.reason : undefined,
          broadcast: result.execution.broadcast,
          safety: result.safety,
          details: "details" in result.execution ? result.execution.details : undefined,
          ts: new Date()
        });
      } catch (error) {
        emitJsonLine({ event: "live_tick_failed", marketId: candidate.marketId, error: error instanceof Error ? error.message : String(error), ts: new Date() });
      }
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
