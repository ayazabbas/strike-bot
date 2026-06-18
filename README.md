# Strike Bot

AI-tuned, mechanically executed prediction-market trading agent for the **BNB Hack: AI Trading Agent Edition**.

Initial scope is intentionally narrow:

- **Market:** Bitcoin 5-minute UP/DOWN markets only.
- **Venue:** predict.fun.
- **Chain:** BNB Chain mainnet.
- **Macro context:** CoinMarketCap.
- **Low-timeframe OHLC/reference data:** Pyth Pro.
- **Wallet/action layer:** Trust Wallet Agent Kit (TWAK) where feasible/required for hackathon alignment.
- **Strategy:** default is the safe `NoopStrategySkill`; opt in to paper/live strategy profiles explicitly. The documented competition profile is the EV + direction ensemble described below.

## Current objective

Build the execution foundation before strategy work:

1. Project scaffold and config validation.
2. Domain types for BTC 5-minute prediction markets.
3. Adapters for CMC, Pyth Pro, predict.fun, and Trust Wallet Agent Kit.
4. Deterministic strategy interface with a `NoopStrategySkill` default and opt-in `MomentumStrategySkill` for paper research.
5. Risk manager with hard safety gates.
6. Paper mode and dry-run mode.
7. Mainnet live mode guarded by explicit approval and small-fund limits.
8. SQLite/local logging for runs, market snapshots, decisions, executions, and positions.

## Competition strategy: EV + direction ensemble

The current competition profile is an **EV + direction ensemble** for BTC 5-minute UP/DOWN markets on predict.fun. It is designed for agent operators who want a mechanically executed strategy that is explainable, testable, and still guarded by paper/dry-run/live safety modes.

At a high level, the model asks two separate questions before it allows a trade:

1. **Is this side mispriced enough to be profitable?**
2. **Does an independent direction model agree with the side?**

Only when both checks pass does the bot emit a trade decision.

### Inputs

The strategy uses information available at the current decision time only:

- current predict.fun UP/DOWN ask and bid prices;
- current spread, implied mid, and book overround/underround;
- Pyth BTC low-timeframe candle features;
- intra-window momentum and volatility features;
- time-of-day features for the EV model.

The core technical feature set includes:

- elapsed time in the 5-minute market;
- partial return inside the current market window;
- 1-minute return, candle body, and range;
- rolling 5-minute return;
- 15-minute realized volatility;
- ATR(14);
- Bollinger width(20) only;
- EMA 9/21/50/200 level, distance, and slope;
- RSI 7/14/21.

We intentionally keep the public competition profile simple. Bollinger **position** features such as `%B`, upper/lower distance, and squeeze percentiles were tested in research but are not part of the current recommended competition model because they did not improve the main fill-stressed profile.

### Model construction

The ensemble has two components:

1. **Profitability / EV model**

   Each market snapshot is expanded into two candidate actions: buy UP at the current UP ask, or buy DOWN at the current DOWN ask. A gradient-boosted profitability model estimates whether each candidate would have been profitable at settlement.

   For each side:

   ```text
   predicted_ev = predicted_profit_probability - entry_ask
   ```

   In binary UP/DOWN markets, a winning share pays 1 and a losing share pays 0, so this is the natural edge estimate before execution costs.

2. **Direction model**

   A separate logistic direction model estimates the probability that the BTC 5-minute window settles UP. It then converts that probability into side-specific direction edge:

   ```text
   up_direction_edge = P(up) - up_ask
   down_direction_edge = (1 - P(up)) - down_ask
   ```

   The ensemble keeps only the side with the better direction edge for that snapshot. This prevents the EV model from taking a side that the independent direction model does not support.

### Competition rule profile

The current recommended competition profile is the fill-stressed EV + direction ensemble:

```text
profitability_probability >= 0.45
entry_ask <= 0.55
predicted_ev >= 0.01
direction_edge >= 0.20
fill_stress = +0.03
max_trades_per_market = 1
exit_policy = hold_to_settlement
```

The `+0.03` fill stress means research validation scores each historical entry as if the bot paid 3 cents worse than the observed ask. This is deliberately conservative: it favors strategies that survive execution friction instead of strategies that only work with optimistic fills.

Backtest summary on the May+June PMXT/predict.fun proxy dataset:

- trades: **612**
- PnL: **+83.97 units**
- ROI: **27.35%**
- hit rate: **63.89%**
- positive walk-forward splits: **5/5**
- minimum split ROI: **6.77%**

