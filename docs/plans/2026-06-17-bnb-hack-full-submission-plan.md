# BNB Hack Full Submission Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Get `strike-bot` over the line for BNB Hack: AI Trading Agent Edition Track 1 and Track 2 by making the predict.fun BTC 5m bot visibly agentic, CMC-powered, TWAK/BNB-Agent-SDK integrated, safely live-capable, and submission-ready.

**Architecture:** The Track 1 product is an autonomous BNB Chain prediction-market trading agent. CMC Agent Hub provides macro/regime/context signals; a CMC Strategy Skill produces a constrained tuning proposal; deterministic risk-gated execution applies those tiny parameter deltas to predict.fun BTC 5m markets. TWAK is the funding/treasury wallet and BNB Agent SDK provides on-chain ERC-8004 agent identity registration. The predict.fun Privy wallet remains the venue execution signer unless we can link/register the TWAK wallet as the predict.fun trading account.

**Tech Stack:** TypeScript `strike-bot`, Python `strike-bot-research`, predict.fun REST/GraphQL, Pyth Lazer, CoinMarketCap Agent Hub MCP/Data API, Trust Wallet Agent Kit CLI, BNB Agent SDK (`bnbagent`), ERC-8004 identity registry, optional ERC-8183 agent service, systemd paper/live services.

---

## 1. Hackathon Requirements Re-read

Sources reviewed:
- DoraHacks page URL from Ayaz was blocked by AWS WAF in this environment, so I cross-checked equivalent public pages:
  - BNB Chain hackathon page: `https://www.bnbchain.org/en/hackathons/bnbhack-twt-cmc`
  - BNB Chain announcement: `https://www.bnbchain.org/en/blog/build-and-compete-for-36-000-in-bnb-hack-ai-trading-agents-by-bnb-chain-coinmarketcap-and-trust-wallet`
  - CoinMarketCap hackathon page: `https://coinmarketcap.com/api/hackathon/`
  - CMC Agent Hub docs/skill docs: `https://coinmarketcap.com/api/documentation/ai-agent-hub/mcp`, `https://coinmarketcap.com/api/documentation/ai-agent-hub/skills/cmc-mcp.md`
  - BNB Agent SDK repo/README: `https://github.com/bnb-chain/bnbagent-sdk`

Key facts:

- Hackathon: **BNB Hack: AI Trading Agent Edition ⚡️ CoinMarketCap × Trust Wallet**.
- Theme: build crypto-native AI trading agents on BNB Chain that read markets, decide, and execute on-chain.
- Build window: **June 3–21, 2026**.
- Track 1 live trading window: **June 22–28, 2026**.
- Judging week: **week of July 6, 2026**.
- Important note from BNB announcement: **Track 1: register your agent onchain before the trading window opens on June 22.**
- Prize pool: **$36,000**.
- Main tracks:
  - **Track 1: Autonomous Trading Agents — $24,000, 5 winners.** Build an executable agent that reads markets via CMC, decides, signs/executes via TWAK, and trades live on BSC. Scored on live PnL/total return with a max drawdown cap, minimum trade count, and simulated transaction costs.
  - **Track 2: Strategy Skills — $6,000, 3 winners.** Build a CMC Skill that turns market data into a backtestable strategy spec. No execution layer required.
- Special prizes:
  - Best Use of Agent Hub / CMC.
  - Best Use of Trust Wallet Agent Kit / Track 1.
  - Best Use of BNB AI Agent SDK.
- Recommended stack:
  - CMC MCP + Cognitive Layer / Agent Hub for market data and signal layer.
  - Trust Wallet Agent Kit for self-custody local signing, autonomous mode, x402, LangChain/MCP/REST coverage.
  - BNB AI Agent SDK.
  - BNB Chain execution venue.
- CMC Agent Hub exposes a 12-tool MCP/data surface:
  - `search_cryptos`
  - `get_crypto_quotes_latest`
  - `get_crypto_info`
  - `get_crypto_metrics`
  - `get_crypto_technical_analysis`
  - `get_crypto_latest_news`
  - `search_crypto_info`
  - `get_global_metrics_latest`
  - `get_global_crypto_derivatives_metrics`
  - `get_crypto_marketcap_technical_analysis`
  - `trending_crypto_narratives`
  - `get_upcoming_macro_events`
