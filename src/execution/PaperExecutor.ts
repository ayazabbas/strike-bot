import type { RunMode } from "../config.js";
import type { ExecutionResult, StrategyDecision } from "../domain/types.js";

export class PaperExecutor {
  async execute(decision: StrategyDecision, mode: RunMode): Promise<ExecutionResult> {
    if (decision.action === "no_trade") {
      return {
        mode,
        broadcast: false,
        status: "skipped",
        reason: decision.reason,
        decision
      };
    }

    if (mode === "paper") {
      return {
        mode,
        broadcast: false,
        status: "paper_recorded",
        decision
      };
    }

    return {
      mode,
      broadcast: false,
      status: "prepared_not_broadcast",
      decision
    };
  }
}
