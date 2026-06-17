import type { AppConfig } from "../config.js";
import type {
  MarketDirection,
  MarketPricing,
  MarketSettlement,
  MarketSidePricing,
  MarketSnapshot,
  PredictFunMarket
} from "../domain/types.js";

export interface PredictFunAdapter {
  listMarkets(): Promise<MarketSnapshot>;
  getOrderbookPricing(marketId: string): Promise<MarketPricing>;
  getMarketSettlement(marketId: string): Promise<MarketSettlement>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

export class RestPredictFunAdapter implements PredictFunAdapter {
  constructor(
    private readonly config: Pick<AppConfig, "predictFunBaseUrl" | "predictFunApiKey">,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async listMarkets(): Promise<MarketSnapshot> {
    const capturedAt = new Date();

    if (!this.config.predictFunApiKey) {
      return { capturedAt, markets: [] };
    }

    try {
      const [marketPayload, ...categoryPayloads] = await Promise.all([
        this.fetchJson("/v1/markets?first=100"),
        this.fetchJson("/v1/categories?first=100&status=OPEN&marketVariant=CRYPTO_UP_DOWN"),
        ...currentBtcFiveMinuteCategoryPaths(capturedAt).map((path) => this.fetchJson(path))
      ]);
      const marketItems = extractMarketItems(marketPayload);
      const categoryMarketItems = categoryPayloads.flatMap(extractCategoryMarketItems);

      return {
        capturedAt,
        markets: dedupeMarkets([...marketItems, ...categoryMarketItems].flatMap((item) => mapPredictFunMarket(item, capturedAt)))
      };
    } catch {
      return { capturedAt, markets: [] };
    }
  }

  async getOrderbookPricing(marketId: string): Promise<MarketPricing> {
    const capturedAt = new Date();

    if (!this.config.predictFunApiKey) {
      return unknownPricing(marketId, capturedAt);
    }

    try {
      const payload =
        (await this.fetchJson(`/v1/markets/${encodeURIComponent(marketId)}`)) ??
        (await this.fetchJson(`/v1/markets/${encodeURIComponent(marketId)}/orderbook`)) ??
        (await this.fetchJson(`/v1/markets/orderbooks?ids=${encodeURIComponent(marketId)}`));
      return normalizeOrderbookPricing(marketId, payload, capturedAt);
    } catch {
      return unknownPricing(marketId, capturedAt);
    }
  }

  async getMarketSettlement(marketId: string): Promise<MarketSettlement> {
    const capturedAt = new Date();

    if (!this.config.predictFunApiKey) {
      return unknownSettlement(marketId, capturedAt);
    }

    try {
      const payload = await this.fetchJson(`/v1/markets/${encodeURIComponent(marketId)}`);
      return normalizeMarketSettlement(marketId, payload, capturedAt);
    } catch {
      return unknownSettlement(marketId, capturedAt);
    }
  }

  private async fetchJson(path: string): Promise<unknown> {
    const url = new URL(path, this.config.predictFunBaseUrl);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": this.config.predictFunApiKey ?? ""
      }
    });

    if (!response?.ok) {
      return undefined;
    }

    return response.json() as Promise<unknown>;
  }
}

export class StubPredictFunAdapter implements PredictFunAdapter {
  async listMarkets(): Promise<MarketSnapshot> {
    return {
      capturedAt: new Date(),
      markets: []
    };
  }

  async getOrderbookPricing(marketId: string): Promise<MarketPricing> {
    return unknownPricing(marketId, new Date());
  }

  async getMarketSettlement(marketId: string): Promise<MarketSettlement> {
    return unknownSettlement(marketId, new Date());
  }
}

export function makeStubPredictFunMarket(overrides: Partial<PredictFunMarket> = {}): PredictFunMarket {
  const now = new Date();
  return {
    id: "stub-btc-5m",
    venue: "predict.fun",
    asset: "BTC",
    intervalMinutes: 5,
    directions: ["UP", "DOWN"],
    startsAt: now,
    closesAt: new Date(now.getTime() + 5 * 60 * 1000),
    resolvesAt: new Date(now.getTime() + 6 * 60 * 1000),
    liquidityUsd: 0,
    status: "open",
    ...overrides
  };
}

