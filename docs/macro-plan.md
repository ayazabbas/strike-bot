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