These figures are research validation metrics, not a profit guarantee. Live results depend on market availability, spreads, quote freshness, minimum order sizes, latency, and actual fills.

### Session behavior

This profile is **not hard-coded by trading session**. It does not use separate Asia/Europe/US models or separate thresholds per session.

The profitability model does include cyclic calendar features:

- UTC hour sine/cosine;
- day-of-week sine/cosine.

That lets the model learn broad time-of-day behavior without creating separate session routers. Session-specific variants were tested separately, but the current public competition profile stays global for simplicity and robustness.

### Entry and exit behavior

The competition profile is entry-only and holds positions to settlement. Early-exit rules were tested, including take-profit, stop-loss, and trailing-stop variants. They did not improve the high-volume historical strategy enough to justify adding active exit logic to the competition profile.

For agent operators, the recommended workflow is:

1. run `inspect` to verify market data and credential readiness;
2. run the strategy in `paper` until the journal shows clean market selection and pricing;
3. run `dry_run` to verify order construction without posting;
4. enable `live` only with explicit operator approval and small risk caps.

## Runtime modes

The bot should support four modes:

- `inspect`: fetch and print external state only; no strategy decisions; no signing.
- `paper`: run full decision loop with simulated fills; no signing.
- `dry_run`: prepare orders/transactions and validate execution path; do not broadcast.
- `live`: execute on BNB mainnet only after explicit approval and hard risk checks.

## Mainnet posture

We are intentionally targeting **BNB Chain mainnet** rather than testnet, but with small funds and strict safety controls.

Live mode must enforce:

- explicit operator approval flag/config;
- max position size;
- max daily loss;
- data freshness checks;
- BTC 5-minute market filter;
- Trust Wallet readiness checks;
- no live trading while strategy is the noop placeholder;
- no accidental transaction broadcast from inspect/paper/dry-run modes.

## Critical secret-handling rules

**Private keys must never be committed. Private keys must never be saved in this repository.**

Rules for humans and coding agents:

- Do not add private keys to tracked files.
- Do not create `.env` with secrets in the repo.
- Do not commit `.env`, `.env.local`, wallet JSON, seed phrases, key dumps, screenshots, or logs containing secrets.
- Do not print private keys or API keys in logs/test output.
- Use environment variables, local untracked files, OS keychain, or the approved Trust Wallet Agent Kit configuration outside the repo.
- `.env.example` may contain variable names only, never real values.
- If a secret is accidentally written to the working tree, stop immediately, remove it, and notify the operator before committing anything.

## Planned environment variables

Use names like these, but keep real values out of git:

```bash
RUN_MODE=inspect # inspect|paper|dry_run|live
CMC_API_KEY=
PYTH_PRO_API_KEY=
PYTH_HISTORY_BASE_URL=https://pyth.dourolabs.app/v1
PYTH_HISTORY_CHANNEL=real_time
PYTH_HISTORY_SYMBOL=Crypto.BTC/USD
PYTH_HISTORY_LOOKBACK_MINUTES=60
PREDICT_FUN_BASE_URL=https://api.predict.fun
PREDICT_FUN_ACCOUNT_ADDRESS=0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55
PREDICT_FUN_API_KEY=
PREDICT_FUN_API_KEY_FILE=~/.pfkey
PREDICT_FUN_PRIVY_KEY_FILE=~/.predict_privy_key
PREDICT_FUN_JWT_CACHE_FILE=~/.predict_fun_jwt
PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE=60
STRATEGY_SKILL=noop # noop|momentum
STRATEGY_DYNAMIC_EDGE_ENABLED=true
STRATEGY_MIN_EDGE=0.05 # fallback when STRATEGY_DYNAMIC_EDGE_ENABLED=false
STRATEGY_NOTIONAL_USD=0.05
STRATEGY_CANDLE_START_TOLERANCE_SECONDS=90
TRUST_WALLET_AGENT_KIT_ENABLED=true
TRUST_WALLET_AGENT_KIT_CONFIG_PATH=
TWAK_ACCESS_ID=
TWAK_HMAC_SECRET=***
TWAK_AGENT_WALLET_ADDRESS=
TWAK_WALLET_PASSWORD=
TWAK_WALLET_PASSWORD_FILE=
BSC_RPC_URL=
DATABASE_PATH=./data/strike-bot.sqlite
PAPER_JOURNAL_PATH=data/paper/trades.jsonl
MAX_TEST_TRADE_USD=0.10
MAX_POSITION_USD=5
MAX_DAILY_LOSS_USD=10
LOG_LEVEL=info
LIVE_TRADING_APPROVED=false
PREDICT_FUN_REDEMPTION_APPROVED=false
```

