# Strike Bot

AI-tuned, mechanically executed prediction-market trading agent for the **BNB Hack: AI Trading Agent Edition**.

Initial scope is intentionally narrow:

- **Market:** Bitcoin 5-minute UP/DOWN markets only.
- **Venue:** predict.fun.
- **Chain:** BNB Chain mainnet.
- **Macro context:** CoinMarketCap.
- **Low-timeframe OHLC/reference data:** Pyth Pro.
- **Wallet/action layer:** Trust Wallet Agent Kit (TWAK) where feasible/required for hackathon alignment.
- **Strategy:** default is the safe `NoopStrategySkill`; opt in to the Phase-1 momentum paper strategy with `STRATEGY_SKILL=momentum`.

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
MAX_POSITION_USD=5
MAX_DAILY_LOSS_USD=10
LOG_LEVEL=info
LIVE_TRADING_APPROVED=false
```

The predict.fun Predict account defaults to `0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55` via `PREDICT_FUN_ACCOUNT_ADDRESS`. The predict.fun execution wallet is the Privy private key stored outside the repo, defaulting to `~/.predict_privy_key` via `PREDICT_FUN_PRIVY_KEY_FILE`. The bot may derive and print only the execution wallet address in inspect output; it must never print or persist the private key.

Official predict.fun REST auth is scaffolded through `GET /v1/auth/message` with `x-api-key`, Predict-account message signing, then `POST /v1/auth` with `{ signer, message, signature }`. The returned JWT is cached outside the repository at `PREDICT_FUN_JWT_CACHE_FILE`, defaulting to `~/.predict_fun_jwt`. Inspect reports only readiness fields: account address configured, auth-message endpoint reachability, token-cache presence, and JWT acquisition status. It never prints the API key, private key, signature, or JWT. Auth signing is limited to this Predict-account auth message and does not create, sign, or broadcast transactions.

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
npm run settle-paper
RUN_MODE=dry_run npm run tick
```

Expected early behavior:

- `npm run inspect` prints CMC macro snapshot, Pyth BTC candle metadata, predict.fun BTC 5-minute markets, selected market metadata, read-only orderbook pricing when available, predict.fun REST auth readiness, the derived predict.fun execution wallet address when `PREDICT_FUN_PRIVY_KEY_FILE` is present, and separate TWAK funding wallet readiness. It may sign only the predict.fun auth message if API key, Predict account, Privy key, official SDK, and JWT cache path are ready; it does not sign transactions, transfer funds, or broadcast.
- `RUN_MODE=paper npm run tick` records a no-trade decision with reason `strategy_not_configured` by default and appends it to the paper JSONL journal; `STRATEGY_SKILL=momentum RUN_MODE=paper npm run tick` enables Phase-1 momentum paper decisions with market-start, candle-match, fair-threshold, ask, and edge metadata.
- `RUN_MODE=live npm run tick` refuses to trade until strategy is configured, TWAK is ready, risk checks pass, and `LIVE_TRADING_APPROVED=true` is explicitly set.

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
    └─ live: TWAK/onchain execution after approval
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
