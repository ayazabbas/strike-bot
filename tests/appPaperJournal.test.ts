import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { inspect, settlePaperJournal, tick } from "../src/app.js";
import type { AppDependencies } from "../src/app.js";
import type { PaperJournalContext } from "../src/storage/PaperJournal.js";
import type { RunMode } from "../src/config.js";
import type { ExecutionResult, MarketSnapshot, StrategyDecision } from "../src/domain/types.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
      },
      async getMarketSettlement(marketId: string) {
        return {
          marketId,
          capturedAt: now,
          source: "predict.fun" as const,
          status: "unknown" as const,
          winningDirection: null
        };
      }
    },
    predictFunExecutionWallet: {
      async getStatus() {
        return {
          configured: true,
          address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
          keyFile: "/tmp/predict-privy-key",
          signing: false,
          broadcasting: false,
          reasons: []
        };
      }
    },
    twak: {
      async checkReadiness() {
        return {
          enabled: true,
          ready: false,
          credentialsCliRpcReady: false,
          agentWalletConfigured: false,
          agentWalletPasswordAvailable: false,
          address: null,
          reasons: ["twak_credentials_missing"]
        };
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
  it("includes separated execution and TWAK funding wallet status in inspect output", async () => {
    const records: PaperJournalContext[] = [];
    const result = await inspect(loadConfig({}), dependencies("inspect", records));

    expect(result.funding).toMatchObject({
      predictFunExecutionAddress: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
      predictFunExecutionWallet: {
        configured: true,
        signing: false,
        broadcasting: false
      },
      twakFundingWallet: {
        ready: false,
        credentialsCliRpcReady: false,
        agentWalletConfigured: false,
        agentWalletPasswordAvailable: false,
        address: null
      }
    });
    expect(result.safety).toEqual({ signing: false, broadcasting: false });
  });

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

  it("settles the configured paper journal path through the app wrapper", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-app-paper-"));
    const journalPath = join(dir, "paper.jsonl");

    try {
      writeFileSync(
        journalPath,
        `${JSON.stringify({
          decision: { action: "enter", marketId: "472571", direction: "UP", notionalUsd: 2 },
          market: { id: "472571", resolvesAt: "2026-06-13T12:05:00.000Z" },
          pricing: { up: { ask: 0.5 } },
          execution: { fill: { direction: "UP", price: 0.5, notionalUsd: 2 } },
          settlement: { status: "unknown" }
        })}\n`,
        "utf8"
      );

      const result = await settlePaperJournal(
        loadConfig({ PAPER_JOURNAL_PATH: journalPath, PREDICT_FUN_API_KEY: "test-key" }),
        {
          predictFun: {
            async listMarkets() {
              return { capturedAt: new Date(), markets: [] };
            },
            async getOrderbookPricing(marketId: string) {
              return {
                marketId,
                capturedAt: new Date(),
                source: "predict.fun" as const,
                status: "unknown" as const,
                up: {},
                down: {}
              };
            },
            async getMarketSettlement(marketId: string) {
              return {
                marketId,
                capturedAt: new Date("2026-06-13T12:06:00.000Z"),
                source: "predict.fun" as const,
                status: "resolved" as const,
                winningDirection: "UP" as const
              };
            }
          }
        }
      );

      expect(result.updatedRows).toBe(1);
      expect(JSON.parse(readFileSync(journalPath, "utf8")).settlement).toMatchObject({
        status: "resolved",
        payoutUsd: 4,
        pnlUsd: 2
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