The predict.fun Predict account defaults to `0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55` via `PREDICT_FUN_ACCOUNT_ADDRESS`. The predict.fun execution wallet is the Privy private key stored outside the repo, defaulting to `~/.predict_privy_key` via `PREDICT_FUN_PRIVY_KEY_FILE`. The bot may derive and print only the execution wallet address in inspect output; it must never print or persist the private key.

Official predict.fun REST auth is scaffolded through `GET /v1/auth/message` with `x-api-key`, Predict-account message signing, then `POST /v1/auth` with `{ signer, message, signature }`. The returned JWT is cached outside the repository at `PREDICT_FUN_JWT_CACHE_FILE`, defaulting to `~/.predict_fun_jwt`. Inspect reports only readiness fields: account address configured, auth-message endpoint reachability, token-cache presence, and JWT acquisition status. It never prints the API key, private key, signature, or JWT. Auth signing is limited to this Predict-account auth message and does not create, sign, or broadcast transactions.

Live predict.fun order execution is currently limited to official REST `POST /v1/orders`. It builds a signed `LIMIT` `BUY` order with `@predictdotfun/sdk` using the configured Predict account and Privy key, then submits only the REST order payload. It does not run on-chain approvals, transfer funds through TWAK, or broadcast an on-chain transaction. `dry_run` prepares and signs the order but does not POST; returned execution details are redacted and omit signatures, JWTs, API keys, and private keys. `live` additionally requires `LIVE_TRADING_APPROVED=true`, an existing JWT cache file, an OPEN predict.fun market with UP/DOWN on-chain token IDs, available ask pricing, approved risk checks, and `decision.notionalUsd <= MAX_TEST_TRADE_USD <= 0.10`.

Predict.fun redemption is dry-run by default. `npm run redeem-positions` fetches read-only positions and prints the redemption plan with `signing=false` and `broadcasting=false`. The live executor is reachable only with the explicit CLI argument `npm run redeem-positions -- --live`, and it still refuses before reading the wallet or initializing the SDK unless both `LIVE_TRADING_APPROVED=true` and `PREDICT_FUN_REDEMPTION_APPROVED=true` are set, at least one redemption intent exists, the action cap is respected, `PREDICT_FUN_PRIVY_KEY_FILE` points to an external key file, and `BSC_RPC_URL` is configured. Live redemption returns only redacted transaction hash/status fields and must be operator initiated; do not run it automatically.

TWAK is treated as the funding/treasury wallet layer, separate from predict.fun execution signing. Inspect output reports TWAK funding readiness independently, including whether TWAK credentials, CLI, and BSC RPC are ready, and whether an agent wallet address and password source are configured. This readiness reporting does not transfer funds, sign, or broadcast transactions.

For predict.fun, prefer `PREDICT_FUN_API_KEY_FILE` pointing to a secret file outside this repository. When `PREDICT_FUN_API_KEY` is not set, the bot reads `PREDICT_FUN_API_KEY_FILE`; if that variable is also unset, it uses `~/.pfkey` only when the file exists. The key is used only for request headers and is not printed in inspect or tick output.

`PREDICT_FUN_MIN_SECONDS_BEFORE_CLOSE` controls the minimum time remaining for BTC 5-minute UP/DOWN market selection. The default is 60 seconds; markets that are closed, resolved, or already inside that closing window are ignored. If predict.fun marks an upcoming category as tradable/open, it can be selected before its price window starts.

`STRATEGY_DYNAMIC_EDGE_ENABLED=true` makes `MomentumStrategySkill` scale the required edge continuously by time elapsed in the selected 5-minute market, linearly from 6% at market start to 1% at expiry. This keeps early entries selective while allowing progressively smaller edges closer to expiry. Set `STRATEGY_DYNAMIC_EDGE_ENABLED=false` to use the uniform `STRATEGY_MIN_EDGE` fallback.

`STRATEGY_CANDLE_START_TOLERANCE_SECONDS` controls how far the latest Pyth candle `openTime` may differ from the selected predict.fun market `startsAt` before `MomentumStrategySkill` refuses to trade with `candle_market_mismatch`. The default is 90 seconds because predict.fun settles from Chainlink while Pyth is reference data. `MomentumStrategySkill` also refuses to enter before `selectedMarket.startsAt` with `market_not_started`.

