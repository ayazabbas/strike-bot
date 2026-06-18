import type {
  PredictFunPosition,
  PredictFunPositionsSnapshot,
  PredictFunRedemptionIntent,
  PredictFunRedemptionPlan,
  PredictFunRedemptionSkipReason,
  PredictFunRedemptionSkippedPosition
} from "../domain/types.js";

export interface PredictFunRedemptionPlannerOptions {
  readonly maxActions?: number;
  readonly now?: () => Date;
}

export class PredictFunRedemptionPlanner {
  private readonly maxActions: number;
  private readonly now: () => Date;

  constructor(options: PredictFunRedemptionPlannerOptions = {}) {
    this.maxActions = options.maxActions ?? 20;
    this.now = options.now ?? (() => new Date());
  }

  plan(snapshot: PredictFunPositionsSnapshot): PredictFunRedemptionPlan {
    const intents: PredictFunRedemptionIntent[] = [];
    const skipped: PredictFunRedemptionSkippedPosition[] = [];

    for (const position of snapshot.positions) {
      const skipReason = redemptionSkipReason(position);
      if (skipReason) {
        skipped.push(skippedPosition(position, skipReason));
        continue;
      }

      if (intents.length >= this.maxActions) {
        skipped.push(skippedPosition(position, "max_actions_exceeded"));
        continue;
      }

      intents.push(redemptionIntent(position));
    }

    return {
      mode: "dry_run",
      dryRun: true,
      capturedAt: this.now(),
      sourceCapturedAt: snapshot.capturedAt,
      walletAddress: snapshot.walletAddress,
      intents,
      skipped,
      safety: {
        signing: false,
        broadcasting: false
      }
    };
  }
}

function redemptionSkipReason(position: PredictFunPosition): PredictFunRedemptionSkipReason | undefined {
  if (position.redeemable !== true) {
    return "non_redeemable";
  }
  if (!position.conditionId) {
    return "missing_condition_id";
  }
  if (!position.indexSet) {
    return "missing_index_set";
  }
  if (!position.amount) {
    return "missing_amount";
  }
  if (position.isNegRisk === undefined) {
    return "missing_is_neg_risk";
  }
  if (position.isYieldBearing === undefined) {
    return "missing_is_yield_bearing";
  }
  return undefined;
}

function redemptionIntent(position: PredictFunPosition): PredictFunRedemptionIntent {
  const sdkParams = {
    conditionId: position.conditionId!,
    indexSet: position.indexSet!,
    isNegRisk: position.isNegRisk!,
    isYieldBearing: position.isYieldBearing!,
    ...(position.isNegRisk ? { amount: position.amount } : {})
  };

  return {
    action: "redeem",
    ...(position.marketId ? { marketId: position.marketId } : {}),
    conditionId: position.conditionId!,
    indexSet: position.indexSet!,
    ...(position.isNegRisk ? { amount: position.amount } : {}),
    amountRaw: position.amount,
    ...(position.direction ? { direction: position.direction } : {}),
    ...(position.outcome ? { outcome: position.outcome } : {}),
    ...(position.status ? { status: position.status } : {}),
    isNegRisk: position.isNegRisk!,
    isYieldBearing: position.isYieldBearing!,
    sdkParams
  };
}

function skippedPosition(position: PredictFunPosition, reason: PredictFunRedemptionSkipReason): PredictFunRedemptionSkippedPosition {
  return {
    reason,
    ...(position.marketId ? { marketId: position.marketId } : {}),
    ...(position.conditionId ? { conditionId: position.conditionId } : {}),
    ...(position.indexSet ? { indexSet: position.indexSet } : {}),
    ...(position.amount ? { amountRaw: position.amount } : {}),
    ...(position.direction ? { direction: position.direction } : {}),
    ...(position.outcome ? { outcome: position.outcome } : {}),
    ...(position.status ? { status: position.status } : {}),
    ...(position.redeemable !== undefined ? { redeemable: position.redeemable } : {})
  };
}