- CMC skill docs say to connect MCP at `https://mcp.coinmarketcap.com/mcp` using header `X-CMC-MCP-API-KEY`.
- BNB Agent SDK provides:
  - ERC-8004 on-chain agent identity registration.
  - ERC-8183 agentic commerce, optional for our submission unless we expose our strategy skill as a paid service.
- ERC-8004 registration gives:
  - unique `agentId` ERC-721 minted to a wallet address,
  - discoverable profile URI with name/description/endpoints,
  - metadata attached to agent record.
- BNB Agent SDK contract addresses from README:
  - BSC Testnet identity registry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`
  - BSC Mainnet identity registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

---

## 2. Submission Positioning

Project framing:

> A CMC-aware, self-custodial BNB Chain prediction-market trading agent. It watches BTC 5-minute predict.fun markets, uses CMC Agent Hub to understand macro/regime/risk context, uses a CMC Strategy Skill to tune a small bounded parameter surface, funds and manages the account through TWAK, and executes only through deterministic risk gates.

Track 1 story:

- The agent is not just a cron job. It has a perception → reasoning/tuning → action loop:
  1. Perceive: CMC macro/regime, Pyth Lazer BTC realtime state, predict.fun market odds/orderbook, wallet/balance state.
  2. Decide/tune: call our CMC Strategy Skill to produce a bounded tuning spec.
  3. Validate: deterministic risk manager clamps/validates every proposal.
  4. Act: fund/treasury ops via TWAK; trade predict.fun only when live gates and auth are present.
  5. Observe: journal PnL, drawdown, trade count, spread/slippage, and produce audit logs.

Track 2 story:

- Submit a standalone CMC Skill that outputs a transparent, backtestable strategy spec for BTC 5m prediction markets.
- The skill should be general enough to count as a CMC Strategy Skill, but concrete enough to match our Track 1 agent:
  - inputs: CMC quotes, TA, global metrics, derivatives metrics, narratives, macro events;
  - outputs: JSON strategy spec with regime, confidence, allowed parameter deltas, risk limits, validity window, and reasoning.

---

## 3. Current State vs Requirements

Already done (updated 2026-06-18):

- predict.fun read-only BTC 5m market discovery and pricing.
- predict.fun REST auth scaffolding and JWT cache path exist.
- predict.fun `POST /v1/orders` live LIMIT BUY path exists behind `RUN_MODE=live`, `LIVE_TRADING_APPROVED=true`, max-test-trade cap, JWT cache, SDK signing, approval checks, and risk gates.
- One-dollar live order payload issues were fixed: LIMIT order body no longer includes rejected `reservedBalancePolicy` / `isFillOrKill` fields.
- Pyth Lazer realtime BTC stream in paper runner.
- Paper journal and settled legacy paper trades.
- EV + direction ensemble paper lane is active in `strike-bot-research` with fresh journal data, fill penalty, direction edge metadata, and no signing/broadcasting.
- TWAK CLI installed and wallet created.
- TWAK funding wallet separated from predict.fun Privy execution wallet.
- predict.fun Privy execution key derives address safely.
- Safety gates: inspect/paper modes are no signing/no broadcasting.
- BNB hack research artifacts and saved candidate configs exist.

Gaps to close for productionisation:

1. **predict.fun position lifecycle is incomplete.**
   - Need live-safe positions adapter for `GET /v1/positions/<wallet>` and normalized rows containing `conditionId`, `indexSet`, amount, market flags, side/outcome, redeemable/mergeable state, and market id.
   - Need redemption executor using SDK `OrderBuilder.redeemPositions({ conditionId, indexSet, amount?, isNegRisk, isYieldBearing })`.
   - Need merge executor for equal opposing positions using SDK `mergePositions({ conditionId, amount, isNegRisk, isYieldBearing })`.
   - All redemption/merge paths must be inspect/dry-run by default and require explicit live approval before transaction broadcast.
2. **Production portfolio/risk accounting is incomplete.**
   - Need open-position exposure, realized PnL, trade count, drawdown, outstanding orders, settlement/redeemable state, and daily caps in a single scorecard.
3. **Agent identity/on-chain registration is not done.**
   - Need ERC-8004 registration via BNB Agent SDK before June 22; mainnet registration still requires explicit Ayaz approval.
4. **CMC Agent Hub is not first-class in the live loop.**
   - Current CMC adapter is only macro snapshot/stub-ish; not Agent Hub MCP/skill-driven.
5. **Strategy tuning is not agentic yet.**
   - Latest rule is configured manually, not produced by a CMC Strategy Skill and clamped by policy.
6. **TWAK funding ops are readiness-only.**
   - Need balance checks, transfer/deposit planning, and live-gated funding operations.
7. **Wallet registration decision is unresolved for Track 1 scoring.**
   - Need decide whether judging tracks the registered ERC-8004 owner wallet, the trading wallet, or arbitrary submitted wallet(s).
8. **Track 2 Agent Skill package is not authored/submitted.**
9. **Demo/submission artifacts are missing.**
   - README, architecture diagram, demo video/script, live dashboard/status, on-chain registration proof, paper/live PnL report.

---

## 4. Critical Wallet / Registration Decision

### The question

Do we register the TWAK funding wallet or the predict.fun Privy execution wallet?

Known addresses:
- TWAK funding wallet: `0xe27d8B7F42a2B553d51B6Eb25D60ee7b34A88264`
- predict.fun execution wallet: `0x694878196b7088E3f44Da94c63F263Ce20D797fC`

### How ERC-8004 registration works

Based on BNB Agent SDK README:

- `ERC8004Agent.register_agent(agent_uri=...)` mints/registers an on-chain agent identity token to the wallet provider address.
- The wallet provider is just an EVM wallet controlled by the agent.
- The profile URI can include endpoints and metadata.
- ERC-8004 identity is primarily for agent discoverability/identity; it is independent from ERC-8183 job commerce.

### Recommended decision

**Default: register the TWAK funding/agent wallet as the ERC-8004 agent identity owner**, and include the predict.fun execution address as metadata/profile field.

Why:
- Track 1 wording emphasizes TWAK for signing/execution and BNB AI Agent SDK for agent identity.
- TWAK wallet is our autonomous agent/funding wallet and best matches “agent wallet”.
- The predict.fun Privy key is venue-specific execution/auth plumbing, not the general agent identity.
- ERC-8004 metadata can disclose the execution wallet as a sub-wallet without putting the identity NFT on the Privy key.

Risk:
- If organizers score live PnL strictly by the ERC-8004 owner address, predict.fun trades executed under the Privy wallet may not count.

Mitigation / urgent action:
- Ask organizers in Telegram/DoraHacks: “For Track 1 on-chain registration and PnL scoring, should the ERC-8004 registered wallet be the agent/TWAK treasury wallet, the actual trading venue wallet, or can metadata include separate execution wallets?”
- If no answer by registration deadline, register TWAK identity and include both wallets in metadata. If the registration contract/SDK permits multiple identities cheaply, also register the predict.fun execution wallet as `execution_wallet` agent identity or create a second linked registration. Do not broadcast mainnet registration without Ayaz approval.

### Agent URI metadata we should use

Profile fields:

```json
{
  "name": "Strike Predict.fun BTC 5m Agent",
  "description": "CMC-aware autonomous prediction-market trading agent for BNB Chain BTC 5-minute markets. Uses CMC Agent Hub for macro/regime tuning, TWAK for self-custodial funding, and predict.fun for execution under strict risk gates.",
  "endpoints": [
    {
      "name": "status",
      "endpoint": "https://<public-host>/agent/status",
      "version": "0.1.0"
    },
    {
      "name": "strategy-skill",
      "endpoint": "https://<public-host>/agent/strategy-skill",
      "version": "0.1.0"
    }
  ],
  "metadata": {
    "track": "BNB Hack Track 1 Autonomous Trading Agents",
    "venue": "predict.fun BTC 5m UP/DOWN",
    "chainId": 56,
    "agentWallet": "0xe27d8B7F42a2B553d51B6Eb25D60ee7b34A88264",
    "executionWallet": "0x694878196b7088E3f44Da94c63F263Ce20D797fC",
    "uses": ["CMC Agent Hub", "Trust Wallet Agent Kit", "BNB Agent SDK", "Pyth Lazer", "predict.fun"],
    "safety": ["max drawdown cap", "max trade size", "no live mode without approval", "audit journal"]
  }
}
```

---

## 5. Implementation Plan

### Phase A — Confirm requirements and make registration-ready

#### Task A1: Save official hackathon facts in repo

**Objective:** Add a durable requirements document with sources and acceptance criteria.

**Files:**
- Create: `docs/hackathon/bnb-hack-requirements.md`

**Steps:**
1. Create `docs/hackathon/bnb-hack-requirements.md` with the facts in sections 1–4 above.
2. Include an explicit “Open organizer questions” section:
   - Which wallet is used for Track 1 PnL scoring?
   - Is predict.fun accepted as a BSC execution venue?
   - Must TWAK sign the actual trade transaction/order, or is TWAK funding + BNB Agent SDK identity acceptable if venue auth uses Privy?
   - Is ERC-8004 registration required on BSC mainnet or testnet?
   - Where should Track 2 CMC Skill be submitted/listed?
3. Run `git diff --check`.
4. Commit: `docs: capture bnb hack submission requirements`.

#### Task A2: Add BNB Agent SDK registration script, dry-run first

**Objective:** Generate agent URI and registration transaction plan without broadcasting.

**Files:**
- Create: `scripts/register_bnb_agent.py`
- Create: `docs/hackathon/agent-profile.json`
- Modify: `.env.example`
- Test: `tests` or a lightweight script test if Python infra is separate

**Implementation notes:**
- Use `bnbagent` package.
- Inputs:
  - `BNB_AGENT_NETWORK=bsc-mainnet|bsc-testnet`
  - `BNB_AGENT_WALLET_MODE=twak|privy|private_key`
  - `BNB_AGENT_PROFILE_PATH=docs/hackathon/agent-profile.json`
  - `BNB_AGENT_DRY_RUN=true` default.
- For initial dry-run, do not import private keys; only generate/validate URI JSON and print target registry/network.
- Never print secrets.

**Verification:**
- `python scripts/register_bnb_agent.py --dry-run` prints network, registry, profile hash/URI preview, selected public wallet address, and `broadcasting=false`.

#### Task A3: Decide/register wallet after Ayaz approval

**Objective:** Execute ERC-8004 registration only once wallet/scoring question is resolved.

**Files:**
- Modify: `docs/hackathon/bnb-hack-requirements.md`
- Artifact: `docs/hackathon/registration-proof.md`

**Steps:**
1. Ask organizers the wallet question.
2. If they say “register trading wallet”, register predict.fun execution wallet or link TWAK to predict.fun first.
3. If they say “register agent wallet”, register TWAK funding wallet.
4. If they say “metadata can list multiple wallets”, register TWAK wallet and include Privy execution wallet in metadata.
5. Broadcast only with explicit Ayaz approval.
6. Save `agentId`, tx hash, chain, registry address, owner wallet, profile URI/hash in `registration-proof.md`.

---

### Phase B — CMC Agent Hub integration

#### Task B1: Add CMC MCP/Agent Hub adapter

**Objective:** Replace macro-only/stub CMC usage with a first-class CMC Agent Hub client surface.

**Files:**
- Create: `src/adapters/CmcAgentHubAdapter.ts`
- Modify: `src/config.ts`
- Test: `tests/cmcAgentHubAdapter.test.ts`

**Inputs:**
- `CMC_MCP_URL=https://mcp.coinmarketcap.com/mcp`
- `CMC_MCP_API_KEY_FILE=~/.cmc-mcp-key` or `CMC_MCP_API_KEY`
- `CMC_AGENT_HUB_ENABLED=true|false`

