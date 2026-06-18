import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { redeemPositionsDryRun } from "../src/app.js";
import { PredictFunRedemptionPlanner } from "../src/execution/PredictFunRedemptionPlanner.js";
import type { PredictFunPosition, PredictFunPositionsSnapshot } from "../src/domain/types.js";

const capturedAt = new Date("2026-06-18T00:00:00.000Z");
const plannedAt = new Date("2026-06-18T00:01:00.000Z");

function position(overrides: Partial<PredictFunPosition> = {}): PredictFunPosition {
  return {
    walletAddress: "0xwallet",
    marketId: "472369",
    conditionId: "0xcondition",
    indexSet: "2",
    token: "123",
    outcome: "Down",
    direction: "DOWN",
    amount: "1000000000000000000",
    isNegRisk: false,
    isYieldBearing: false,
    status: "WON",
    redeemable: true,
    capturedAt,
    source: "predict.fun",
    ...overrides
  };
}

function snapshot(positions: readonly PredictFunPosition[]): PredictFunPositionsSnapshot {
  return {
    walletAddress: "0xwallet",
    capturedAt,
    source: "predict.fun",
    status: "available",
    positions
  };
}

function planner(maxActions = 20) {
  return new PredictFunRedemptionPlanner({ maxActions, now: () => plannedAt });
}

describe("PredictFunRedemptionPlanner", () => {
  it("creates a standard redemption intent without amount params but keeps amountRaw", () => {
    const plan = planner().plan(snapshot([position({ isNegRisk: false })]));

    expect(plan).toMatchObject({
      mode: "dry_run",
      dryRun: true,
      capturedAt: plannedAt,
      sourceCapturedAt: capturedAt,
      walletAddress: "0xwallet",
      safety: { signing: false, broadcasting: false },
      skipped: []
    });
    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      action: "redeem",
      marketId: "472369",
      conditionId: "0xcondition",
      indexSet: "2",
      amountRaw: "1000000000000000000",
      direction: "DOWN",
      outcome: "Down",
      status: "WON",
      isNegRisk: false,
      isYieldBearing: false,
      sdkParams: {
        conditionId: "0xcondition",
        indexSet: "2",
        isNegRisk: false,
        isYieldBearing: false
      }
    });
    expect(plan.intents[0].amount).toBeUndefined();
    expect(plan.intents[0].sdkParams.amount).toBeUndefined();
  });

  it("includes amount in neg-risk redemption params", () => {
    const plan = planner().plan(snapshot([position({ isNegRisk: true })]));

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      amount: "1000000000000000000",
      amountRaw: "1000000000000000000",
      sdkParams: {
        amount: "1000000000000000000",
        isNegRisk: true
      }
    });
  });

  it("skips redeemable positions with missing required redemption fields", () => {
    const plan = planner().plan(
      snapshot([
        position({ marketId: "missing-condition", conditionId: undefined }),
        position({ marketId: "missing-index", indexSet: undefined }),
        position({ marketId: "missing-amount", amount: "" }),
        position({ marketId: "missing-neg-risk", isNegRisk: undefined }),
        position({ marketId: "missing-yield", isYieldBearing: undefined })
      ])
    );

    expect(plan.intents).toHaveLength(0);
    expect(plan.skipped.map((skip) => [skip.marketId, skip.reason])).toEqual([
      ["missing-condition", "missing_condition_id"],
      ["missing-index", "missing_index_set"],
      ["missing-amount", "missing_amount"],
      ["missing-neg-risk", "missing_is_neg_risk"],
      ["missing-yield", "missing_is_yield_bearing"]
    ]);
  });

  it("skips non-redeemable positions", () => {
    const plan = planner().plan(snapshot([position({ redeemable: false })]));

    expect(plan.intents).toHaveLength(0);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        reason: "non_redeemable",
        redeemable: false
      })
    ]);
  });

  it("caps intents and skips eligible overflow rows", () => {
    const plan = planner(1).plan(
      snapshot([
        position({ marketId: "first", conditionId: "0xfirst" }),
        position({ marketId: "second", conditionId: "0xsecond" })
      ])
    );

    expect(plan.intents.map((intent) => intent.marketId)).toEqual(["first"]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({
        marketId: "second",
        reason: "max_actions_exceeded"
      })
    ]);
  });

  it("exposes dry-run redemption planning through the app wrapper", async () => {
    const adapter = {
      async getPositions() {
        return snapshot([position()]);
      }
    };

    await expect(redeemPositionsDryRun(loadConfig({}), adapter)).resolves.toMatchObject({
      mode: "dry_run",
      dryRun: true,
      walletAddress: "0xwallet",
      intents: [expect.objectContaining({ action: "redeem" })],
      safety: { signing: false, broadcasting: false }
    });
  });
});
