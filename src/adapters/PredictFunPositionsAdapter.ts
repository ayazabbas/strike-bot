import type { AppConfig } from "../config.js";
import type { MarketDirection, PredictFunPosition, PredictFunPositionsSnapshot } from "../domain/types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /api[-_]?key|authorization|bearer|jwt|token|secret|signature|private|password/i;

export interface PredictFunPositionsAdapter {
  getPositions(): Promise<PredictFunPositionsSnapshot>;
}

export class RestPredictFunPositionsAdapter implements PredictFunPositionsAdapter {
  constructor(
    private readonly config: Pick<AppConfig, "predictFunBaseUrl" | "predictFunApiKey" | "predictFunAccountAddress">,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async getPositions(): Promise<PredictFunPositionsSnapshot> {
    const capturedAt = new Date();
    const walletAddress = this.config.predictFunAccountAddress;

    if (!this.config.predictFunApiKey) {
      return unavailableSnapshot(walletAddress, capturedAt, "predict_fun_api_key_missing");
    }

    try {
      const response = await this.fetchImpl(
        new URL(`/v1/positions/${encodeURIComponent(walletAddress)}`, this.config.predictFunBaseUrl),
        {
          method: "GET",
          headers: {
            accept: "application/json",
            "x-api-key": this.config.predictFunApiKey
          }
        }
      );

      if (!response.ok) {
        return unavailableSnapshot(
          walletAddress,
          capturedAt,
          `predict_fun_positions_fetch_failed_${response.status}`,
          await safeApiError(response)
        );
      }

      const payload = await response.json().catch(() => undefined);
      return {
        walletAddress,
        capturedAt,
        source: "predict.fun",
        status: "available",
        positions: extractPositionItems(payload).flatMap((item) => normalizePosition(item, walletAddress, capturedAt))
      };
    } catch (error) {
      return unavailableSnapshot(walletAddress, capturedAt, "predict_fun_positions_fetch_failed", truncate(String(error)));
    }
  }
}

function unavailableSnapshot(
  walletAddress: string,
  capturedAt: Date,
  reason: string,
  apiError?: string
): PredictFunPositionsSnapshot {
  return {
    walletAddress,
    capturedAt,
    source: "predict.fun",
    status: "unavailable",
    reason,
    ...(apiError ? { apiError } : {}),
    positions: []
  };
}

function extractPositionItems(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["data", "positions"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value) && Array.isArray(value["positions"])) {
      return value["positions"].filter(isRecord);
    }
  }

  return [];
}

function normalizePosition(item: UnknownRecord, walletAddress: string, capturedAt: Date): PredictFunPosition[] {
  const amount = firstStringOrNumber(item, [
    "amount",
    "amountRaw",
    "amount_raw",
    "balance",
    "balanceRaw",
    "balance_raw",
    "shares",
    "size",
    "quantity"
  ]);

  if (!amount) {
    return [];
  }

  const market = asRecord(item["market"]);
  const positionOutcome = asRecord(item["outcome"]);
  const decodedId = decodePositionId(firstString(item, ["id"]));
  const outcome =
    firstString(item, ["outcomeName", "outcome_name", "side", "direction", "name"]) ??
    firstString(positionOutcome, ["name", "outcome", "side", "direction"]);
  const outcomeStatus = firstString(positionOutcome, ["status", "state"]);
  const marketStatus = firstString(market, ["status", "state"]);
  const status = firstString(item, ["status", "state", "positionStatus", "position_status"]) ?? outcomeStatus ?? marketStatus;
  const redeemable =
    firstBoolean(item, ["redeemable", "isRedeemable", "is_redeemable", "canRedeem", "can_redeem"]) ??
    (outcomeStatus?.toUpperCase() === "WON" && marketStatus?.toUpperCase() === "RESOLVED" ? true : undefined);

  return [
    {
      walletAddress,
      ...optionalString(
        "marketId",
        firstStringOrNumber(item, ["marketId", "market_id", "market", "market_id_num", "categoryId"]) ??
          firstStringOrNumber(market, ["id", "marketId", "market_id"]) ??
          decodedId?.marketId
      ),
      ...optionalString(
        "conditionId",
        firstStringOrNumber(item, ["conditionId", "condition_id", "condition", "questionId", "question_id"]) ??
          firstStringOrNumber(market, ["conditionId", "condition_id", "condition"])
      ),
      ...optionalString(
        "indexSet",
        firstStringOrNumber(item, ["indexSet", "index_set", "index", "outcomeIndexSet", "outcome_index_set"]) ??
          firstStringOrNumber(positionOutcome, ["indexSet", "index_set", "index"]) ??
          decodedId?.indexSet
      ),
      ...optionalString(
        "token",
        firstStringOrNumber(item, ["token", "tokenId", "token_id", "asset", "assetId", "asset_id"]) ??
          firstStringOrNumber(positionOutcome, ["onChainId", "on_chain_id", "tokenId", "token_id", "assetId", "asset_id"])
      ),
      ...optionalString("outcome", outcome),
      ...optionalDirection(normalizeDirection(outcome ?? firstString(item, ["side", "direction"]))),
      amount,
      ...optionalNumber(
        "amountDisplay",
        firstNumber(item, ["amountDisplay", "amount_display", "displayAmount", "display_amount", "amountDecimal"]) ??
          weiStringToDecimal(amount)
      ),
      ...optionalBoolean(
        "isNegRisk",
        firstBoolean(item, ["isNegRisk", "is_neg_risk", "negRisk", "neg_risk"]) ??
          firstBoolean(market, ["isNegRisk", "is_neg_risk", "negRisk", "neg_risk"])
      ),
      ...optionalBoolean(
        "isYieldBearing",
        firstBoolean(item, ["isYieldBearing", "is_yield_bearing", "yieldBearing", "yield_bearing"]) ??
          firstBoolean(market, ["isYieldBearing", "is_yield_bearing", "yieldBearing", "yield_bearing"])
      ),
      ...optionalString("status", status),
      ...optionalBoolean("redeemable", redeemable),
      ...optionalBoolean("mergeable", firstBoolean(item, ["mergeable", "isMergeable", "is_mergeable", "canMerge", "can_merge"])),
      capturedAt,
      source: "predict.fun",
      raw: compactRaw(item)
    }
  ];
}

