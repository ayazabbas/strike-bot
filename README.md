# Strike Bot

AI-tuned, mechanically executed prediction-market trading agent for the **BNB Hack: AI Trading Agent Edition**.

Initial scope is intentionally narrow:

- **Market:** Bitcoin 5-minute UP/DOWN markets only.
- **Venue:** predict.fun.
- **Chain:** BNB Chain mainnet.
- **Macro context:** CoinMarketCap.
- **Low-timeframe OHLC/reference data:** Pyth Pro.
- **Wallet/action layer:** Trust Wallet Agent Kit (TWAK) where feasible/required for hackathon alignment.
- **Strategy:** not implemented yet. Build structure, data plumbing, risk gates, paper/dry-run/live execution shells, and logs first.

## Current objective

Build the execution foundation before strategy work:

1. Project scaffold and config validation.
2. Domain types for BTC 5-minute prediction markets.
3. Adapters for CMC, Pyth Pro, predict.fun, and Trust Wallet Agent Kit.
4. Deterministic strategy interface with a `NoopStrategySkill` placeholder.
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
PREDICT_FUN_API_KEY=
TRUST_WALLET_AGENT_KIT_ENABLED=true
TRUST_WALLET_AGENT_KIT_CONFIG_PATH=
TWAK_ACCESS_ID=
TWAK_HMAC_SECRET=
BSC_RPC_URL=
DATABASE_PATH=./data/strike-bot.sqlite
MAX_POSITION_USD=5
MAX_DAILY_LOSS_USD=10
LOG_LEVEL=info
LIVE_TRADING_APPROVED=false
```

If a wallet private key is ever needed for local development fallback, it must come from an environment variable or untracked local secret file outside the repository. Prefer TWAK-backed signing for hackathon alignment.

## Expected initial commands

Once implemented:

```bash
npm install
npm test
npm run typecheck
npm run inspect
RUN_MODE=paper npm run tick
RUN_MODE=dry_run npm run tick
```

Expected early behavior:

- `npm run inspect` prints CMC macro snapshot, Pyth BTC candle metadata, predict.fun BTC 5-minute markets, and TWAK readiness.
- `RUN_MODE=paper npm run tick` records a no-trade decision with reason `strategy_not_configured` until strategy work starts.
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
- Build the structure and adapters first; do not invent strategy logic yet.
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
