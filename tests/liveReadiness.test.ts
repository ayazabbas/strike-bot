import { describe, expect, it, vi } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import { liveReadiness, type AppDependencies } from "../src/app.js";
import type { BtcFiveMinuteMarket, MarketPricing, MarketSnapshot, PredictFunPositionsSnapshot } from "../src/domain/types.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function testMarket(overrides: Partial<BtcFiveMinuteMarket> = {}): BtcFiveMinuteMarket {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 60_000);
  const closesAt = new Date(now.getTime() + 180_000);

  return {
    id: "btc-5m-live",
    venue: "predict.fun",
    asset: "BTC",
    intervalMinutes: 5,
    directions: ["UP", "DOWN"],
    outcomeOnChainIds: { UP: "111", DOWN: "222" },
    feeRateBps: 0,
    isNegRisk: true,
    isYieldBearing: false,
    tradingStatus: "OPEN",
    categorySlug: "btc-updown-5m-current",
    startsAt,
    closesAt,
    resolvesAt: new Date(closesAt.getTime() + 60_000),
    status: "open",
    ...overrides
  };
}

function pricing(overrides: Partial<MarketPricing> = {}): MarketPricing {
  return {
    marketId: "btc-5m-live",
    capturedAt: new Date(),
    source: "predict.fun",
    status: "available",
    up: { bestBid: 0.48, bestAsk: 0.5 },
    down: { bestBid: 0.49, bestAsk: 0.51 },
    spread: 0.02,
    ...overrides
  };
}

function positionsSnapshot(overrides: Partial<PredictFunPositionsSnapshot> = {}): PredictFunPositionsSnapshot {
  return {
    walletAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
    capturedAt: new Date(),
    source: "predict.fun",
    status: "available",
    positions: [],
    ...overrides
  };
}

function dependencies(
  config: AppConfig,
  options: {
    readonly markets?: MarketSnapshot;
    readonly strategyName?: string;
    readonly jwtCachePresent?: boolean;
    readonly twakReady?: boolean;
    readonly positions?: PredictFunPositionsSnapshot;
    readonly pricing?: MarketPricing;
  } = {}
): AppDependencies & { readonly authOptions: unknown[]; readonly orderExecutorExecute: ReturnType<typeof vi.fn> } {
  const authOptions: unknown[] = [];
  const orderExecutorExecute = vi.fn(async () => {
    throw new Error("order_executor_must_not_run");
  });
  const now = new Date();
  const markets = options.markets ?? { capturedAt: now, markets: [testMarket()] };

  return {
    authOptions,
    orderExecutorExecute,
    cmc: {
      async getMacroSnapshot() {
        return { capturedAt: now, source: "coinmarketcap" as const, stubbed: true };
      }
    },
    pyth: {
      async getBtcFiveMinuteCandleMetadata() {
        return { capturedAt: now, source: "pyth-pro" as const, symbol: "BTC" as const, intervalMinutes: 5 as const, stubbed: true };
      }
    },
    predictFun: {
      async listMarkets() {
        return markets;
      },
      async getOrderbookPricing(marketId: string) {
        return { ...pricing(), ...options.pricing, marketId };
      },
      async getMarketSettlement(marketId: string) {
        return { marketId, capturedAt: now, source: "predict.fun" as const, status: "unknown" as const, winningDirection: null };
      }
    },
    predictFunAuth: {
      async checkReadiness(optionsArg?: { readonly acquireJwt?: boolean }) {
        authOptions.push(optionsArg);
        if (optionsArg?.acquireJwt !== false) {
          throw new Error("live_readiness_must_not_acquire_jwt");
        }
        return {
          accountAddressConfigured: true,
          accountAddress: config.predictFunAccountAddress,
          authMessageEndpointReachable: true,
          tokenCachePresent: options.jwtCachePresent ?? false,
          jwtAcquisitionStatus: options.jwtCachePresent ? ("cached" as const) : ("skipped" as const),
          signing: false as const,
          broadcasting: false as const,
          reasons: options.jwtCachePresent ? [] : ["predict_fun_jwt_acquisition_not_requested"]
        };
      }
    },
    predictFunExecutionWallet: {
      async getStatus() {
        throw new Error("execution_wallet_must_not_be_read");
      }
    },
    twak: {
      async checkReadiness() {
        const ready = options.twakReady ?? false;
        return {
          enabled: true,
          ready,
          credentialsCliRpcReady: ready,
          agentWalletConfigured: ready,
          agentWalletPasswordAvailable: ready,
          address: ready ? "0x1111111111111111111111111111111111111111" : null,
          reasons: ready ? [] : ["twak_credentials_missing"]
        };
      }
    },
    strategy: {
      name: options.strategyName ?? "NoopStrategySkill",
      async decide() {
        throw new Error("strategy_must_not_decide");
      }
    },
    repository: {
      async init() {
        return;
      },
      async createRun() {
        throw new Error("repository_must_not_create_run");
      },
      async recordMarketSnapshot() {
        throw new Error("repository_must_not_record_market");
      },
      async recordDecision() {
        throw new Error("repository_must_not_record_decision");
      },
      async recordExecution() {
        throw new Error("repository_must_not_record_execution");
      }
    },
    predictFunPositions: {
      async getPositions() {
        return options.positions ?? positionsSnapshot();
      }
    },
    predictFunOrderExecutor: {
      execute: orderExecutorExecute
    } as never
  };
}