function extractMarketItems(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["markets", "data", "items", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value)) {
      const nested = extractMarketItems(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function extractCategoryMarketItems(payload: unknown): UnknownRecord[] {
  return extractCategoryItems(payload).flatMap((category) => {
    if (!Array.isArray(category["markets"])) {
      return [];
    }

    return category["markets"].filter(isRecord).map((market) => ({
      ...market,
      categorySlug: firstString(market, ["categorySlug", "category_slug"]) ?? firstString(category, ["slug", "categorySlug"]),
      categoryStatus: firstString(category, ["status"]),
      categoryTitle: firstString(category, ["title", "shortTitle"]),
      categoryStartsAt: firstString(category, ["startsAt", "startTime", "start_time"]),
      categoryEndsAt: firstString(category, ["endsAt", "endTime", "end_time"]),
      feeRateBps: market["feeRateBps"] ?? market["fee_rate_bps"] ?? category["feeRateBps"] ?? category["fee_rate_bps"],
      isNegRisk: market["isNegRisk"] ?? market["is_neg_risk"] ?? category["isNegRisk"] ?? category["is_neg_risk"],
      isYieldBearing:
        market["isYieldBearing"] ?? market["is_yield_bearing"] ?? category["isYieldBearing"] ?? category["is_yield_bearing"],
      startsAt: firstString(market, ["startsAt", "startTime", "start_time"]) ?? firstString(category, ["startsAt", "startTime", "start_time"]),
      endsAt: firstString(market, ["endsAt", "endTime", "end_time"]) ?? firstString(category, ["endsAt", "endTime", "end_time"])
    }));
  });
}

function extractCategoryItems(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  if (Array.isArray(payload["markets"])) {
    return [payload];
  }

  for (const key of ["categories", "data", "items", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
    if (isRecord(value)) {
      const nested = extractCategoryItems(value);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function currentBtcFiveMinuteCategoryPaths(now: Date): string[] {
  const currentBucketSeconds = Math.floor(now.getTime() / 1000 / 300) * 300;
  return Array.from({ length: 12 }, (_, index) => `/v1/categories/btc-updown-5m-${currentBucketSeconds + index * 300}`);
}

function mapPredictFunMarket(item: UnknownRecord, capturedAt: Date): PredictFunMarket[] {
  const id = firstString(item, ["id", "marketId", "market_id", "slug", "address"]);
  if (!id) {
    return [];
  }

  const text = [
    firstString(item, ["title", "name", "question", "description", "categoryTitle", "categorySlug", "marketVariant"]),
    firstString(item, ["symbol", "asset", "underlying", "ticker"])
  ]
    .filter(Boolean)
    .join(" ");
  const asset = normalizeAsset(firstString(item, ["asset", "baseAsset", "underlying", "symbol", "ticker"]), text);
  const directions = normalizeDirections(item, text);

  const startsAt = firstDate(item, ["startsAt", "startTime", "start_time", "openTime", "open_time", "startDate", "categoryStartsAt"], capturedAt);
  const explicitClosesAt = firstDateOptional(item, [
    "closesAt",
    "closeTime",
    "close_time",
    "endsAt",
    "endTime",
    "end_time",
    "expirationTime",
    "expiresAt",
    "categoryEndsAt"
  ]);
  const intervalMinutes = normalizeIntervalMinutes(item, text, startsAt, explicitClosesAt);
  const closesAt = firstDate(
    item,
    ["closesAt", "closeTime", "close_time", "endsAt", "endTime", "end_time", "expirationTime", "expiresAt", "categoryEndsAt"],
    new Date(startsAt.getTime() + intervalMinutes * 60 * 1000)
  );
  const resolvesAt = firstDate(
    item,
    ["resolvesAt", "resolveTime", "resolve_time", "settlementTime", "settlesAt"],
    new Date(closesAt.getTime() + 60 * 1000)
  );

  return [
    {
      id,
      venue: "predict.fun",
      asset,
      intervalMinutes,
      directions,
      outcomeOnChainIds: normalizeOutcomeOnChainIds(item),
      feeRateBps: firstNumber(item, ["feeRateBps", "fee_rate_bps", "feeBps", "fee_bps"]),
      isNegRisk: firstBoolean(item, ["isNegRisk", "is_neg_risk", "negRisk", "neg_risk"]),
      isYieldBearing: firstBoolean(item, ["isYieldBearing", "is_yield_bearing", "yieldBearing", "yield_bearing"]),
      tradingStatus: firstString(item, ["tradingStatus", "trading_status"]),
      categorySlug: firstString(item, ["categorySlug", "category_slug"]),
      startsAt,
      closesAt,
      resolvesAt,
      liquidityUsd: firstNumber(item, ["liquidityUsd", "liquidity_usd", "liquidity", "volumeUsd", "volume_usd"]),
      status: normalizeMarketStatus(item)
    }
  ];
}

function normalizeAsset(value: string | undefined, text: string): string {
  const candidate = value?.toUpperCase();
  if (candidate?.includes("BTC") || candidate?.includes("BITCOIN")) {
    return "BTC";
  }
  if (/\b(BTC|BITCOIN|CRYPTO\.BTC\/USD|BTC\/USDT)\b/i.test(text)) {
    return "BTC";
  }
  return candidate ?? "UNKNOWN";
}

function normalizeIntervalMinutes(item: UnknownRecord, text: string, startsAt: Date, closesAt: Date | undefined): number {
  const direct = firstNumber(item, ["intervalMinutes", "interval_minutes", "durationMinutes", "duration_minutes", "resolution"]);
  if (direct && direct > 0) {
    return direct;
  }

  const timeframe = firstString(item, ["interval", "timeframe", "duration", "resolution"]);
  const parsedTimeframe = timeframe ? parseIntervalText(timeframe) : undefined;
  if (parsedTimeframe) {
    return parsedTimeframe;
  }

  if (closesAt && closesAt.getTime() > startsAt.getTime()) {
    const diffMinutes = (closesAt.getTime() - startsAt.getTime()) / 60_000;
    if (Number.isInteger(diffMinutes) && diffMinutes > 0) {
      return diffMinutes;
    }
  }

  const parsedText = parseIntervalText(text);
  if (parsedText) {
    return parsedText;
  }

  return 0;
}

function parseIntervalText(value: string): number | undefined {
  if (/\b5\s*(?:m|min|mins|minute|minutes)\b/i.test(value) || /\b5-minute\b/i.test(value)) {
    return 5;
  }
  if (/btc-updown-5m-/i.test(value) || /CRYPTO_UP_DOWN/i.test(value)) {
    return 5;
  }
  return undefined;
}

function normalizeDirections(item: UnknownRecord, text: string): readonly MarketDirection[] {
  const values = [
    ...arrayStrings(item["directions"]),
    ...arrayStrings(item["outcomes"]),
    ...arrayStrings(item["options"])
  ].join(" ");
  const candidate = `${values} ${text}`;
  const hasUp = /\b(up|higher|above)\b/i.test(candidate);
  const hasDown = /\b(down|lower|below)\b/i.test(candidate);
  return hasUp && hasDown ? ["UP", "DOWN"] : [];
}

function normalizeOutcomeOnChainIds(item: UnknownRecord): Partial<Record<MarketDirection, string>> | undefined {
  const result: Partial<Record<MarketDirection, string>> = {};
  const outcomes = Array.isArray(item["outcomes"]) ? item["outcomes"].filter(isRecord) : [];

  for (const outcome of outcomes) {
    const direction = normalizeDirectionName(firstString(outcome, ["name", "label", "outcome", "direction"]));
    const onChainId = firstString(outcome, [
      "onChainId",
      "onchainId",
      "on_chain_id",
      "tokenId",
      "token_id",
      "assetId",
      "asset_id"
    ]);
    if (direction && onChainId) {
      result[direction] = onChainId;
    }
  }

  const upDirect = firstString(item, ["upOnChainId", "up_on_chain_id", "upTokenId", "up_token_id"]);
  const downDirect = firstString(item, ["downOnChainId", "down_on_chain_id", "downTokenId", "down_token_id"]);
  if (upDirect) {
    result.UP = upDirect;
  }
  if (downDirect) {
    result.DOWN = downDirect;
  }

  return result.UP || result.DOWN ? result : undefined;
}

function normalizeDirectionName(value: string | undefined): MarketDirection | undefined {
  const normalized = value?.toUpperCase();
  if (normalized === "UP" || normalized === "HIGHER" || normalized === "ABOVE") {
    return "UP";
  }
  if (normalized === "DOWN" || normalized === "LOWER" || normalized === "BELOW") {
    return "DOWN";
  }
  return undefined;
}

function normalizeMarketStatus(item: UnknownRecord): PredictFunMarket["status"] {
  const tradingStatus = normalizeStatus(firstString(item, ["tradingStatus", "trading_status"]));
  if (tradingStatus === "open") {
    return "open";
  }

  const marketStatus = normalizeStatus(firstString(item, ["status", "state"]));
  if (marketStatus !== "closed") {
    return marketStatus;
  }

  return normalizeStatus(firstString(item, ["categoryStatus"]));
}

function normalizeStatus(value: string | undefined): PredictFunMarket["status"] {
  const normalized = value?.toLowerCase();
  if (normalized === "open" || normalized === "opened" || normalized === "active" || normalized === "trading") {
    return "open";
  }
  if (normalized === "closed") {
    return "closed";
  }
  if (normalized === "resolving") {
    return "resolving";
  }
  if (normalized === "settled") {
    return normalized;
  }
  if (normalized === "resolved") {
    return "settled";
  }
  return "closed";
}

function firstString(item: UnknownRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(item: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function firstBoolean(item: UnknownRecord, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
  }
  return undefined;
}

function firstDate(item: UnknownRecord, keys: string[], fallback: Date): Date {
  return firstDateOptional(item, keys) ?? fallback;
}

function firstDateOptional(item: UnknownRecord, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = item[key];
    const date = parseDate(value);
    if (date) {
      return date;
    }
  }
  return undefined;
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function arrayStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item : isRecord(item) ? firstString(item, ["name", "label", "title"]) : undefined))
    .filter((item): item is string => Boolean(item));
}

function dedupeMarkets(markets: PredictFunMarket[]): PredictFunMarket[] {
  const byId = new Map<string, PredictFunMarket>();
  for (const market of markets) {
    byId.set(market.id, market);
  }
  return [...byId.values()];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrderbookPricing(marketId: string, payload: unknown, capturedAt: Date): MarketPricing {
  const source = findOrderbookPayload(payload, marketId);
  const up = normalizeSidePricing(source, "UP");
  const down = normalizeSidePricing(source, "DOWN");
  const spread = averageSpread([up, down]);
  const available =
    up.bestBid !== undefined || up.bestAsk !== undefined || down.bestBid !== undefined || down.bestAsk !== undefined;

  return {
    marketId,
    capturedAt,
    source: "predict.fun",
    status: available ? "available" : "unknown",
    up,
    down,
    ...(spread !== undefined ? { spread } : {})
  };
}

function unknownPricing(marketId: string, capturedAt: Date): MarketPricing {
  return {
    marketId,
    capturedAt,
    source: "predict.fun",
    status: "unknown",
    up: {},
    down: {}
  };
}

function normalizeSidePricing(payload: unknown, direction: MarketDirection): MarketSidePricing {
  const bestBid = bestPrice(payload, direction, "bid");
  const bestAsk = bestPrice(payload, direction, "ask");
  const impliedProbability =
    bestBid !== undefined && bestAsk !== undefined ? roundProbability((bestBid + bestAsk) / 2) : undefined;

  return {
    ...(bestBid !== undefined ? { bestBid } : {}),
    ...(bestAsk !== undefined ? { bestAsk } : {}),
    ...(impliedProbability !== undefined ? { impliedProbability } : {})
  };
}

function bestPrice(payload: unknown, direction: MarketDirection, side: "bid" | "ask"): number | undefined {
  const prices = [...collectOutcomePrices(payload, direction, side), ...collectPrices(payload, direction, side)];
  if (prices.length === 0) {
    return undefined;
  }
  return side === "bid" ? Math.max(...prices) : Math.min(...prices);
}

function collectOutcomePrices(payload: unknown, direction: MarketDirection, side: "bid" | "ask"): number[] {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectOutcomePrices(item, direction, side));
  }
  if (!isRecord(payload)) {
    return [];
  }

  const outcomes = Array.isArray(payload["outcomes"]) ? payload["outcomes"].filter(isRecord) : [];
  const direct = outcomes.flatMap((outcome) => {
    const name = firstString(outcome, ["name", "label", "outcome", "direction"]);
    if (name?.toUpperCase() !== direction) {
      return [];
    }
    const best = outcome[side === "bid" ? "bestBid" : "bestAsk"];
    const price = isRecord(best) ? normalizePrice(firstNumber(best, ["price", "rate", "odds", "p", "limitPrice"])) : normalizePrice(best);
    return price === undefined ? [] : [price];
  });

  return [...direct, ...Object.values(payload).flatMap((value) => collectOutcomePrices(value, direction, side))];
}

function collectPrices(payload: unknown, direction: MarketDirection, side: "bid" | "ask"): number[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectPrices(item, direction, side));
  }

  if (!isRecord(payload)) {
    return [];
  }

  const directSide = firstRecord(payload, directionKeys(direction));
  if (directSide) {
    return [...levelPrices(directSide[side]), ...levelPrices(directSide[side === "bid" ? "bids" : "asks"])];
  }

  const sideValues = [
    payload[side],
    payload[side === "bid" ? "bids" : "asks"],
    payload[side === "bid" ? "buy" : "sell"],
    payload[side === "bid" ? "BUY" : "SELL"]
  ];
  const matchingLevels = sideValues.flatMap((value) => levelPricesForDirection(value, direction));
  const nested = Object.values(payload).flatMap((value) => collectPrices(value, direction, side));
  return [...matchingLevels, ...nested];
}

function levelPrices(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((level) => extractPrice(level)).filter((price): price is number => price !== undefined);
}

function levelPricesForDirection(value: unknown, direction: MarketDirection): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((level) => levelMatchesDirection(level, direction))
    .map((level) => extractPrice(level))
    .filter((price): price is number => price !== undefined);
}

