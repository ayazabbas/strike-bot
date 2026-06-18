import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";
import { PredictFunRedemptionExecutor } from "../src/execution/PredictFunRedemptionExecutor.js";
import type { PredictFunRedemptionIntent, PredictFunRedemptionPlan } from "../src/domain/types.js";

const capturedAt = new Date("2026-06-18T00:00:00.000Z");

function intent(overrides: Partial<PredictFunRedemptionIntent> = {}): PredictFunRedemptionIntent {
  const isNegRisk = overrides.isNegRisk ?? false;
  return {
    action: "redeem",
    marketId: "472369",
    conditionId: "0xcondition",
    indexSet: "2",
    amountRaw: "1000000000000000000",
    direction: "DOWN",
    outcome: "Down",
    status: "WON",
    isNegRisk,
    isYieldBearing: false,
    ...(isNegRisk ? { amount: "1000000000000000000" } : {}),
    sdkParams: {
      conditionId: "0xcondition",
      indexSet: "2",
      isNegRisk,
      isYieldBearing: false,
      ...(isNegRisk ? { amount: "1000000000000000000" } : {})
    },
    ...overrides
  };
}

function plan(intents: readonly PredictFunRedemptionIntent[]): PredictFunRedemptionPlan {
  return {
    mode: "dry_run",
    dryRun: true,
    capturedAt,
    sourceCapturedAt: capturedAt,
    walletAddress: "0xwallet",
    intents,
    skipped: [],
    safety: { signing: false, broadcasting: false }
  };
}

function moduleLoader(redeemPositions = vi.fn(async () => ({ hash: "0xtxhash", status: "success", signature: "0xsig" }))) {
  const make = vi.fn(async () => ({ redeemPositions }));
  const load = vi.fn(async (specifier: string) => {
    if (specifier === "@predictdotfun/sdk") {
      return { OrderBuilder: { make }, ChainId: { BnbMainnet: 56 } };
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
  });
  return { load, make, redeemPositions };
}

describe("PredictFunRedemptionExecutor", () => {
  it("keeps dry-run safe without touching wallet or sdk", async () => {
    const load = vi.fn();
    const executor = new PredictFunRedemptionExecutor(loadConfig({}), load);

    const result = await executor.execute(plan([intent()]), "dry_run");

    expect(result).toMatchObject({
      mode: "dry_run",
      dryRun: true,
      status: "prepared_not_broadcast",
      intentsCount: 1,
      safety: { signing: false, broadcasting: false }
    });
    expect(result.plan?.intents).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("skips live before wallet/sdk when live trading is not approved", async () => {
    const load = vi.fn();
    const executor = new PredictFunRedemptionExecutor(loadConfig({ PREDICT_FUN_REDEMPTION_APPROVED: "true" }), load);

    await expect(executor.execute(plan([intent()]), "live")).resolves.toMatchObject({
      status: "skipped",
      reason: "live_not_approved",
      safety: { signing: false, broadcasting: false }
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("skips live before wallet/sdk when redemption is not approved", async () => {
    const load = vi.fn();
    const executor = new PredictFunRedemptionExecutor(loadConfig({ LIVE_TRADING_APPROVED: "true" }), load);

    await expect(executor.execute(plan([intent()]), "live")).resolves.toMatchObject({
      status: "skipped",
      reason: "predict_fun_redemption_not_approved"
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("skips live with no intents before wallet/sdk", async () => {
    const load = vi.fn();
    const executor = new PredictFunRedemptionExecutor(
      loadConfig({ LIVE_TRADING_APPROVED: "true", PREDICT_FUN_REDEMPTION_APPROVED: "true" }),
      load
    );

    await expect(executor.execute(plan([]), "live")).resolves.toMatchObject({
      status: "skipped",
      reason: "no_redeemable_intents",
      intentsCount: 0
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("executes standard and neg-risk redemptions with approvals and redacts output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-redemption-"));
    const keyPath = join(dir, "privy-key");
    const modules = moduleLoader();

    try {
      writeFileSync(keyPath, `${"33".repeat(32)}\n`, { mode: 0o600 });
      const executor = new PredictFunRedemptionExecutor(
        loadConfig({
          LIVE_TRADING_APPROVED: "true",
          PREDICT_FUN_REDEMPTION_APPROVED: "true",
          PREDICT_FUN_PRIVY_KEY_FILE: keyPath,
          BSC_RPC_URL: "https://bsc.example"
        }),
        modules.load
      );

      const standard = intent({
        conditionId: "0xstandard",
        indexSet: "1",
        isNegRisk: false,
        sdkParams: {
          conditionId: "0xstandard",
          indexSet: "1",
          isNegRisk: false,
          isYieldBearing: false
        }
      });
      const negRisk = intent({
        conditionId: "0xnegrisk",
        indexSet: "2",
        isNegRisk: true,
        amount: "7",
        amountRaw: "7",
        sdkParams: {
          conditionId: "0xnegrisk",
          indexSet: "2",
          isNegRisk: true,
          isYieldBearing: false,
          amount: "7"
        }
      });

      const result = await executor.execute(plan([standard, negRisk]), "live");

      expect(result).toMatchObject({
        mode: "live",
        dryRun: false,
        status: "broadcast",
        intentsCount: 2,
        safety: { signing: true, broadcasting: true },
        txResults: [
          { intentIndex: 0, conditionId: "0xstandard", indexSet: "1", txHash: "0xtxhash", status: "success" },
          { intentIndex: 1, conditionId: "0xnegrisk", indexSet: "2", txHash: "0xtxhash", status: "success" }
        ]
      });
      expect(modules.redeemPositions).toHaveBeenNthCalledWith(1, {
        conditionId: "0xstandard",
        indexSet: "1",
        isNegRisk: false,
        isYieldBearing: false
      });
      expect(modules.redeemPositions).toHaveBeenNthCalledWith(2, {
        conditionId: "0xnegrisk",
        indexSet: "2",
        isNegRisk: true,
        isYieldBearing: false,
        amount: "7"
      });
      expect(JSON.stringify(result)).not.toContain("0xsig");
      expect(JSON.stringify(result)).not.toContain("333333");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
