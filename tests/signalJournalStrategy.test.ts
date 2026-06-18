import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MarketPricing, SelectedBtcFiveMinuteMarket } from "../src/domain/types.js";
import { SignalJournalStrategySkill } from "../src/strategy/SignalJournalStrategySkill.js";
import type { StrategyContext } from "../src/strategy/StrategySkill.js";

const now = new Date("2026-06-18T12:00:05.000Z");

function selectedMarket(overrides: Partial<SelectedBtcFiveMinuteMarket> = {}): SelectedBtcFiveMinuteMarket {
  const startsAt = new Date("2026-06-18T12:00:00.000Z");
  const closesAt = new Date("2026-06-18T12:05:00.000Z");
  return {
    id: "511762",
    categorySlug: "btc-updown-5m-1781784000",
    startsAt,
    closesAt,
    timeRemainingSeconds: 295,
    market: {
      id: "511762",
      venue: "predict.fun",
      asset: "BTC",
      intervalMinutes: 5,
      directions: ["UP", "DOWN"],
      startsAt,
      closesAt,
      resolvesAt: closesAt,
      status: "open"
    },
    ...overrides
  };
}

function pricing(overrides: Partial<MarketPricing> = {}): MarketPricing {
  return {
    marketId: "511762",
    capturedAt: now,
    source: "predict.fun",
    status: "available",
    up: { bestBid: 0.44, bestAsk: 0.47 },
    down: { bestBid: 0.49, bestAsk: 0.52 },
    spread: 0.03,
    ...overrides
  };
}

function context(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    runMode: "paper",
    macro: { capturedAt: now, source: "coinmarketcap", stubbed: true },
    candle: { capturedAt: now, source: "pyth-pro", symbol: "BTC", intervalMinutes: 5, stubbed: true },
    markets: [],
    selectedMarket: selectedMarket(),
    pricing: pricing(),
    ...overrides
  };
}

function signalRow(overrides: Record<string, unknown> = {}) {
  return {
    captured_at: "2026-06-18T12:00:00.000Z",
    status: "signals",
    reason: null,
    market: {},
    pricing: {},
    safety: { signing: false, broadcasting: false },
    signals: [
      {
        action: "enter",
        marketId: "511762",
        direction: "DOWN",
        notionalUsd: 0.5,
        strategy: "competition_ev_direction_ensemble_20260618",
        predictedProfitProbability: 0.61,
        evEdge: 0.09,
        directionEdge: 0.24,
        directionProbability: 0.73,
        rawAskPrice: 0.5,
        paperFillPrice: 0.5,
        thresholds: { minProfitabilityProbability: 0.45, entryAskMax: 0.55, nestedIgnored: { value: true } },
        signalTiming: { elapsedSeconds: 91, label: "early", nestedIgnored: { value: true } }
      }
    ],
    ...overrides
  };
}

function withJournal(line: unknown, test: (journalPath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "strike-bot-signal-journal-"));
  const journalPath = join(dir, "signals.jsonl");
  writeFileSync(journalPath, `\n${JSON.stringify({ status: "no_trade", signals: [] })}\n${JSON.stringify(line)}\n`);
  return test(journalPath).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe("SignalJournalStrategySkill", () => {
  it("emits enter for a matching latest signal row with production-minimum notional and metadata", async () => {
    await withJournal(signalRow(), async (journalPath) => {
      const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 1 }, () => now);

      const decision = await strategy.decide(context());

      expect(decision).toMatchObject({
        action: "enter",
        marketId: "511762",
        direction: "DOWN",
        notionalUsd: 1,
        runMode: "paper"
      });
      expect(decision.metadata).toMatchObject({
        strategyName: "competition_ev_direction_ensemble_20260618",
        sourceCapturedAt: "2026-06-18T12:00:00.000Z",
        signalAgeSeconds: 5,
        predictedProfitProbability: 0.61,
        evEdge: 0.09,
        directionEdge: 0.24,
        directionProbability: 0.73,
        rawAskPrice: 0.5,
        currentAskPrice: 0.52,
        signalTiming: { elapsedSeconds: 91, label: "early" },
        thresholds: { minProfitabilityProbability: 0.45, entryAskMax: 0.55 }
      });
    });
  });

  it("emits the configured cap when the cap is below the production minimum", async () => {
    await withJournal(signalRow(), async (journalPath) => {
      const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 0.5 }, () => now);

      const decision = await strategy.decide(context());

      expect(decision).toMatchObject({
        action: "enter",
        notionalUsd: 0.5
      });
    });
  });

  it("returns no_trade for a stale latest signal row", async () => {
    await withJournal(signalRow({ captured_at: "2026-06-18T11:59:00.000Z" }), async (journalPath) => {
      const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 0.05 }, () => now);

      const decision = await strategy.decide(context());

      expect(decision).toMatchObject({
        action: "no_trade",
        reason: "signal_not_triggered",
        marketId: "511762"
      });
      expect(decision.metadata).toMatchObject({ signalAgeSeconds: 65 });
    });
  });

  it("returns no_trade for a latest no_trade journal row", async () => {
    await withJournal(
      {
        captured_at: "2026-06-18T12:00:03.000Z",
        status: "no_trade",
        reason: "no_strategy_signal",
        signals: [],
        safety: { signing: false, broadcasting: false }
      },
      async (journalPath) => {
        const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 0.05 }, () => now);

        const decision = await strategy.decide(context());

        expect(decision).toMatchObject({
          action: "no_trade",
          reason: "signal_not_triggered",
          marketId: "511762"
        });
      }
    );
  });

  it("returns no_trade when the signal market differs from the selected market", async () => {
    await withJournal(signalRow(), async (journalPath) => {
      const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 0.05 }, () => now);

      const decision = await strategy.decide(context({ selectedMarket: selectedMarket({ id: "other-market" }) }));

      expect(decision).toMatchObject({
        action: "no_trade",
        reason: "market_not_supported",
        marketId: "other-market"
      });
    });
  });

  it("returns no_trade when current ask is materially worse than the signal raw ask", async () => {
    await withJournal(signalRow(), async (journalPath) => {
      const strategy = new SignalJournalStrategySkill({ journalPath, maxAgeSeconds: 10, notionalUsd: 0.05 }, () => now);

      const decision = await strategy.decide(context({ pricing: pricing({ down: { bestBid: 0.52, bestAsk: 0.54 } }) }));

      expect(decision).toMatchObject({
        action: "no_trade",
        reason: "price_above_threshold",
        marketId: "511762"
      });
      expect(decision.metadata).toMatchObject({ rawAskPrice: 0.5, currentAskPrice: 0.54 });
    });
  });
});