function levelMatchesDirection(level: unknown, direction: MarketDirection): boolean {
  if (Array.isArray(level)) {
    return false;
  }
  if (!isRecord(level)) {
    return false;
  }
  const value = firstString(level, ["direction", "outcome", "outcomeName", "sideName", "token", "label", "name"]);
  return value?.toUpperCase() === direction;
}

function extractPrice(level: unknown): number | undefined {
  if (Array.isArray(level)) {
    return normalizePrice(level[0]);
  }
  if (!isRecord(level)) {
    return normalizePrice(level);
  }
  return normalizePrice(firstNumber(level, ["price", "rate", "odds", "p", "limitPrice"]));
}

function normalizePrice(value: unknown): number | undefined {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined;
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) {
    return undefined;
  }
  const decimal = raw > 1 && raw <= 100 ? raw / 100 : raw;
  if (decimal > 1) {
    return undefined;
  }
  return roundProbability(decimal);
}

function roundProbability(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function averageSpread(sides: readonly MarketSidePricing[]): number | undefined {
  const spreads = sides
    .map((side) =>
      side.bestBid !== undefined && side.bestAsk !== undefined ? roundProbability(side.bestAsk - side.bestBid) : undefined
    )
    .filter((value): value is number => value !== undefined && value >= 0);
  if (spreads.length === 0) {
    return undefined;
  }
  return roundProbability(spreads.reduce((sum, value) => sum + value, 0) / spreads.length);
}

function firstRecord(item: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const key of keys) {
    const value = item[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}

function directionKeys(direction: MarketDirection): string[] {
  return direction === "UP" ? ["up", "UP", "Up"] : ["down", "DOWN", "Down"];
}

function findOrderbookPayload(payload: unknown, marketId: string): unknown {
  if (Array.isArray(payload)) {
    return payload.find((item) => recordMatchesMarketId(item, marketId)) ?? payload[0];
  }
  if (!isRecord(payload)) {
    return payload;
  }
  if (recordMatchesMarketId(payload, marketId)) {
    return payload;
  }
  for (const key of ["orderbook", "orderBook", "book", "data", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.find((item) => recordMatchesMarketId(item, marketId)) ?? value[0];
    }
    if (isRecord(value)) {
      return findOrderbookPayload(value, marketId);
    }
  }
  return payload;
}

function recordMatchesMarketId(value: unknown, marketId: string): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return firstString(value, ["marketId", "market_id", "id"]) === marketId;
}

function normalizeMarketSettlement(marketId: string, payload: unknown, capturedAt: Date): MarketSettlement {
  const source = findMarketPayload(payload, marketId);
  if (!isRecord(source)) {
    return unknownSettlement(marketId, capturedAt);
  }

  const status = normalizeSettlementStatus(firstString(source, ["status", "state", "marketStatus"]));
  if (status !== "resolved") {
    return {
      marketId,
      capturedAt,
      source: "predict.fun",
      status,
      winningDirection: null
    };
  }

  return {
    marketId,
    capturedAt,
    source: "predict.fun",
    status,
    winningDirection: normalizeWinningDirection(source)
  };
}

function unknownSettlement(marketId: string, capturedAt: Date): MarketSettlement {
  return {
    marketId,
    capturedAt,
    source: "predict.fun",
    status: "unknown",
    winningDirection: null
  };
}

function normalizeSettlementStatus(value: string | undefined): MarketSettlement["status"] {
  const normalized = value?.toUpperCase();
  if (normalized === "RESOLVED" || normalized === "SETTLED") {
    return "resolved";
  }
  if (
    normalized === "OPEN" ||
    normalized === "OPENED" ||
    normalized === "ACTIVE" ||
    normalized === "TRADING" ||
    normalized === "CLOSED" ||
    normalized === "RESOLVING" ||
    normalized === "REGISTERED"
  ) {
    return "unresolved";
  }
  return "unknown";
}

function normalizeWinningDirection(payload: UnknownRecord): MarketSettlement["winningDirection"] {
  const outcomes = Array.isArray(payload["outcomes"]) ? payload["outcomes"].filter(isRecord) : [];
  const winners = outcomes
    .filter((outcome) => firstString(outcome, ["status", "state"])?.toUpperCase() === "WON")
    .map((outcome) => normalizeOutcomeDirection(firstString(outcome, ["name", "label", "outcome", "direction"])))
    .filter((direction): direction is MarketDirection => direction !== undefined);

  if (winners.length === 1) {
    return winners[0];
  }
  if (winners.length > 1) {
    return "TIE";
  }

  return null;
}

function normalizeOutcomeDirection(value: string | undefined): MarketDirection | undefined {
  const normalized = value?.toUpperCase();
  if (normalized === "UP") {
    return "UP";
  }
  if (normalized === "DOWN") {
    return "DOWN";
  }
  return undefined;
}

function findMarketPayload(payload: unknown, marketId: string): unknown {
  if (Array.isArray(payload)) {
    return payload.find((item) => recordMatchesMarketId(item, marketId)) ?? payload[0];
  }
  if (!isRecord(payload)) {
    return payload;
  }
  if (recordMatchesMarketId(payload, marketId)) {
    return payload;
  }
  for (const key of ["data", "market", "result"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.find((item) => recordMatchesMarketId(item, marketId)) ?? value[0];
    }
    if (isRecord(value)) {
      return findMarketPayload(value, marketId);
    }
  }
  return payload;
}