function compactRaw(item: UnknownRecord): UnknownRecord {
  const raw: UnknownRecord = {};
  for (const key of [
    "id",
    "marketId",
    "market_id",
    "conditionId",
    "condition_id",
    "indexSet",
    "index_set",
    "tokenId",
    "token_id",
    "outcome",
    "side",
    "direction",
    "amount",
    "balance",
    "status",
    "redeemable",
    "mergeable",
    "isNegRisk",
    "isYieldBearing"
  ]) {
    if (key in item && !SENSITIVE_KEY_PATTERN.test(key)) {
      const value = item[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
        raw[key] = typeof value === "string" ? truncate(value, 120) : value;
      }
    }
  }
  return raw;
}

async function safeApiError(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");
  if (!text) {
    return undefined;
  }
  if (contentType.includes("application/json")) {
    try {
      return truncate(redactJson(JSON.parse(text)));
    } catch {
      return truncate(text);
    }
  }
  return truncate(text);
}

function redactJson(value: unknown): string {
  return JSON.stringify(value, (key, nestedValue) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return "[redacted]";
    }
    return typeof nestedValue === "string" ? truncate(nestedValue, 120) : nestedValue;
  });
}

function firstString(item: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function firstStringOrNumber(item: UnknownRecord, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "bigint") {
      return value.toString();
    }
  }
  return undefined;
}

function firstNumber(item: UnknownRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function firstBoolean(item: UnknownRecord, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") {
        return true;
      }
      if (value.toLowerCase() === "false") {
        return false;
      }
    }
  }
  return undefined;
}

function weiStringToDecimal(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const whole = value.length > 18 ? value.slice(0, -18) : "0";
  const fraction = value.padStart(19, "0").slice(-18).replace(/0+$/, "");
  const decimal = Number(fraction.length > 0 ? `${whole}.${fraction}` : whole);
  return Number.isFinite(decimal) ? decimal : undefined;
}

function decodePositionId(value: string | undefined): { readonly marketId?: string; readonly indexSet?: string } | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    return {
      ...optionalString("marketId", firstStringOrNumber(parsed, ["marketId", "market_id"])),
      ...optionalString("indexSet", firstStringOrNumber(parsed, ["indexSet", "index_set"]))
    };
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function normalizeDirection(value: string | undefined): MarketDirection | undefined {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "UP" || normalized === "YES") {
    return "UP";
  }
  if (normalized === "DOWN" || normalized === "NO") {
    return "DOWN";
  }
  return undefined;
}

function optionalString<K extends string>(key: K, value: string | undefined): { readonly [P in K]?: string } {
  return (value ? { [key]: value } : {}) as { readonly [P in K]?: string };
}

function optionalNumber<K extends string>(key: K, value: number | undefined): { readonly [P in K]?: number } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: number };
}

function optionalBoolean<K extends string>(key: K, value: boolean | undefined): { readonly [P in K]?: boolean } {
  return (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: boolean };
}

function optionalDirection(value: MarketDirection | undefined): { readonly direction?: MarketDirection } {
  return value ? { direction: value } : {};
}

function truncate(value: string, maxLength = 300): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