`RUN_MODE=paper npm run tick` appends one structured JSONL paper-trading record per tick to `PAPER_JOURNAL_PATH`, defaulting to `data/paper/trades.jsonl`. The generated `data/` tree is ignored by git. Records include run/timestamp, selected BTC 5-minute market, decision and strategy metadata, predict.fun pricing, Pyth candle fields, paper fill details, safety flags, and settlement placeholders initialized to `unknown`/`null`. They intentionally do not include API keys, wallet material, or raw environment configuration. See `docs/paper-journal.md` for the schema and analysis examples.

`npm run settle-paper` reads the configured paper journal, checks official predict.fun settlement for eligible paper entries, and atomically rewrites rows only when predict.fun reports the market as resolved. It updates only the row `settlement` field and reports counts; it does not sign or broadcast anything.

## Expected initial commands

Once implemented:

```bash
npm install
npm test
npm run typecheck
npm run inspect
RUN_MODE=paper npm run tick
npm run positions
npm run redeem-positions
npm run settle-paper
RUN_MODE=dry_run npm run tick
```

Expected early behavior:

- `npm run inspect` prints CMC macro snapshot, Pyth BTC candle metadata, predict.fun BTC 5-minute markets, selected market metadata, read-only orderbook pricing when available, predict.fun REST auth readiness, the derived predict.fun execution wallet address when `PREDICT_FUN_PRIVY_KEY_FILE` is present, and separate TWAK funding wallet readiness. It may sign only the predict.fun auth message if API key, Predict account, Privy key, official SDK, and JWT cache path are ready; it does not sign transactions, transfer funds, or broadcast.
- `RUN_MODE=paper npm run tick` records a no-trade decision with reason `strategy_not_configured` by default and appends it to the paper JSONL journal; `STRATEGY_SKILL=momentum RUN_MODE=paper npm run tick` enables Phase-1 momentum paper decisions with market-start, candle-match, fair-threshold, ask, and edge metadata.
- `npm run positions` fetches read-only predict.fun positions for `PREDICT_FUN_ACCOUNT_ADDRESS`; `npm run redeem-positions` prints a redemption dry-run plan for redeemable positions only. `npm run redeem-positions -- --live` is approval-gated and requires `LIVE_TRADING_APPROVED=true`, `PREDICT_FUN_REDEMPTION_APPROVED=true`, `PREDICT_FUN_PRIVY_KEY_FILE`, and `BSC_RPC_URL` before any wallet read, signing, SDK redemption call, or transaction broadcast can occur.
- `RUN_MODE=live npm run tick` refuses to trade until strategy is configured, TWAK is ready, risk checks pass, the predict.fun REST order prerequisites are present, and `LIVE_TRADING_APPROVED=true` is explicitly set.

## Initial architecture

```text
CMC macro data
    ↓
Macro snapshot / bias context
    ↓
StrategySkill interface (Noop initially)
    ↓
Deterministic decision pipeline ← Pyth Pro BTC low-timeframe OHLC
    ↓
Risk manager ← predict.fun BTC 5m markets / odds / liquidity
    ↓
Executor
    ├─ inspect: no execution
    ├─ paper: simulated fill
    ├─ dry_run: prepare only
    └─ live: predict.fun REST order submission after approval
    ↓
SQLite logs + run reports
```

## Implementation notes for Codex

- Keep the scope narrow: BTC 5-minute UP/DOWN markets on predict.fun only.
- Keep strategy logic deterministic, test-backed, and opt-in; live execution remains approval-gated.
- Use TypeScript/Node.js for the main bot.
- Use Vitest or equivalent for tests.
- Use `zod` or similar for config validation.
- Prefer explicit types and pure functions for domain/risk/decision logic.
- Keep adapters thin and mockable.
- Do not commit generated databases, logs, `.env` files, or secret-bearing artifacts.
- If predict.fun or TWAK integration details are unclear, create a narrow adapter interface and document the unknowns in `docs/open-questions.md` rather than guessing unsafe live behavior.

## Reference planning docs

Hermes planning docs live outside this repo at:

`/home/ubuntu/.hermes/workspace/hackathons/bnbhack-twt-cmc/`

Most relevant file:

`btc-5m-execution-foundation-plan.md`
