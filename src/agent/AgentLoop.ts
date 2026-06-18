import type { AgentDecisionSummary, CmcAgentHubSnapshot, ExecutionResult, MarketPricing, SelectedBtcFiveMinuteMarket, StrategyDecision, StrategyTuningSpec } from "../domain/types.js";
import type { RiskCheckResult } from "../risk/RiskManager.js";
import { CmcStrategyTuner } from "../strategy/CmcStrategyTuner.js";

export function buildAgentDecisionSummary(input: {
  readonly cmcAgentHub?: CmcAgentHubSnapshot;
  readonly tuning: StrategyTuningSpec;
  readonly selectedMarket?: SelectedBtcFiveMinuteMarket;
  readonly pricing?: MarketPricing;
  readonly decision: StrategyDecision;
  readonly risk: RiskCheckResult;
  readonly execution: ExecutionResult;
  readonly safety: { readonly signing: boolean; readonly broadcasting: boolean };
  readonly journaled: boolean;
}): AgentDecisionSummary {
  const tuner = new CmcStrategyTuner();
  const blocked = input.tuning.riskLimits.forceNoTrade || !input.risk.approved;
  return {
    stages: [
      {
        name: "observe",
        status: input.selectedMarket ? "ok" : "blocked",
        summary: input.selectedMarket ? "market_and_context_observed" : "btc_5m_market_not_selected"
      },
      {
        name: "tune",
        status: input.tuning.riskLimits.forceNoTrade ? "blocked" : "ok",
        summary: input.tuning.riskLimits.forceNoTrade ? "tuner_forced_no_trade" : "bounded_tuning_spec_ready"
      },
      {
        name: "plan",
        status: input.decision.action === "enter" ? "ok" : "skipped",
        summary: input.decision.action === "enter" ? "entry_candidate_planned" : `no_trade_${input.decision.reason}`
      },
      {
        name: "guard",
        status: blocked ? "blocked" : "ok",
        summary: blocked ? "risk_or_tuner_rejected_action" : "risk_checks_passed"
      },
      {
        name: "act",
        status: input.execution.broadcast ? "ok" : input.execution.status === "skipped" ? "skipped" : "ok",
        summary: input.execution.broadcast ? "broadcast_completed" : input.execution.status
      },
      {
        name: "journal",
        status: input.journaled ? "ok" : "skipped",
        summary: input.journaled ? "paper_journal_appended" : "journal_not_required_for_mode"
      }
    ],
    observations: {
      cmcAgentHubStatus: input.cmcAgentHub?.status,
      selectedMarketId: input.selectedMarket?.id,
      pricingStatus: input.selectedMarket ? input.pricing?.status ?? "unknown" : "not_requested"
    },
    tuner: {
      hash: tuner.hash(input.tuning),
      forceNoTrade: input.tuning.riskLimits.forceNoTrade,
      macroBias: input.tuning.regime.macroBias,
      volatilityRegime: input.tuning.regime.volatilityRegime
    },
    plan: {
      action: input.decision.action,
      reason: input.decision.action === "no_trade" ? input.decision.reason : undefined,
      marketId: input.decision.marketId
    },
    guard: {
      approved: input.risk.approved,
      reasons: input.risk.reasons
    },
    action: {
      status: input.execution.status,
      broadcast: input.execution.broadcast
    },
    safety: input.safety
  };
}
