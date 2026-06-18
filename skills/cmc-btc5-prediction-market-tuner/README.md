# cmc-btc5-prediction-market-tuner

Track 2 CMC Strategy Skill package for Strike Bot.

It converts CMC Agent Hub context into a bounded, backtestable strategy tuning spec for BTC 5-minute UP/DOWN prediction markets. The skill does not trade, sign, transfer, broadcast, or authorize execution.

The TypeScript implementation used by Track 1 lives in `src/strategy/CmcStrategyTuner.ts`.

## Example

Input: `examples/input.json`

Output: `examples/output.json`

The output can be backtested by applying the deltas to a fixed EV + direction prediction-market strategy and evaluating on historical predict.fun BTC 5-minute settlements with the stated fill/slippage assumptions.
