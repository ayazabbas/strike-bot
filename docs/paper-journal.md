# Paper journal JSONL

`RUN_MODE=paper npm run tick` appends one JSON object per line to `PAPER_JOURNAL_PATH`.

Default path:

```bash
data/paper/trades.jsonl
```

The `data/` tree is ignored by git. This file is intended for pandas, DuckDB, jq, or later settlement enrichment; it is not a console log.

## Record shape

Each row uses `schemaVersion: 1` and includes:

- `runId`, `runStartedAt`, `timestamp`, `mode`, `strategy`
- `market`: predict.fun BTC 5-minute market id, slug, venue, asset, status, start/close/resolve times, seconds remaining, liquidity when available
- `selectedOutcome`: selected direction for paper entries, otherwise `null`
- `strategyDecision`: original strategy output before risk/TWAK blocking
- `decision`: final decision after safety/risk blocking
- `pricing`: captured predict.fun bid/ask/implied probability for UP and DOWN plus spread
- `strategyMetadata`: trigger name, elapsed second/minute, dynamic edge bucket/min required edge, market start timing, Pyth candle/market start delta and tolerance, partial return bps, close location, fair threshold, max acceptable ask, ask price, edge
- `pythCandle`: captured Pyth candle metadata and OHLCV fields
- `risk`: approval and rejection reasons
- `safety`: signing/broadcasting flags; paper rows should be `false`/`false`
- `execution`: simulated paper fill/skipped details, fill price, notional, and quantity when applicable
- `settlement`: placeholders initialized as `unknown`/`null` and later enriched from official predict.fun market resolution

No API keys, wallet material, raw environment variables, or signing secrets should be written to this journal.

`MomentumStrategySkill` emits explicit no-trade reasons for start-time safety:

- `market_not_started`: the selected predict.fun market exists but `decision.createdAt` is before `selectedMarket.startsAt`.
- `candle_market_mismatch`: the latest Pyth candle `openTime` differs from `selectedMarket.startsAt` by more than `STRATEGY_CANDLE_START_TOLERANCE_SECONDS`, defaulting to 90 seconds.

Rows include `marketStartsAt`, `candleOpenTime`, `candleStartDeltaSeconds`, `candleStartToleranceSeconds`, `marketStartDeltaSeconds`, and `secondsSinceMarketStart` in `strategyMetadata` when those fields are relevant.

## Settlement enrichment

Run:

```bash
npm run settle-paper
```

The command reads `PAPER_JOURNAL_PATH`, calls predict.fun `GET /v1/markets/:id`, and atomically rewrites only eligible rows where `decision.action` is `enter` and `settlement.status` is `unknown` or `unresolved`. Rows are updated only after predict.fun reports the market as resolved.

For resolved rows, `winningDirection` is normalized from official `Up`/`Down` outcome statuses. Paper economics use the existing binary-share model: winning payout is `notionalUsd / ask`, losing payout is `0`, and `pnlUsd` is `payoutUsd - notionalUsd`.

## Example consumers

```bash
# Last paper row, formatted
jq . data/paper/trades.jsonl | tail -n 80

# Load into DuckDB
 duckdb -c "SELECT timestamp, market.slug, decision.action, decision.reason, strategyMetadata.edge FROM read_json_auto('data/paper/trades.jsonl');"

# Enrich official settlement fields
npm run settle-paper
```
