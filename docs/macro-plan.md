# Macro Plan: Foundation to Real Data Adapters

## Goal

Continue from the initial scaffold until the bot can run real read-only data plumbing for:

1. predict.fun BTC 5-minute market discovery.
2. Trust Wallet Agent Kit readiness / dry-run integration boundary.
3. Pyth Pro BTC low-timeframe OHLC/reference data.

Stop before exact strategy implementation. Live trading remains disabled unless explicitly approved at runtime and all hard gates pass.

## Scope through Step 4

### Step 1 — Push scaffold

- Push the current local scaffold to `origin/main`.
- Keep private keys and secrets out of the repository.
- Verify repo remains clean after push.

### Step 2 — predict.fun read-only integration

- Discover predict.fun API/contract surface.
- Implement read-only market discovery for BTC 5-minute UP/DOWN markets where feasible.
- Update `PredictFunAdapter` from safe stub to a real read-only client if an API is discoverable.
- Preserve safe fallback behavior if the API is blocked/undocumented.
- Document unknowns in `docs/open-questions.md`.

### Step 3 — Trust Wallet Agent Kit integration boundary

- Research TWAK package/API shape.
- Update `TrustWalletAgentKitAdapter` with concrete readiness checks and dry-run boundary if feasible.
- Do not broadcast transactions.
- Keep raw ethers/private-key usage out of the primary path.
- Document any unresolved TWAK integration questions.

### Step 4 — Pyth Pro BTC OHLC integration

- Research Pyth Pro endpoints for BTC low-timeframe OHLC/reference data.
- Implement `PythAdapter` real read-only fetch where feasible.
- Add freshness checks and normalized candle output.
- Keep behavior safe if API key/config is missing.

## Safety rules

- Never commit private keys, seed phrases, wallet files, `.env`, logs with secrets, or generated DB files.
- `.env.example` may contain variable names only.
- `inspect`, `paper`, and `dry_run` must never broadcast transactions.
- `live` must remain approval-gated.
- Do not implement exact strategy logic during this phase.

## Process log

### 2026-06-12

- Created this macro planning doc at `docs/macro-plan.md`.
- Current repo state before continuing: two local commits exist (`docs: add strike bot project guidance`, `feat: scaffold btc 5m execution foundation`), tests/typecheck/audit passed, no uncommitted changes except this planning doc.
- Committed the macro plan and pushed `main` to GitHub.
- Researched predict.fun developer docs. Confirmed REST base `https://api.predict.fun`, read-only market endpoint `GET /v1/markets`, orderbook endpoint `GET /v1/markets/{marketId}/orderbook`, and required `x-api-key` header. Public unauthenticated calls return `401 unauthorized`, so the adapter must be safe/read-only but needs `PREDICT_FUN_API_KEY` for live discovery.
- Researched predict.fun SDK. Confirmed official TypeScript package `@predictdotfun/sdk` with `OrderBuilder`, `ChainId.BnbMainnet`, approval helpers, market/limit order builders, and BNB mainnet contract constants. Do not wire live signing yet.
- Added official predict.fun REST auth scaffolding: `GET /v1/auth/message` with `x-api-key`, Predict-account message signing through the official SDK shape when installed, `POST /v1/auth`, and JWT caching at `~/.predict_fun_jwt` by default. Inspect reports only readiness/status fields and never prints API keys, private keys, signatures, or JWTs.
- Researched Pyth Pro History API. Confirmed base `https://pyth.dourolabs.app/v1`; `GET /{channel}/history` provides TradingView-format OHLC with `symbol`, `from`, `to`, `resolution`; resolution `5` is 5 minutes. Verified `GET /v1/real_time/history?symbol=Crypto.BTC/USD&resolution=5` returns BTC candles without auth.
- Researched Trust Wallet Agent Kit. Confirmed Trust Wallet Agent SDK/TWAK docs recommend `@trustwallet/cli` / `twak`, developer portal credentials, `~/.twak/credentials.json`, and env vars `TWAK_ACCESS_ID` + `TWAK_HMAC_SECRET`; use TWAK readiness checks without storing secrets in repo.
- Implemented Step 2 read-only predict.fun `GET /v1/markets` adapter with optional `PREDICT_FUN_API_KEY`, safe empty snapshots when credentials/network/API shape are unavailable, and no order placement or broadcast path.
- Implemented Step 3 TWAK readiness checks for env credentials, external credentials files, BSC RPC config, and CLI presence. The adapter does not store credentials, sign transactions, or broadcast.
- Implemented Step 4 Pyth History API adapter for `Crypto.BTC/USD`, `resolution=5`, recent `from`/`to` timestamps, normalized latest OHLC candle metadata, and stub fallback on API errors.
- Added unit tests with mocked fetch/TWAK readiness inputs. `npm test` and `npm run typecheck` passed locally after implementation.