**Adapter output:**

```ts
export interface CmcAgentHubSnapshot {
  capturedAt: string;
  btc: { id: number; priceUsd?: number; percentChange1h?: number; percentChange24h?: number; percentChange7d?: number; dominance?: number; rsi?: number; macdSignal?: string; emaTrend?: string };
  global: { totalMarketCapChange24h?: number; fearGreed?: number; altcoinSeason?: number; btcDominance?: number; ethDominance?: number };
  derivatives: { fundingBias?: string; openInterestTrend?: string; liquidationSkew?: string };
  narratives: Array<{ name: string; performance24h?: number; volumeChange24h?: number }>;
  macroEvents: Array<{ title: string; date: string; expectedImpact?: string }>;
  source: 'cmc-agent-hub';
  status: 'available' | 'partial' | 'unavailable';
  reasons: string[];
}
```

**Verification:**
- Unit tests use mocked MCP responses.
- Live `npm run inspect` includes `cmcAgentHub.status` but redacts keys.

#### Task B2: Add CMC fallback adapter

**Objective:** Keep the bot running if MCP is unavailable by falling back to existing CMC REST or cached snapshot.

**Files:**
- Modify: `src/adapters/CmcAgentHubAdapter.ts`
- Modify: `src/adapters/CmcAdapter.ts`
- Test: `tests/cmcAgentHubAdapter.test.ts`

