import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { tick } from "../src/app.js";
import type { AppDependencies } from "../src/app.js";
import type { PaperJournalContext } from "../src/storage/PaperJournal.js";
import type { RunMode } from "../src/config.js";
import type { ExecutionResult, MarketSnapshot, StrategyDecision } from "../src/domain/types.js";

function dependencies(mode: RunMode, journalRecords: PaperJournalContext[]): AppDependencies {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 2 * 60 * 1000);
  const closesAt = new Date(now.getTime() + 3 * 60 * 1000);
  const marketSnapshot: MarketSnapshot = {
    capturedAt: now,
    markets: [
      {
        id: "472571",
        venue: "predict.fun",
        asset: "BTC",
        intervalMinutes: 5,
        directions: ["UP", "DOWN"],
        categorySlug: "btc-updown-5m-current",
        startsAt,
        closesAt,
        resolvesAt: new Date(closesAt.getTime() + 60_000),
        status: "open"
      }
    ]
  };

  return {
    cmc: {
      async getMacroSnapshot() {
        return { capturedAt: now, source: "coinmarketcap" as const, stubbed: true };
      }
    },
    pyth: {
      async getBtcFiveMinuteCandleMetadata() {
        return {
          capturedAt: now,
          source: "pyth-pro" as const,
          symbol: "BTC" as const,
          intervalMinutes: 5 as const,
          latestCandleOpenTime: startsAt,
          latestCandle: { openTime: startsAt, open: 100, high: 103, low: 99, close: 102 },
          stubbed: false
        };
      }
    },
    predictFun: {
      async listMarkets() {
        return marketSnapshot;
      },
      async getOrderbookPricing(marketId: string) {
        return {
          marketId,
          capturedAt: now,
          source: "predict.fun" as const,
          status: "available" as const,
          up: { bestBid: 0.7, bestAsk: 0.76, impliedProbability: 0.73 },
          down: { bestBid: 0.2, bestAsk: 0.24, impliedProbability: 0.22 },
          spread: 0.04
        };
      }
    },
    twak: {
      async checkReadiness() {
        return { enabled: true, ready: false, reasons: ["twak_credentials_missing"] };
      }
    },
    strategy: {
      name: "TestStrategy",
      async decide() {
        return {
          action: "no_trade",
          reason: "signal_not_triggered",
          marketId: "472571",
          runMode: mode,
          createdAt: now,
          metadata: { strategyName: "TestStrategy" }
        } satisfies StrategyDecision;
      }
    },
    repository: {
      async init() {
        return;
      },
      async createRun() {
        return { id: `run-${mode}`, mode, startedAt: now };
      },
      async recordMarketSnapshot() {
        return;
      },
      async recordDecision() {
        return;
      },
      async recordExecution(_runId: string, _result: ExecutionResult) {
        return;
      }
    },
    paperJournal: {
      async append(context: PaperJournalContext) {
        journalRecords.push(context);
      }
    }
  };
}

describe("tick paper journal", () => {
  it("appends one paper journal record per paper tick", async () => {
    const records: PaperJournalContext[] = [];
    await tick(loadConfig({ RUN_MODE: "paper" }), dependencies("paper", records), "paper");

    expect(records).toHaveLength(1);
    expect(records[0].mode).toBe("paper");
    expect(records[0].selectedMarket?.id).toBe("472571");
    expect(records[0].execution.status).toBe("skipped");
  });

  it("does not append paper journal records for dry-run ticks", async () => {
    const records: PaperJournalContext[] = [];
    await tick(loadConfig({ RUN_MODE: "dry_run" }), dependencies("dry_run", records), "dry_run");

    expect(records).toHaveLength(0);
  });
});
