import type { RunMode } from "../config.js";
import type { BtcCandleMetadata, MacroSnapshot, MarketPricing, SelectedBtcFiveMinuteMarket } from "../domain/types.js";
import { buildRollingFeatureState } from "./buildRollingFeatureState.js";
import type { ModelInferenceRequest } from "./types.js";

export interface BuildModelInferenceRequestInput {
  readonly requestId: string;
  readonly capturedAt: Date;
  readonly runMode: RunMode;
  readonly selectedMarket?: SelectedBtcFiveMinuteMarket;
  readonly pricing?: MarketPricing;
  readonly macro: MacroSnapshot;
  readonly candle: BtcCandleMetadata;
}

export function buildModelInferenceRequest(input: BuildModelInferenceRequestInput): ModelInferenceRequest | undefined {
  const { selectedMarket, pricing } = input;
  if (!selectedMarket || !pricing || pricing.status !== "available") {
    return undefined;
  }
  const upAsk = pricing.up.bestAsk;
  const downAsk = pricing.down.bestAsk;
  if (!finite(upAsk) || !finite(downAsk)) {
    return undefined;
  }

  const latestCandle = input.candle.latestCandle;
  const elapsedSeconds = Math.max(0, round((input.capturedAt.getTime() - selectedMarket.startsAt.getTime()) / 1000));

  return {
    requestId: input.requestId,
    capturedAt: input.capturedAt.toISOString(),
    runMode: input.runMode,
    market: {
      id: selectedMarket.id,
      categorySlug: selectedMarket.categorySlug,
      startsAt: selectedMarket.startsAt.toISOString(),
      closesAt: selectedMarket.closesAt.toISOString(),
      timeRemainingSeconds: selectedMarket.timeRemainingSeconds,
      status: selectedMarket.market.status
    },
    pricing: {
      marketId: pricing.marketId,
      capturedAt: pricing.capturedAt.toISOString(),
      status: "available",
      up: {
        bestBid: finite(pricing.up.bestBid) ? pricing.up.bestBid : undefined,
        bestAsk: upAsk
      },
      down: {
        bestBid: finite(pricing.down.bestBid) ? pricing.down.bestBid : undefined,
        bestAsk: downAsk
      },
      spread: finite(pricing.spread) ? pricing.spread : undefined
    },
    features: {
      elapsedSeconds,
      featureState: buildRollingFeatureState({
        capturedAt: input.capturedAt,
        selectedMarket,
        pricing,
        macro: input.macro,
        candle: input.candle
      }),
      btcUsd: finite(input.macro.btcUsd) ? input.macro.btcUsd : undefined,
      btc24hChangePct: finite(input.macro.btc24hChangePct) ? input.macro.btc24hChangePct : undefined,
      btc7dChangePct: finite(input.macro.btc7dChangePct) ? input.macro.btc7dChangePct : undefined,
      btcVolumeChange24hPct: finite(input.macro.btcVolumeChange24hPct) ? input.macro.btcVolumeChange24hPct : undefined,
      latestCandle: latestCandle
        ? {
            openTime: latestCandle.openTime.toISOString(),
            open: latestCandle.open,
            high: latestCandle.high,
            low: latestCandle.low,
            close: latestCandle.close,
            volume: latestCandle.volume
          }
        : undefined
    },
    candidates: [
      { direction: "UP", entryAsk: upAsk, entryBid: pricing.up.bestBid },
      { direction: "DOWN", entryAsk: downAsk, entryBid: pricing.down.bestBid }
    ]
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