**Behavior:**
- MCP first.
- REST macro snapshot second.
- Last good cached snapshot third, marked stale.
- If all fail, strategy tuner must output defensive/no-trade.

---

### Phase C — Track 2 CMC Strategy Skill

#### Task C1: Author the Track 2 Skill package

**Objective:** Create a CMC-compatible Agent Skill that generates a backtestable BTC 5m prediction-market strategy spec.

**Files:**
- Create: `skills/cmc-btc5-prediction-market-tuner/SKILL.md`
- Create: `skills/cmc-btc5-prediction-market-tuner/examples/input.json`
- Create: `skills/cmc-btc5-prediction-market-tuner/examples/output.json`
- Create: `skills/cmc-btc5-prediction-market-tuner/README.md`

**Skill name:** `cmc-btc5-prediction-market-tuner`

**Skill output schema:**

```json
{
  "schemaVersion": 1,
  "strategyFamily": "prediction_market_ev_hgb",
  "market": "BTC_5M_UP_DOWN",
  "regime": {
    "macroBias": "bullish|bearish|neutral|risk_off",
    "volatilityRegime": "low|normal|high|extreme",
    "confidence": 0.0,
    "validForMinutes": 60
  },
  "parameterDeltas": {
    "probabilityThresholdDelta": 0.0,
    "maxEntryPriceDelta": 0.0,
    "minEvEdgeDelta": 0.0,
    "maxNotionalMultiplier": 1.0
  },
  "riskLimits": {
    "maxTradesPerHour": 6,
    "maxDailyDrawdownUsd": 10,
    "maxOpenExposureUsd": 5,
    "forceNoTrade": false
  },
  "reasoning": ["..."],
  "backtestSpec": {
    "features": ["cmc_global_metrics", "cmc_btc_ta", "cmc_derivatives", "pyth_lazer_realtime", "predict_fun_odds"],
    "labels": "predict_fun_btc_5m_settlement_direction",
    "executionAssumptions": { "fillPenalty": 0.01, "fees": 0.0, "slippage": 0.01 }
  }
}
```

