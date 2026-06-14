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
- `strategyMetadata`: trigger name, elapsed minute, partial return bps, close location, fair threshold, max acceptable ask, ask price, edge
- `pythCandle`: captured Pyth candle metadata and OHLCV fields
- `risk`: approval and rejection reasons
- `safety`: signing/broadcasting flags; paper rows should be `false`/`false`
- `execution`: simulated paper fill/skipped details, fill price, notional, and quantity when applicable
- `settlement`: placeholders initialized as `unknown`/`null` for later enrichment

No API keys, wallet material, raw environment variables, or signing secrets should be written to this journal.

## Example consumers

```bash
# Last paper row, formatted
jq . data/paper/trades.jsonl | tail -n 80

# Load into DuckDB
 duckdb -c "SELECT timestamp, market.slug, decision.action, decision.reason, strategyMetadata.edge FROM read_json_auto('data/paper/trades.jsonl');"
```
