import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config.js";
import { normalizePrivateKey } from "../adapters/PredictFunExecutionWalletAdapter.js";
import type {
  PredictFunRedemptionExecutionResult,
  PredictFunRedemptionIntent,
  PredictFunRedemptionPlan,
  RedactedPredictFunRedemptionTxResult
} from "../domain/types.js";

type ModuleLoader = (specifier: string) => Promise<unknown>;
type UnknownRecord = Record<string, unknown>;

export class PredictFunRedemptionExecutor {
  constructor(
    private readonly config: Pick<
      AppConfig,
      | "predictFunAccountAddress"
      | "predictFunPrivyKeyFile"
      | "bscRpcUrl"
      | "liveTradingApproved"
      | "predictFunRedemptionApproved"
    >,
    private readonly loadModule: ModuleLoader = defaultModuleLoader,
    private readonly maxActions = 20
  ) {}

  async execute(plan: PredictFunRedemptionPlan, mode: "dry_run" | "live"): Promise<PredictFunRedemptionExecutionResult> {
    if (mode === "dry_run") {
      return {
        mode,
        dryRun: true,
        status: "prepared_not_broadcast",
        intentsCount: plan.intents.length,
        safety: { signing: false, broadcasting: false },
        plan
      };
    }

    const validationFailure = this.validateLiveInputs(plan);
    if (validationFailure) {
      return this.skipped(plan, validationFailure);
    }

    let liveActionAttempted = false;
    try {
      const [sdk, ethers] = await Promise.all([this.loadModule("@predictdotfun/sdk"), this.loadModule("ethers")]);
      const sdkRecord = asRecord(sdk);
      const ethersRecord = asRecord(ethers);
      const orderBuilder = asRecord(sdkRecord["OrderBuilder"]);
      const chainId = asRecord(sdkRecord["ChainId"]);
      const Wallet = ethersRecord["Wallet"];
      const make = orderBuilder["make"];

      if (typeof make !== "function" || typeof Wallet !== "function" || chainId["BnbMainnet"] === undefined) {
        throw new Error("predict_fun_sdk_order_builder_unavailable");
      }

      const privateKey = normalizePrivateKey(await readFile(this.config.predictFunPrivyKeyFile, "utf8"));
      const wallet = new (Wallet as new (privateKey: string) => unknown)(`0x${privateKey.toString("hex")}`);
      const builder = asRedemptionOrderBuilder(
        await make(chainId["BnbMainnet"], wallet, {
          predictAccount: this.config.predictFunAccountAddress,
          rpcUrl: this.config.bscRpcUrl
        })
      );

      const txResults: RedactedPredictFunRedemptionTxResult[] = [];
      for (const [intentIndex, intent] of plan.intents.entries()) {
        liveActionAttempted = true;
        const tx = await builder.redeemPositions(intent.sdkParams);
        txResults.push(redactedTxResult(intentIndex, intent, tx));
      }

      return {
        mode,
        dryRun: false,
        status: "broadcast",
        intentsCount: plan.intents.length,
        safety: { signing: true, broadcasting: true },
        txResults
      };
    } catch (error) {
      return {
        mode,
        dryRun: false,
        status: "failed",
        reason: predictFunRedemptionFailureReason(error),
        intentsCount: plan.intents.length,
        safety: { signing: liveActionAttempted, broadcasting: liveActionAttempted }
      };
    }
  }

  private validateLiveInputs(plan: PredictFunRedemptionPlan): string | undefined {
    if (!this.config.liveTradingApproved) {
      return "live_not_approved";
    }
    if (!this.config.predictFunRedemptionApproved) {
      return "predict_fun_redemption_not_approved";
    }
    if (plan.intents.length === 0) {
      return "no_redeemable_intents";
    }
    if (plan.intents.length > this.maxActions) {
      return "max_actions_exceeded";
    }
    if (!this.config.predictFunPrivyKeyFile || !existsSync(this.config.predictFunPrivyKeyFile)) {
      return "predict_fun_privy_key_file_missing";
    }
    if (!this.config.bscRpcUrl) {
      return "bsc_rpc_url_missing";
    }
    return undefined;
  }

  private skipped(plan: PredictFunRedemptionPlan, reason: string): PredictFunRedemptionExecutionResult {
    return {
      mode: "live",
      dryRun: false,
      status: "skipped",
      reason,
      intentsCount: plan.intents.length,
      safety: { signing: false, broadcasting: false }
    };
  }
}

interface SdkRedemptionOrderBuilder {
  redeemPositions(params: unknown): Promise<unknown> | unknown;
}

function redactedTxResult(
  intentIndex: number,
  intent: PredictFunRedemptionIntent,
  value: unknown
): RedactedPredictFunRedemptionTxResult {
  const record = asRecord(value);
  return {
    intentIndex,
    conditionId: intent.conditionId,
    indexSet: intent.indexSet,
    ...firstString(record, ["hash", "transactionHash", "txHash"], "txHash"),
    ...firstString(record, ["status"], "status")
  };
}

function firstString(record: UnknownRecord, keys: readonly string[], outputKey: "txHash" | "status") {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return { [outputKey]: String(value) };
    }
  }
  return {};
}

function predictFunRedemptionFailureReason(error: unknown): string {
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
  return "predict_fun_redemption_failed";
}

function defaultModuleLoader(specifier: string): Promise<unknown> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport(specifier);
}

function asRedemptionOrderBuilder(value: unknown): SdkRedemptionOrderBuilder {
  const record = asRecord(value);
  if (typeof record["redeemPositions"] !== "function") {
    throw new Error("predict_fun_sdk_order_builder_unavailable");
  }
  return record as unknown as SdkRedemptionOrderBuilder;
}

function isRecord(value: unknown): value is UnknownRecord {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}
