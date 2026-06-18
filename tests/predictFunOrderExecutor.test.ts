import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { PredictFunOrderExecutor } from "../src/execution/PredictFunOrderExecutor.js";
import type { BtcFiveMinuteMarket, EnterDecision, MarketPricing } from "../src/domain/types.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

function testMarket(overrides: Partial<BtcFiveMinuteMarket> = {}): BtcFiveMinuteMarket {
  const now = new Date();
  return {
    id: "472571",
    venue: "predict.fun",
    asset: "BTC",
    intervalMinutes: 5,
    directions: ["UP", "DOWN"],
    outcomeOnChainIds: { UP: "111", DOWN: "222" },
    feeRateBps: 12,
    isNegRisk: true,
    isYieldBearing: false,
    tradingStatus: "OPEN",
    startsAt: now,
    closesAt: new Date(now.getTime() + 180_000),
    resolvesAt: new Date(now.getTime() + 240_000),
    status: "open",
    ...overrides
  };
}

function testPricing(overrides: Partial<MarketPricing> = {}): MarketPricing {
  return {
    marketId: "472571",
    capturedAt: new Date(),
    source: "predict.fun",
    status: "available",
    up: { bestAsk: 0.5 },
    down: { bestAsk: 0.5 },
    ...overrides
  };
}

function testDecision(mode: "dry_run" | "live", overrides: Partial<EnterDecision> = {}): EnterDecision {
  return {
    action: "enter",
    marketId: "472571",
    direction: "UP",
    notionalUsd: 0.1,
    runMode: mode,
    createdAt: new Date(),
    ...overrides
  };
}

function mockModuleLoader(calls: unknown[]) {
  const builder = {
    getLimitOrderAmounts: vi.fn(({ pricePerShareWei, quantityWei }) => ({
      pricePerShare: pricePerShareWei,
      makerAmount: 100_000_000_000_000_000n,
      takerAmount: quantityWei
    })),
    buildOrder: vi.fn((_strategy, data) => ({ ...data, salt: "1", maker: "0xmaker", signer: "0xmaker" })),
    buildTypedData: vi.fn((order, options) => ({ domain: {}, types: {}, primaryType: "Order", message: { order, options } })),
    signTypedDataOrder: vi.fn(async () => ({ maker: "0xmaker", signature: "0xsignature", tokenId: "111" })),
    buildTypedDataHash: vi.fn(() => "0xhash")
  };
  calls.push(builder);

  return async (specifier: string) => {
    if (specifier === "@predictdotfun/sdk") {
      return {
        OrderBuilder: { make: vi.fn(async () => builder) },
        ChainId: { BnbMainnet: 56 },
        Side: { BUY: 0 }
      };
    }
    if (specifier === "ethers") {
      return {
        Wallet: class {
          readonly address = "0xwallet";
          constructor(readonly privateKey: string) {}
        }
      };
    }
    throw new Error(`Unexpected module: ${specifier}`);
  };
}

describe("PredictFunOrderExecutor", () => {
  it("prepares and signs dry-run orders without POSTing or exposing signatures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-order-"));
    const keyPath = join(dir, "privy-key");
    const jwtPath = join(dir, "jwt");
    const builders: unknown[] = [];
    const fetchImpl = vi.fn();

    try {
      writeFileSync(keyPath, `${"11".repeat(32)}\n`, { mode: 0o600 });
      const executor = new PredictFunOrderExecutor(
        loadConfig({
          RUN_MODE: "dry_run",
          PREDICT_FUN_API_KEY: "api-key",
          PREDICT_FUN_PRIVY_KEY_FILE: keyPath,
          PREDICT_FUN_JWT_CACHE_FILE: jwtPath
        }),
        fetchImpl,
        mockModuleLoader(builders)
      );

      const result = await executor.execute(testDecision("dry_run"), "dry_run", {
        selectedMarket: testMarket(),
        pricing: testPricing(),
        risk: { approved: true, reasons: [] }
      });

      expect(result).toMatchObject({
        broadcast: false,
        status: "prepared_not_broadcast",
        details: {
          hash: "0xhash",
          tokenId: "111",
          makerAmount: "100000000000000000",
          feeRateBps: 12
        }
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain("0xsignature");
      expect(JSON.stringify(result)).not.toContain("api-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("POSTs live orders to /v1/orders with JWT auth and redacted result details", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-order-"));
    const keyPath = join(dir, "privy-key");
    const jwtPath = join(dir, "jwt");
    const builders: unknown[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "order-1" }, 201));

    try {
      writeFileSync(keyPath, `${"22".repeat(32)}\n`, { mode: 0o600 });
      writeFileSync(jwtPath, "jwt-secret-value\n", { mode: 0o600 });
      const executor = new PredictFunOrderExecutor(
        loadConfig({
          RUN_MODE: "live",
          LIVE_TRADING_APPROVED: "true",
          PREDICT_FUN_API_KEY: "api-key",
          PREDICT_FUN_PRIVY_KEY_FILE: keyPath,
          PREDICT_FUN_JWT_CACHE_FILE: jwtPath,
          MAX_TEST_TRADE_USD: "1"
        }),
        fetchImpl,
        mockModuleLoader(builders)
      );

      const result = await executor.execute(testDecision("live"), "live", {
        selectedMarket: testMarket(),
        pricing: testPricing(),
        risk: { approved: true, reasons: [] }
      });

      expect(result.broadcast).toBe(true);
      expect(result.status).toBe("broadcast");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][0].toString()).toBe("https://api.predict.fun/v1/orders");
      expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
        "x-api-key": "api-key",
        authorization: "Bearer jwt-secret-value"
      });
      const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(body).toMatchObject({
        data: {
          order: {
            hash: "0xhash",
            signature: "0xsignature"
          },
          pricePerShare: "500000000000000000",
          strategy: "LIMIT",
          isPostOnly: false,
          selfTradePrevention: "CANCEL_MAKER"
        }
      });
      expect(JSON.stringify(result)).not.toContain("0xsignature");
      expect(JSON.stringify(result)).not.toContain("jwt-secret-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses live orders over the configured test cap before signing", async () => {
    const fetchImpl = vi.fn();
    const moduleLoader = vi.fn();
    const executor = new PredictFunOrderExecutor(
      loadConfig({
        RUN_MODE: "live",
        LIVE_TRADING_APPROVED: "true",
        PREDICT_FUN_API_KEY: "api-key",
        MAX_TEST_TRADE_USD: "1"
      }),
      fetchImpl,
      moduleLoader
    );

    const result = await executor.execute(testDecision("live", { notionalUsd: 1.01 }), "live", {
      selectedMarket: testMarket(),
      pricing: testPricing(),
      risk: { approved: true, reasons: [] }
    });

    expect(result).toMatchObject({ broadcast: false, status: "skipped", reason: "max_test_trade_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(moduleLoader).not.toHaveBeenCalled();
  });
});