**Guardrail:** The skill may only tune parameters slightly. It must never directly authorize a trade, transfer, or signing action.

#### Task C2: Add a local runner for the skill

**Objective:** Allow Track 1 bot to call the same skill logic locally/deterministically.

**Files:**
- Create: `src/strategy/CmcStrategyTuner.ts`
- Test: `tests/cmcStrategyTuner.test.ts`

**Behavior:**
- Input: `CmcAgentHubSnapshot`, model performance state, drawdown state.
- Output: `StrategyTuningSpec` matching Track 2 schema.
- Hard clamps:
  - `probabilityThresholdDelta` ∈ `[-0.03, +0.05]`
  - `maxEntryPriceDelta` ∈ `[-0.05, +0.03]`
  - `minEvEdgeDelta` ∈ `[-0.03, +0.05]`
  - `maxNotionalMultiplier` ∈ `[0, 1.5]`
- Defensive/no-trade if CMC unavailable, extreme volatility, drawdown cap hit, or spreads stale/wide.

#### Task C3: Prepare Track 2 submission artifact

**Objective:** Package the skill for submission with a demo and reproducible examples.

**Files:**
- Create: `docs/hackathon/track2-skill-submission.md`
- Create: `docs/hackathon/track2-demo.md`

**Contents:**
- What the skill does.
- CMC tools used.
- Example CMC snapshot input.
- Example JSON strategy output.
- Backtestability explanation.
- How Track 1 consumes the same output.

---

### Phase D — Agentic Track 1 loop

#### Task D1: Introduce `AgentLoop` orchestration

**Objective:** Make the bot visibly agentic rather than a single strategy tick.

**Files:**
- Create: `src/agent/AgentLoop.ts`
- Create: `src/agent/AgentState.ts`
- Modify: `src/app.ts`
- Test: `tests/agentLoop.test.ts`

