---
name: cmc-btc5-prediction-market-tuner
description: Generate a bounded, backtestable CMC-driven strategy tuning spec for BTC 5-minute UP/DOWN prediction markets. Use when CMC Agent Hub market context should tune, but never directly authorize, a prediction-market strategy.
---

# CMC BTC5 Prediction Market Tuner

Use this skill to convert CMC Agent Hub context into a constrained strategy tuning spec for BTC 5-minute UP/DOWN prediction markets.

## Inputs

Expect a JSON object with:

- `cmc`: CMC Agent Hub snapshot containing BTC quote/TA, global metrics, derivatives, narratives, and macro events.
- `risk`: current risk state with daily drawdown, max daily drawdown, and max open exposure.
- `market`: optional predict.fun pricing status, spread, and staleness.

## Output

Return a JSON `StrategyTuningSpec`:

- `schemaVersion: 1`
- `strategyFamily: "prediction_market_ev_hgb"`
- `market: "BTC_5M_UP_DOWN"`
- `regime`: macro bias, volatility regime, confidence, validity window.
- `parameterDeltas`: small bounded deltas only.
- `riskLimits`: force-no-trade and exposure/trade limits.
- `reasoning`: short deterministic facts.
- `backtestSpec`: required features, label, and execution assumptions.

## Hard Bounds

- `probabilityThresholdDelta`: `[-0.03, 0.05]`
- `maxEntryPriceDelta`: `[-0.05, 0.03]`
- `minEvEdgeDelta`: `[-0.03, 0.05]`
- `maxNotionalMultiplier`: `[0, 1.5]`

## Guardrails

- Never directly emit a trade, transfer, signing action, broadcast action, private key request, API key request, JWT, or signature.
- Force no-trade when CMC is unavailable, volatility is extreme, drawdown cap is hit, pricing is stale, or spread is wide.
- Keep reasoning deterministic and based only on provided input.
- Treat this output as advisory tuning; deterministic strategy and risk gates must still approve any action separately.
