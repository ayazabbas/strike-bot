import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPaperTradeRecord, enrichPaperJournalSettlements, JsonlPaperJournal } from "../src/storage/PaperJournal.js";
import type { PredictFunAdapter } from "../src/adapters/PredictFunAdapter.js";
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

  it("atomically enriches eligible enter rows with official resolved settlement economics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-paper-"));
    const journalPath = join(dir, "trades.jsonl");
    const winningRow = buildPaperTradeRecord(context());
    const losingRow = {
      ...buildPaperTradeRecord(context()),
      runId: "run-2",
      market: { ...winningRow.market, id: "472572" },
      decision: { ...winningRow.decision, marketId: "472572", direction: "DOWN" },
      execution: {
        ...winningRow.execution,
        fill: { ...winningRow.execution.fill, direction: "DOWN", price: 0.24, quantity: 4.166667 }
      }
    };
    const noTradeRow = {
      ...buildPaperTradeRecord(context()),
      runId: "run-3",
      decision: { ...winningRow.decision, action: "no_trade", reason: "signal_not_triggered" }
    };
    const alreadyResolvedRow = {
      ...buildPaperTradeRecord(context()),
      runId: "run-4",
      settlement: { ...winningRow.settlement, status: "resolved", winningDirection: "UP" }
    };
    const originalNoTradeSettlement = noTradeRow.settlement;
    const originalResolvedSettlement = alreadyResolvedRow.settlement;

    try {
      writeFileSync(
        journalPath,
        [
          JSON.stringify(winningRow),
          "not-json",
          JSON.stringify(losingRow),
          JSON.stringify(noTradeRow),
          JSON.stringify(alreadyResolvedRow)
        ].join("\n") + "\n",
        "utf8"
      );

      const calls: string[] = [];
      const result = await enrichPaperJournalSettlements(journalPath, fakeSettlementAdapter(calls));

      expect(result).toEqual({
        path: journalPath,
        scannedRows: 5,
        eligibleRows: 2,
        updatedRows: 2
      });
      expect(calls).toEqual(["472571", "472572"]);

      const lines = readFileSync(journalPath, "utf8").trimEnd().split("\n");
      expect(lines[1]).toBe("not-json");
      const enrichedWin = JSON.parse(lines[0]);
      const enrichedLoss = JSON.parse(lines[2]);
      const preservedNoTrade = JSON.parse(lines[3]);
      const preservedResolved = JSON.parse(lines[4]);

      expect(enrichedWin.settlement).toMatchObject({
        status: "resolved",
        checkedAt: "2026-06-13T12:06:00.000Z",
        resolvedAt: "2026-06-13T12:05:00.000Z",
        winningDirection: "UP",
        payoutUsd: 1.315789,
        pnlUsd: 0.315789
      });
      expect(enrichedLoss.settlement).toMatchObject({
        status: "resolved",
        winningDirection: "UP",
        payoutUsd: 0,
        pnlUsd: -1
      });
      expect(preservedNoTrade.settlement).toEqual(originalNoTradeSettlement);
      expect(preservedResolved.settlement).toEqual(originalResolvedSettlement);
      expect({ ...enrichedWin, settlement: winningRow.settlement }).toEqual(winningRow);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fakeSettlementAdapter(calls: string[]): PredictFunAdapter {
  return {
    async listMarkets() {
      return { capturedAt: now, markets: [] };
    },
    async getOrderbookPricing(marketId: string) {
      return {
        marketId,
        capturedAt: now,
        source: "predict.fun",
        status: "unknown",
        up: {},
        down: {}
      };
    },
    async getMarketSettlement(marketId: string) {
      calls.push(marketId);
      return {
        marketId,
        capturedAt: new Date("2026-06-13T12:06:00.000Z"),
        source: "predict.fun",
        status: "resolved",
        winningDirection: "UP"
      };
    }
  };
}
