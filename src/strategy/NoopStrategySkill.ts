import type { StrategyContext, StrategySkill } from "./StrategySkill.js";
import type { StrategyDecision } from "../domain/types.js";

export class NoopStrategySkill implements StrategySkill {
  readonly name = "NoopStrategySkill";

  async decide(context: StrategyContext): Promise<StrategyDecision> {
    return {
      action: "no_trade",
      reason: "strategy_not_configured",
      runMode: context.runMode,
      createdAt: new Date()
    };
  }
}
