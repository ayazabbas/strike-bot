# Open Questions

- Confirm the exact authenticated predict.fun `GET /v1/markets` response shape for BTC 5-minute UP/DOWN markets. The adapter now maps several plausible field names but intentionally returns an empty snapshot on missing API key, non-2xx response, or unmappable payload.
- Confirm the installed official `@predictdotfun/sdk` auth semantics stay compatible with `OrderBuilder.make(ChainId.BnbMainnet, wallet, { predictAccount })` and `signPredictAccountMessage(message)`. REST auth scaffolding now uses `GET /v1/auth/message`, `POST /v1/auth`, and an external JWT cache; live order placement is still unimplemented.
- Confirm predict.fun order preparation and settlement APIs/contracts before any dry-run transaction construction. Order placement remains unimplemented and no broadcast path exists.
- Confirm the Trust Wallet Agent Kit runtime command expected by the hackathon environment. Readiness now checks env credentials (`TWAK_ACCESS_ID` + `TWAK_HMAC_SECRET`), an external credentials file, BSC RPC config, and optional `twak`/`trustwallet` CLI presence, but it does not sign or store credentials.
- Confirm whether Pyth Pro BTC 5-minute candle access should remain direct REST History API (`https://pyth.dourolabs.app/v1/{channel}/history`) or move to another approved feed once credentials/environment are finalized.
- Confirm whether CoinMarketCap macro context should use latest quotes, global metrics, or a narrower BTC-only endpoint.
