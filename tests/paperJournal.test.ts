import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPaperTradeRecord, JsonlPaperJournal } from "../src/storage/PaperJournal.js";
import type { PaperJournalContext } from "../src/storage/PaperJournal.js";

const now = new Date("2026-06-13T12:02:00.000Z");
const startsAt = new Date("2026-06-13T12:00:00.000Z");
const closesAt = new Date("2026-06-13T12:05:00.000Z");

function context(): PaperJournalContext {
  const decision = {
    action: "enter" as const,
    marketId: "472571",
    direction: "UP" as const,
    notionalUsd: 1,
    runMode: "paper" as const,
    createdAt: now,
    metadata: {
      strategyName: "MomentumStrategySkill",
      triggerName: "momentum_continuation",
      fairThreshold: 0.8248,
      maxAcceptableAsk: 0.7748,
      askPrice: 0.76,
      edge: 0.0648,
      elapsedMinutes: 2,
      partialReturnBps: 200,
      closeLocation: 0.75
    }
  };

  return {
    run: { id: "run-1", mode: "paper", startedAt: now },
    mode: "paper",
    strategyName: "MomentumStrategySkill",
    selectedMarket: {
      id: "472571",
      categorySlug: "btc-updown-5m-1781352000",
      startsAt,
      closesAt,
      timeRemainingSeconds: 180,
      market: {
        id: "472571",
        venue: "predict.fun",
        asset: "BTC",
        intervalMinutes: 5,
        directions: ["UP", "DOWN"],
        startsAt,
        closesAt,
        resolvesAt: closesAt,
        status: "open"
      }
    },
    pricing: {
      marketId: "472571",
      capturedAt: now,
      source: "predict.fun",
      status: "available",
      up: { bestBid: 0.7, bestAsk: 0.76, impliedProbability: 0.73 },
      down: { bestBid: 0.2, bestAsk: 0.24, impliedProbability: 0.22 },
      spread: 0.04
    },
    candle: {
      capturedAt: now,
      source: "pyth-pro",
      symbol: "BTC",
      intervalMinutes: 5,
      latestCandleOpenTime: startsAt,
      latestCandle: { openTime: startsAt, open: 100, high: 103, low: 99, close: 102 },
      stubbed: false
    },
    decision,
    risk: { approved: true, reasons: [] },
    execution: {
      mode: "paper",
      broadcast: false,
      status: "paper_recorded",
      decision
    },
    safety: { signing: false, broadcasting: false }
  };
}

describe("PaperJournal", () => {
  it("builds a stable consumable paper trade record", () => {
    const record = buildPaperTradeRecord(context());

    expect(record).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
      timestamp: "2026-06-13T12:02:00.000Z",
      mode: "paper",
      strategy: "MomentumStrategySkill",
      market: {
        id: "472571",
        slug: "btc-updown-5m-1781352000",
        category: "btc-5m-up-down",
        startsAt: "2026-06-13T12:00:00.000Z",
        closesAt: "2026-06-13T12:05:00.000Z",
        secondsRemaining: 180
      },
      selectedOutcome: { direction: "UP" },
      decision: { action: "enter", reason: null, notionalUsd: 1 },
      pricing: {
        up: { bid: 0.7, ask: 0.76, implied: 0.73 },
        down: { bid: 0.2, ask: 0.24, implied: 0.22 },
        spread: 0.04
      },
      strategyMetadata: {
        triggerName: "momentum_continuation",
        fairThreshold: 0.8248,
        maxAcceptableAsk: 0.7748,
        askPrice: 0.76,
        edge: 0.0648,
        elapsedMinutes: 2,
        partialReturnBps: 200,
        closeLocation: 0.75
      },
      pythCandle: {
        timestamp: "2026-06-13T12:00:00.000Z",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        stubbed: false
      },
      safety: { signing: false, broadcasting: false },
      execution: {
        status: "paper_recorded",
        broadcast: false,
        simulated: true,
        fill: {
          status: "filled",
          direction: "UP",
          price: 0.76,
          notionalUsd: 1,
          quantity: 1.315789
        }
      },
      settlement: {
        status: "unknown",
        checkedAt: null,
        resolvedAt: null,
        winningDirection: null,
        payoutUsd: null,
        pnlUsd: null
      }
    });
  });

  it("appends one JSON object per line and creates parent directories", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-paper-"));
    const journalPath = join(dir, "nested", "trades.jsonl");

    try {
      const journal = new JsonlPaperJournal(journalPath);
      await journal.append(context());
      await journal.append(context());

      expect(existsSync(journalPath)).toBe(true);
      const lines = readFileSync(journalPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).runId).toBe("run-1");
      expect(JSON.parse(lines[1]).schemaVersion).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
