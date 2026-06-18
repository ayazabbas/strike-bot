# Track 2 Skill Submission

Skill: `cmc-btc5-prediction-market-tuner`

Location: `skills/cmc-btc5-prediction-market-tuner`

## What It Does

The skill turns CMC Agent Hub context into a bounded, backtestable tuning spec for BTC 5-minute UP/DOWN prediction markets. It is designed to tune a deterministic EV + direction strategy slightly, not to authorize trades.

## CMC Data Used

- BTC live quote and percentage changes.
- BTC technical analysis such as RSI, MACD signal, and EMA trend.
- Global market metrics such as total market-cap change, Fear & Greed, and BTC dominance.
- Derivatives context such as funding bias and open-interest trend.
- Trending narratives and upcoming macro events.

## Output

The output schema is `StrategyTuningSpec`:

- regime classification;
- bounded parameter deltas;
- risk limits;
- deterministic reasoning;
- backtest features, label, and execution assumptions.

See `skills/cmc-btc5-prediction-market-tuner/examples/output.json`.

## Backtestability

Historical CMC context, Pyth BTC candles, predict.fun odds, and settlement labels can be replayed through the same schema. The backtest applies the emitted deltas to the fixed base strategy and scores entries under the declared fill penalty and slippage assumptions.

## Track 1 Consumption

The Track 1 bot uses the same deterministic local implementation in `src/strategy/CmcStrategyTuner.ts`. Runtime output includes the tuning spec and a hash in `agentDecision.tuner`.
