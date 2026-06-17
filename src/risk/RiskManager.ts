import type { AppConfig } from "../config.js";
import type { StrategyDecision } from "../domain/types.js";

export interface RiskCheckResult {
  readonly approved: boolean;
  readonly reasons: readonly string[];
}

export class RiskManager {
  constructor(private readonly config: AppConfig) {}

  evaluate(decision: StrategyDecision): RiskCheckResult {
    const reasons: string[] = [];

    if (decision.action === "no_trade") {
      return { approved: true, reasons: ["no_trade"] };
    }

    if (decision.notionalUsd > this.config.maxPositionUsd) {
      reasons.push("max_position_exceeded");
    }

    if (decision.runMode === "live" && decision.notionalUsd > this.config.maxTestTradeUsd) {
      reasons.push("max_test_trade_exceeded");
    }

    if (decision.runMode === "live" && !this.config.liveTradingApproved) {
      reasons.push("live_not_approved");
    }

    return {
      approved: reasons.length === 0,
      reasons
    };
  }
}
