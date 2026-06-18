# BNB Hack Submission Requirements

Last verified: 2026-06-18.

## Public Facts

- Hackathon: BNB Hack: AI Trading Agents by BNB Chain, CoinMarketCap, and Trust Wallet.
- Main public pages:
  - https://www.bnbchain.org/en/blog/build-and-compete-for-36-000-in-bnb-hack-ai-trading-agents-by-bnb-chain-coinmarketcap-and-trust-wallet
  - https://coinmarketcap.com/api/hackathon/
  - https://coinmarketcap.com/api/documentation/ai-agent-hub/mcp
  - https://github.com/bnb-chain/bnbagent-sdk
- Build window: June 3-21, 2026.
- Track 1 live trading window: June 22-28, 2026.
- Judging/replay window: June 29-July 5, 2026.
- Winners announced: week of July 6, 2026.
- Prize pool: $36,000 total.

## Track 1: Autonomous Trading Agents

Public requirements and judging signals:

- Build an executable autonomous trading agent that reads markets via CMC, decides, and signs/executes through Trust Wallet Agent Kit within user-defined rules.
- Trade live on BSC during the Track 1 live trading window.
- Judging focuses on real PnL/total return, drawdown cap, minimum trade count, simulated transaction costs, and rule adherence.
- Public BNB Chain blog says Track 1 agents should register on-chain before the trading window opens on June 22, 2026.
- Sponsor stack: CMC MCP/Cognitive Layer, Trust Wallet Agent Kit, BNB AI Agent SDK, and BNB Chain execution venues.

Strike Bot posture:

- Scope remains BTC 5-minute UP/DOWN markets on predict.fun only.
- Default runtime remains safe/noop unless explicitly configured.
- Inspect and paper modes must not sign or broadcast.
- Dry-run may prepare/validate but must not broadcast.
- Live order path remains approval-gated by `LIVE_TRADING_APPROVED=true`, risk caps, market checks, JWT/cache readiness, and TWAK readiness signals where feasible.

## Track 2: Strategy Skills

Public requirements and judging signals:

- Build a CMC Skill that generates trading strategies from market data.
- Deliverable is a backtestable strategy spec, not a live execution layer.
- CMC MCP provides market data, technical analysis, information/news, and advanced metrics tools.
- Public CMC page highlights CMC Agent Hub/Data API, pre-computed indicators, Skills Marketplace, and optional x402.

Strike Bot posture:

- The local Track 2 skill is `skills/cmc-btc5-prediction-market-tuner`.
- It outputs a bounded strategy tuning spec for BTC 5-minute prediction markets.
- It never directly authorizes trades, transfers, signing, or broadcasting.

## CMC Agent Hub / MCP Facts

- Current MCP endpoint: `https://mcp.coinmarketcap.com/mcp`.
- Header auth uses `X-CMC-MCP-API-KEY`.
- Documented tool surface includes live quotes, global metrics, technical analysis, news/info, trending narratives, derivatives data, macro events, and on-chain metrics.
- Strike Bot env vars:
  - `CMC_MCP_URL`
  - `CMC_MCP_API_KEY`
  - `CMC_MCP_API_KEY_FILE`
  - `CMC_AGENT_HUB_ENABLED`

## BNB AI Agent SDK / ERC-8004 Facts

- SDK package: `bnbagent`.
- ERC-8004 provides on-chain agent identity registration and discoverability.
- ERC-8183 agentic commerce is separate and optional for this submission.
- Public SDK README lists active identity registry addresses:
  - BSC Testnet chain ID 97: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
  - BSC Mainnet chain ID 56: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Strike Bot registration tooling is dry-run by default and must not broadcast without explicit operator approval.

## Acceptance Criteria

- `npm run inspect` shows CMC Agent Hub status without leaking API keys.
- `npm run tick` includes visible `agentDecision` stages: observe, tune, plan, guard, act, journal.
- CMC Agent Hub failures fall back to existing REST/stub macro context and produce defensive tuning.
- Track 2 skill package includes usage instructions and reproducible input/output examples.
- BNB Agent SDK registration readiness can validate an agent profile and print a dry-run plan with `broadcasting=false`.
- No live trading, signing, broadcasting, private key reads, secret files, JWTs, signatures, or API keys are committed or printed by these artifacts.

## Open Organizer Questions

- Which wallet is used for Track 1 PnL scoring: the ERC-8004 owner wallet, the actual trading venue wallet, or a submitted list of execution wallets?
- Is predict.fun accepted as a BSC execution venue for Track 1 scoring?
- Must TWAK sign the actual trade transaction/order, or is TWAK funding plus BNB Agent SDK identity acceptable when predict.fun venue auth uses a Privy execution wallet?
- Is ERC-8004 registration required on BSC mainnet or BSC testnet for the hackathon?
- Where should the Track 2 CMC Skill be submitted or listed?
- If multiple wallets are used, should the profile metadata include both TWAK funding and predict.fun execution wallet addresses?