describe("liveReadiness", () => {
  it("never acquires a JWT and reports missing live blockers", async () => {
    const config = loadConfig({ PREDICT_FUN_API_KEY: "api-key", BSC_RPC_URL: "https://bsc.example" });
    const deps = dependencies(config, {
      markets: { capturedAt: new Date(), markets: [] }
    });

    const result = await liveReadiness(config, deps);

    expect(deps.authOptions).toEqual([{ acquireJwt: false }]);
    expect(deps.orderExecutorExecute).not.toHaveBeenCalled();
    expect(result.safety).toEqual({ signing: false, broadcasting: false });
    expect(result.summary.ready).toBe(false);
    expect(result.summary.blockers).toEqual(
      expect.arrayContaining([
        "predict_fun_jwt_cache_missing",
        "live_trading_not_approved",
        "predict_fun_redemption_not_approved",
        "btc_five_minute_market_not_selected",
        "live_strategy_is_noop"
      ])
    );
  });

  it("returns ready when all live-readiness gates are satisfied by fakes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-live-readiness-"));
    const keyPath = join(dir, "privy-key");
    const config = loadConfig({
      PREDICT_FUN_API_KEY: "api-key",
      PREDICT_FUN_PRIVY_KEY_FILE: keyPath,
      BSC_RPC_URL: "https://bsc.example",
      LIVE_TRADING_APPROVED: "true",
      PREDICT_FUN_REDEMPTION_APPROVED: "true",
      STRATEGY_SKILL: "momentum"
    });

    try {
      writeFileSync(keyPath, "present-only\n", { mode: 0o600 });
      const deps = dependencies(config, {
        jwtCachePresent: true,
        twakReady: true,
        strategyName: "MomentumStrategySkill",
        positions: positionsSnapshot({
          positions: [
            {
              walletAddress: config.predictFunAccountAddress,
              marketId: "btc-5m-live",
              conditionId: "0xcondition",
              indexSet: "1",
              amount: "1000000000000000000",
              isNegRisk: true,
              isYieldBearing: false,
              redeemable: true,
              capturedAt: new Date(),
              source: "predict.fun"
            }
          ]
        })
      });

      const result = await liveReadiness(config, deps);

      expect(deps.authOptions).toEqual([{ acquireJwt: false }]);
      expect(result.summary).toMatchObject({ ready: true, blockers: [] });
      expect(result.market.selected?.id).toBe("btc-5m-live");
      expect(result.market.pricing.status).toBe("available");
      expect(result.credentials).toMatchObject({
        predictFunApiKeyConfigured: true,
        predictFunJwtCachePresent: true,
        privyKeyFilePresent: true,
        bscRpcConfigured: true,
        liveTradingApproved: true,
        predictFunRedemptionApproved: true,
        maxTestTradeUsd: 1,
        predictFunMinOrderNotionalUsd: 1
      });
      expect(result.strategy).toMatchObject({
        notionalUsd: 1,
        predictFunMinOrderNotionalUsd: 1
      });
      expect(result.positions).toMatchObject({
        status: "available",
        count: 1,
        redeemableCount: 1,
        redemptionDryRunIntentCount: 1
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks live readiness when configured sizing is below predict.fun minimum", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-live-readiness-"));
    const keyPath = join(dir, "privy-key");
    const config = loadConfig({
      PREDICT_FUN_API_KEY: "api-key",
      PREDICT_FUN_PRIVY_KEY_FILE: keyPath,
      BSC_RPC_URL: "https://bsc.example",
      LIVE_TRADING_APPROVED: "true",
      PREDICT_FUN_REDEMPTION_APPROVED: "true",
      STRATEGY_SKILL: "signal",
      STRATEGY_NOTIONAL_USD: "0.5",
      MAX_TEST_TRADE_USD: "0.5"
    });

    try {
      writeFileSync(keyPath, "present-only\n", { mode: 0o600 });
      const deps = dependencies(config, {
        jwtCachePresent: true,
        twakReady: true,
        strategyName: "SignalJournalStrategySkill"
      });

      const result = await liveReadiness(config, deps);

      expect(result.summary.ready).toBe(false);
      expect(result.summary.blockers).toEqual(
        expect.arrayContaining([
          "max_test_trade_below_predict_fun_minimum",
          "strategy_notional_below_predict_fun_minimum"
        ])
      );
      expect(result.credentials).toMatchObject({ maxTestTradeUsd: 0.5, predictFunMinOrderNotionalUsd: 1 });
      expect(result.strategy).toMatchObject({ notionalUsd: 0.5, predictFunMinOrderNotionalUsd: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
