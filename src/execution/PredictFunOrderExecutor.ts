import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AppConfig, RunMode } from "../config.js";
import type {
  BtcFiveMinuteMarket,
  EnterDecision,
  ExecutionResult,
  MarketPricing,
  PredictFunMarket,
  RedactedPredictFunOrderDetails,
  StrategyDecision
} from "../domain/types.js";
import type { RiskCheckResult } from "../risk/RiskManager.js";
import { normalizePrivateKey } from "../adapters/PredictFunExecutionWalletAdapter.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type ModuleLoader = (specifier: string) => Promise<unknown>;
type UnknownRecord = Record<string, unknown>;

export class PredictFunOrderExecutor {
  constructor(
    private readonly config: Pick<
      AppConfig,
      | "predictFunBaseUrl"
      | "predictFunApiKey"
      | "predictFunAccountAddress"
      | "predictFunPrivyKeyFile"
      | "predictFunJwtCacheFile"
      | "liveTradingApproved"
      | "maxTestTradeUsd"
    >,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly loadModule: ModuleLoader = defaultModuleLoader
  ) {}

  async execute(
    decision: StrategyDecision,
    mode: RunMode,
    context: {
      readonly selectedMarket?: BtcFiveMinuteMarket;
      readonly pricing?: MarketPricing;
      readonly risk?: RiskCheckResult;
    } = {}
  ): Promise<ExecutionResult> {
    if (decision.action === "no_trade") {
      return {
        mode,
        broadcast: false,
        status: "skipped",
        reason: decision.reason,
        decision
      };
    }

    if (mode === "paper") {
      return {
        mode,
        broadcast: false,
        status: "paper_recorded",
        decision
      };
    }

    if (mode !== "dry_run" && mode !== "live") {
      return {
        mode,
        broadcast: false,
        status: "prepared_not_broadcast",
        decision
      };
    }

    const validationFailure = this.validateExecutionInputs(decision, mode, context);
    if (validationFailure) {
      return {
        mode,
        broadcast: false,
        status: "skipped",
        reason: validationFailure,
        decision
      };
    }

    try {
      let jwt: string | undefined;
      if (mode === "live") {
        jwt = (await readFile(this.config.predictFunJwtCacheFile, "utf8")).trim();
        if (jwt.length === 0) {
          return this.skipped(mode, decision, "predict_fun_jwt_cache_missing");
        }
      }

      const prepared = await this.prepareOrder(decision, mode, context.selectedMarket, context.pricing);

      if (mode === "dry_run") {
        return {
          mode,
          broadcast: false,
          status: "prepared_not_broadcast",
          decision,
          details: prepared.details
        };
      }

      const response = await this.fetchImpl(new URL("/v1/orders", this.config.predictFunBaseUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": this.config.predictFunApiKey ?? "",
          authorization: `Bearer ${jwt}`
        },
        body: JSON.stringify(prepared.body)
      });

      if (!response.ok) {
        return {
          mode,
          broadcast: false,
          status: "skipped",
          reason: `predict_fun_order_post_failed_${response.status}`,
          decision,
          details: { ...prepared.details, apiStatus: response.status }
        };
      }

      return {
        mode,
        broadcast: true,
        status: "broadcast",
        decision,
        details: { ...prepared.details, apiStatus: response.status }
      };
    } catch (error) {
      return this.skipped(mode, decision, predictFunOrderFailureReason(error));
    }
  }

  private validateExecutionInputs(
    decision: EnterDecision,
    mode: RunMode,
    context: {
      readonly selectedMarket?: BtcFiveMinuteMarket;
      readonly pricing?: MarketPricing;
      readonly risk?: RiskCheckResult;
    }
  ): string | undefined {
    if (!this.config.predictFunApiKey) {
      return "predict_fun_api_key_missing";
    }

    if (!context.risk?.approved) {
      return "risk_rejected";
    }

    if (mode === "live") {
      if (!this.config.liveTradingApproved) {
        return "live_not_approved";
      }
      if (this.config.maxTestTradeUsd > 0.1 || decision.notionalUsd > this.config.maxTestTradeUsd) {
        return "max_test_trade_exceeded";
      }
      if (!existsSync(this.config.predictFunJwtCacheFile)) {
        return "predict_fun_jwt_cache_missing";
      }
    }

    if (!context.selectedMarket || context.selectedMarket.id !== decision.marketId) {
      return "market_not_selected";
    }

    if (context.selectedMarket.status !== "open") {
      return "market_not_supported";
    }

    if (mode === "live" && context.selectedMarket.tradingStatus !== "OPEN") {
      return "market_not_supported";
    }

    if (!context.selectedMarket.outcomeOnChainIds?.[decision.direction]) {
      return "predict_fun_outcome_token_missing";
    }

    if (context.selectedMarket.feeRateBps === undefined) {
      return "predict_fun_fee_rate_missing";
    }

    if (context.selectedMarket.isNegRisk === undefined || context.selectedMarket.isYieldBearing === undefined) {
      return "predict_fun_market_flags_missing";
    }

    const ask = askForDirection(context.pricing, decision.direction);
    if (!context.pricing || context.pricing.status !== "available" || ask === undefined) {
      return "pricing_unavailable";
    }

    return undefined;
  }

  private async prepareOrder(
    decision: EnterDecision,
    mode: RunMode,
    market: BtcFiveMinuteMarket | PredictFunMarket | undefined,
    pricing: MarketPricing | undefined
  ): Promise<{
    readonly body: unknown;
    readonly details: RedactedPredictFunOrderDetails;
  }> {
    if (!market || !pricing) {
      throw new Error("predict_fun_order_inputs_missing");
    }

    const ask = askForDirection(pricing, decision.direction);
    const tokenId = market.outcomeOnChainIds?.[decision.direction];
    if (ask === undefined || !tokenId || market.feeRateBps === undefined) {
      throw new Error("predict_fun_order_inputs_missing");
    }

    const [sdk, ethers] = await Promise.all([this.loadModule("@predictdotfun/sdk"), this.loadModule("ethers")]);
    const sdkRecord = asRecord(sdk);
    const ethersRecord = asRecord(ethers);
    const orderBuilder = asRecord(sdkRecord["OrderBuilder"]);
    const chainId = asRecord(sdkRecord["ChainId"]);
    const side = asRecord(sdkRecord["Side"]);
    const Wallet = ethersRecord["Wallet"];
    const make = orderBuilder["make"];

    if (typeof make !== "function" || typeof Wallet !== "function" || chainId["BnbMainnet"] === undefined || side["BUY"] === undefined) {
      throw new Error("predict_fun_sdk_order_builder_unavailable");
    }

    const privateKey = normalizePrivateKey(await readFile(this.config.predictFunPrivyKeyFile, "utf8"));
    const wallet = new (Wallet as new (privateKey: string) => unknown)(`0x${privateKey.toString("hex")}`);
    const builder = asOrderBuilder(
      await make(chainId["BnbMainnet"], wallet, {
        predictAccount: this.config.predictFunAccountAddress
      })
    );
    const pricePerShareWei = decimalUsdToWei(ask);
    const makerAmount = decimalUsdToWei(decision.notionalUsd);
    const quantityWei = (makerAmount * WEI) / pricePerShareWei;
    const amounts = builder.getLimitOrderAmounts({
      side: side["BUY"],
      pricePerShareWei,
      quantityWei
    });

    if (mode === "live") {
      await assertBuyApprovalReady(builder, side["BUY"], market, amounts.makerAmount);
    }

    const order = builder.buildOrder("LIMIT", {
      side: side["BUY"],
      tokenId,
      makerAmount: amounts.makerAmount,
      takerAmount: amounts.takerAmount,
      nonce: 0n,
      feeRateBps: market.feeRateBps
    });
    const typedData = builder.buildTypedData(order, {
      isNegRisk: Boolean(market.isNegRisk),
      isYieldBearing: Boolean(market.isYieldBearing)
    });
    const signedOrder = builder.signTypedDataOrder(typedData);
    const resolvedSignedOrder = signedOrder instanceof Promise ? await signedOrder : signedOrder;
    const hash = builder.buildTypedDataHash(typedData);
    const orderWithHash = { ...resolvedSignedOrder, hash };
    const pricePerShare = stringifyBigNumberish(amounts.pricePerShare);

    const body = sanitizeForJson({
      data: {
        order: orderWithHash,
        pricePerShare,
        strategy: "LIMIT",
        isFillOrKill: true,
        isPostOnly: false,
        reservedBalancePolicy: "REJECT_MARKET_ORDER",
        selfTradePrevention: "CANCEL_MAKER"
      }
    });

    return {
      body,
      details: {
        marketId: market.id,
        direction: decision.direction,
        tokenId,
        hash,
        pricePerShare,
        pricePerShareWei: pricePerShareWei.toString(),
        makerAmount: stringifyBigNumberish(amounts.makerAmount),
        takerAmount: stringifyBigNumberish(amounts.takerAmount),
        feeRateBps: market.feeRateBps,
        strategy: "LIMIT",
        isFillOrKill: true,
        isPostOnly: false,
        reservedBalancePolicy: "REJECT_MARKET_ORDER",
        selfTradePrevention: "CANCEL_MAKER"
      }
    };
  }

  private skipped(mode: RunMode, decision: StrategyDecision, reason: string): ExecutionResult {
    return {
      mode,
      broadcast: false,
      status: "skipped",
      reason,
      decision
    };
  }
}