**Loop stages:**
1. `observe`: CMC Agent Hub, Pyth Lazer, predict.fun odds, wallet balances.
2. `tune`: run CMC Strategy Skill/Tuner.
3. `plan`: generate candidate trade/funding actions.
4. `guard`: risk manager clamps/rejects.
5. `act`: paper/dry-run/live execution adapters.
6. `journal`: append machine-readable audit record.

**Output:**
- `agentDecision` object in every tick:
  - observations summary,
  - tuner output hash,
  - risk decision,
  - action plan,
  - safety flags.

#### Task D2: Add tuning to paper EV runner

**Objective:** Apply tiny CMC-driven deltas to latest conservative HGB rule in paper mode.

**Files:**
- Modify: `strike-bot-research/scripts/live_paper_ev_runner.py` or move logic into TypeScript service.
- Test: `strike-bot-research/tests/test_live_paper_ev_runner.py`

**Behavior:**
- Base rule remains latest conservative candidate:
  - probability threshold `0.60`
  - max entry `0.60`
  - min EV edge `0.00`
  - fill penalty `0.01`
- Tuner can only make small bounded changes.
- Journal records base params, deltas, final params, CMC snapshot id/hash.

#### Task D3: Add drawdown/trade-count scoring dashboard

**Objective:** Track the judging constraints live.

**Files:**
- Create: `src/reporting/AgentScorecard.ts`
- Test: `tests/agentScorecard.test.ts`
- Create: `docs/hackathon/live-scorecard.md`

**Metrics:**
- total return
- max drawdown
- trade count
- trades/hour
- simulated transaction costs
- win rate
- realized/unrealized PnL
- rejected trade reasons
- CMC availability/staleness

---

### Phase E — TWAK funding wallet operations

#### Task E1: Add read-only balances

**Objective:** Show TWAK funding wallet balances and predict.fun execution wallet balances.

**Files:**
- Modify: `src/adapters/TrustWalletAgentKitAdapter.ts`
- Create: `src/adapters/BscBalanceAdapter.ts` if TWAK CLI lacks ergonomic balance commands.
- Test: `tests/trustWalletAgentKitAdapter.test.ts`

**Assets:**
- BNB gas balance.
- USDT or predict.fun collateral token balance.
- Any predict.fun account balance/deposit info if accessible.

#### Task E2: Add funding plan, dry-run only

**Objective:** Let the agent propose funding predict.fun execution wallet from TWAK wallet without broadcasting.

**Files:**
- Create: `src/funding/FundingPlanner.ts`
- Test: `tests/fundingPlanner.test.ts`

**Behavior:**
- If execution wallet lacks gas/collateral, propose transfer from TWAK wallet.
- Include exact token, amount, recipient, reason, and risk cap.
- Default action is `dry_run` / `requires_approval`.

#### Task E3: Add live funding gate

**Objective:** Enable actual transfer only after explicit Ayaz approval and env flags.

**Required gates:**
- `RUN_MODE=live`
- `LIVE_FUNDING_APPROVED=true`
- `MAX_FUNDING_USD` set
- recipient equals configured predict.fun execution wallet
- token allowlist
- current chain id `56`
- preflight simulation/estimate passes

**Do not enable by default.**

---

### Phase F — predict.fun production trading path

#### Task F0: Confirm current live order path still works in dry-run

**Objective:** Re-baseline the existing order executor before adding position lifecycle features.

**Files:**
- Inspect: `src/execution/PredictFunOrderExecutor.ts`
- Test: `tests/predictFunOrderExecutor.test.ts`

**Steps:**
1. Run `npm test -- tests/predictFunOrderExecutor.test.ts`.
2. Run `npm run typecheck`.
3. Run a safe `RUN_MODE=dry_run npm run tick` with live credentials present but no broadcast.
4. Confirm dry-run prepares a redacted LIMIT order and inspect/paper remain no-sign/no-broadcast.

#### Task F1: Add predict.fun positions adapter

**Objective:** Fetch and normalize execution-wallet positions without signing or broadcasting.

**Files:**
- Create: `src/adapters/PredictFunPositionsAdapter.ts`
- Modify: `src/domain/types.ts`
- Test: `tests/predictFunPositionsAdapter.test.ts`

**Endpoint:**
- `GET /v1/positions/<wallet>` with `x-api-key`.
- Live probe on 2026-06-18:
  - predict account `0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55` returned one resolved DOWN position with nested `market.conditionId`, `market.id`, `market.isNegRisk`, `market.isYieldBearing`, and `outcome.indexSet` / `outcome.onChainId` / `outcome.status`.
  - execution wallet `0x694878196b7088E3f44Da94c63F263Ce20D797fC` returned `200 { cursor:null, data:[], success:true }`.
