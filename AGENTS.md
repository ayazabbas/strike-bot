# Codex Instructions for Strike Bot

Read `README.md` before making changes.

## Hard requirements

- Never commit private keys, seed phrases, wallet JSON, `.env`, logs containing secrets, databases containing secrets, screenshots of secrets, or API keys.
- Keep real credentials outside the repo. `.env.example` may contain names only.
- Target BNB Chain mainnet with small funds, but live execution must remain approval-gated.
- Trust Wallet Agent Kit is a required integration target for dry-run/live execution paths where feasible.
- Scope is BTC 5-minute UP/DOWN markets on predict.fun only.
- Do not implement exact strategy logic yet; use a `NoopStrategySkill` placeholder until strategy work is explicitly requested.

## Coding preferences

- Main bot: TypeScript/Node.js.
- Tests: Vitest or equivalent.
- Config validation: zod or equivalent.
- Keep adapters thin and mockable.
- Keep domain/risk/decision logic deterministic and unit-tested.
- Prefer explicit failure/no-trade states over unsafe guesses.

## Expected safe modes

- `inspect`: external state only, no decision, no signing.
- `paper`: simulated fills only.
- `dry_run`: prepare/validate execution, no broadcast.
- `live`: only after explicit approval, TWAK readiness, and hard risk checks.