const WEI = 1_000_000_000_000_000_000n;

function askForDirection(pricing: MarketPricing | undefined, direction: EnterDecision["direction"]): number | undefined {
  return direction === "UP" ? pricing?.up.bestAsk : pricing?.down.bestAsk;
}

function decimalUsdToWei(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("predict_fun_order_amount_invalid");
  }
  return BigInt(Math.round(value * 1e18));
}

function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, sanitizeForJson(nestedValue)]));
  }
  return value;
}

function stringifyBigNumberish(value: unknown): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function predictFunOrderFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    if (error.message.startsWith("ENOENT:")) {
      return "predict_fun_privy_key_file_missing";
    }
    if (error.message.startsWith("Cannot find package") || error.message.includes("ERR_MODULE_NOT_FOUND")) {
      return "predict_fun_sdk_order_builder_unavailable";
    }
    if (error.message.startsWith("predict_fun_")) {
      return error.message;
    }
  }
  return "predict_fun_order_prepare_failed";
}

async function safeResponseText(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}…` : text;
  } catch {
    return undefined;
  }
}

function defaultModuleLoader(specifier: string): Promise<unknown> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport(specifier);
}

interface SdkOrderBuilder {
  getLimitOrderAmounts(data: unknown): {
    readonly pricePerShare: unknown;
    readonly makerAmount: unknown;
    readonly takerAmount: unknown;
  };
  getApprovalSteps?(scope: unknown): unknown[];
  checkApprovals?(steps: unknown[]): Promise<readonly { readonly satisfied: boolean }[]>;
  buildOrder(strategy: "LIMIT", data: unknown): unknown;
  buildTypedData(order: unknown, options: { readonly isNegRisk: boolean; readonly isYieldBearing: boolean }): unknown;
  signTypedDataOrder(typedData: unknown): Promise<unknown> | unknown;
  buildTypedDataHash(typedData: unknown): string;
}

async function assertBuyApprovalReady(
  builder: SdkOrderBuilder,
  buySide: unknown,
  market: BtcFiveMinuteMarket | PredictFunMarket,
  makerAmount: unknown
): Promise<void> {
  if (typeof builder.getApprovalSteps !== "function" || typeof builder.checkApprovals !== "function") {
    return;
  }

  const steps = builder.getApprovalSteps({
    operation: "TRADE",
    isNegRisk: Boolean(market.isNegRisk),
    isYieldBearing: Boolean(market.isYieldBearing),
    side: buySide
  });
  const checks = await builder.checkApprovals(steps);
  if (checks.some((check) => !check.satisfied)) {
    throw new Error(`predict_fun_approval_missing_${stringifyBigNumberish(makerAmount)}`);
  }
}

function asOrderBuilder(value: unknown): SdkOrderBuilder {
  const record = asRecord(value);
  for (const key of ["getLimitOrderAmounts", "buildOrder", "buildTypedData", "signTypedDataOrder", "buildTypedDataHash"]) {
    if (typeof record[key] !== "function") {
      throw new Error("predict_fun_sdk_order_builder_unavailable");
    }
  }
  return record as unknown as SdkOrderBuilder;
}

function isRecord(value: unknown): value is UnknownRecord {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