- Bare `GET /v1/positions` returned `401`, so always query by wallet.

**Normalize:**
- `marketId`
- `conditionId`
- `indexSet`
- `outcome` / `direction`
- `amount` as raw wei/string and decimal display only
- `isNegRisk`
- `isYieldBearing`
- `redeemable` / `mergeable` / `status` if present
- source payload subset redacted of anything sensitive

**Safety:** This adapter is read-only and may run in inspect/paper/dry-run/live.

#### Task F2: Add redemption planner and dry-run CLI

**Objective:** Convert normalized settled/redeemable positions into explicit redemption intents before any transaction.

**Files:**
- Create: `src/execution/PredictFunRedemptionExecutor.ts`
- Modify: `src/cli.ts` to add `positions` and `redeem-positions --dry-run` commands
- Test: `tests/predictFunRedemptionExecutor.test.ts`

**Planner rules:**
1. Redeem only rows with `conditionId` + `indexSet` and redeemable/settled status.
2. For standard markets call SDK `redeemPositions({ conditionId, indexSet, isNegRisk:false, isYieldBearing })`.
3. For neg-risk markets include `amount` and call `redeemPositions({ conditionId, indexSet, amount, isNegRisk:true, isYieldBearing })`.
4. Produce a JSON plan with market IDs, condition IDs, index sets, amount, market flags, and estimated action count.
5. Never print private keys, JWTs, signatures, or raw auth headers.

#### Task F3: Add live redemption gate

**Objective:** Broadcast redemption transactions only when explicitly approved.

**Required gates:**
- explicit command such as `redeem-positions --live`
- `LIVE_TRADING_APPROVED=true` or a separate `PREDICT_FUN_REDEMPTION_APPROVED=true`
- `PREDICT_FUN_PRIVY_KEY_FILE` exists
- `BSC_RPC_URL` / SDK provider healthy
- dry-run plan in the same command reports at least one eligible action
- max action count cap unless overridden by explicit flag

**Verification:**
- Unit tests with fake `OrderBuilder.redeemPositions`.
- Live dry-run against current execution wallet.
- No live broadcast without Ayaz approval.

#### Task F4: Add merge planner for equal opposing positions

**Objective:** Recover collateral from balanced UP/DOWN positions before settlement when safe.

**Files:**
- Extend: `src/execution/PredictFunRedemptionExecutor.ts`
- Test: `tests/predictFunRedemptionExecutor.test.ts`

**Rules:**
1. Group positions by `conditionId`.
2. If both sides exist, compute the minimum common amount.
3. In dry-run, output `mergePositions({ conditionId, amount, isNegRisk, isYieldBearing })` intent.
4. Live merge uses a separate approval flag from live trading/redemption unless Ayaz explicitly approves bulk lifecycle ops.

#### Task F5: Add portfolio/scorecard accounting

**Objective:** Make live readiness measurable: open exposure, realized PnL, redeemables, mergeables, trade count, and drawdown.

**Files:**
- Create: `src/storage/PortfolioJournal.ts` or extend `RunRepository` position tables
- Create: `src/reporting/Scorecard.ts`
- Test: `tests/scorecard.test.ts`

**Output:**
- open positions by market/side
- total at-risk USDT
- realized PnL from redeemed/settled rows
- unresolved exposure
- redeemable amount/actions
- max drawdown estimate
- hackathon trade count

#### Task F6: Keep live order submission gate strict

**Objective:** Submit live orders only after all gates are green. The order path exists; keep production gates explicit.

**Required gates:**
- `RUN_MODE=live`
- `LIVE_TRADING_APPROVED=true`
- valid predict.fun JWT from the official `/v1/auth/message` → `/v1/auth` flow
- max drawdown not hit
- max order size enforced
- market close guard
- spread/price sanity
- CMC snapshot fresh
- Pyth feed fresh
- TWAK/registered wallet decision documented
- paper/dry-run passed

---

### Phase G — Demo and submission artifacts

#### Task G1: Update main README for hackathon

**Files:**
- Modify: `README.md`

**Must include:**
- Track 1 architecture.
- Track 2 skill package.
- How CMC Agent Hub is used.
- How TWAK is used.
- How BNB Agent SDK/registration is used.
- Safety/risk gates.
- How to run inspect/paper/dry-run/live.

#### Task G2: Add architecture diagram

**Files:**
- Create: `docs/hackathon/architecture.md`
- Optional: `docs/hackathon/architecture.svg`

**Diagram:**
CMC Agent Hub → Strategy Skill/Tuner → Agent Loop → Risk Manager → predict.fun/TWAK → Journal/Scorecard.

#### Task G3: Demo script and video checklist

**Files:**
- Create: `docs/hackathon/demo-script.md`

**Demo beats:**
1. Show agent registered on-chain with tx hash/agentId.
2. Show CMC Agent Hub snapshot.
3. Show Strategy Skill output.
4. Show paper/live agent loop decision.
5. Show TWAK funding wallet status.
6. Show predict.fun selected market and price.
7. Show risk gates rejecting unsafe actions.
8. If live auth/funding approved, show tiny live trade and scorecard.

#### Task G4: Submission checklist

**Files:**
- Create: `docs/hackathon/submission-checklist.md`

**Checklist:**
- DoraHacks project profile.
- GitHub repo link.
- Agent registration tx/agentId.
- Track 1 wallet address(es).
- Track 2 skill path/submission link.
- Demo video.
- Live scorecard/PnL proof.
- CMC/TWAK/BNB SDK usage notes.
- Risk disclaimer.

---

## 6. Immediate Priority Order

1. **Add predict.fun positions + redemption dry-run.** This closes the biggest production lifecycle gap before real funds accumulate stuck settled positions.
2. **Add portfolio/scorecard accounting.** Needed for live PnL, drawdown, trade count, redeemables, and operator decisions.
3. **Re-baseline dry-run/live order gates.** Ensure the existing one-dollar-tested order path still works after lifecycle changes.
4. **Ask/resolve wallet registration/PnL scoring question.** This remains the highest external ambiguity.
5. **Implement BNB Agent SDK ERC-8004 dry-run registration script.** Be ready to register once approved.
6. **Make CMC Agent Hub first-class in inspect and paper logs.** This is required for both main story and special prize.
7. **Create Track 2 Skill package.** It is low-risk and directly prize-eligible.
8. **Wire CMC Strategy Skill/Tuner into paper loop with bounded deltas.** Makes the bot demonstrably agentic.
9. **Add TWAK balance/funding planner.** Gives Trust Wallet Agent Kit a real role beyond readiness.
10. **Prepare demo/submission docs.**

---

## 7. What Still Needs User/External Input

- CMC MCP/API key location if not already configured.
- Organizer answer on ERC-8004 wallet vs trading wallet/PnL scoring.
- Whether Ayaz wants any mainnet registration broadcast before all live-trading blockers are solved.
- predict.fun JWT from the official API-key + Predict-account signing flow.
- Confirm exact non-empty `/v1/positions/<wallet>` response fields after we have live positions; current wallet returned an empty `data[]` on 2026-06-18.
- Explicit approval before any live redemption, merge, funding transfer, agent registration, or live order broadcast.
- Funding amount and explicit approval if we move money from TWAK to predict.fun execution wallet.
- Public endpoint/domain for agent status/profile URI, unless we use IPFS/static JSON.

---

## 8. Acceptance Criteria for “Ready to Submit”

Track 1:
- ERC-8004 agent registration complete or dry-run complete plus clear reason if organizer says not needed.
- Agent profile includes CMC/TWAK/BNB SDK/predict.fun architecture.
- Agent loop logs CMC Agent Hub observations and strategy tuning output.
- TWAK funding wallet has balance/status/funding planner, with no unsafe defaults.
- Paper/live scorecard shows PnL, drawdown, trade count, and safety gates.
- Live trading either:
  - runs with tiny approved size and valid predict.fun auth, or
  - demo clearly shows signed dry-run/live-readiness if predict.fun auth remains externally blocked.

Track 2:
- CMC Skill package exists with README, examples, schema, and backtestability section.
- Skill uses CMC Agent Hub tools explicitly.
- Skill output is consumed by Track 1 agent or demonstrably compatible.

Submission:
- DoraHacks project page complete.
- Repo public/accessible as required.
- Demo video/script ready.
- On-chain registration proof ready.
- No secrets committed.
