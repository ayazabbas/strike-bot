import type { BtcCandleMetadata, MacroSnapshot, MarketPricing, SelectedBtcFiveMinuteMarket } from "../domain/types.js";

export type ModelFeatureState = Readonly<Record<string, string | number | boolean | null>>;

type Candle = NonNullable<BtcCandleMetadata["latestCandle"]>;

export interface BuildRollingFeatureStateInput {
  readonly capturedAt: Date;
  readonly selectedMarket: SelectedBtcFiveMinuteMarket;
  readonly pricing: MarketPricing;
  readonly macro: MacroSnapshot;
  readonly candle: BtcCandleMetadata;
}

export function buildRollingFeatureState(input: BuildRollingFeatureStateInput): ModelFeatureState {
  const startsAt = input.selectedMarket.startsAt;
  const closesAt = input.selectedMarket.closesAt;
  const elapsedSeconds = Math.max(0, (input.capturedAt.getTime() - startsAt.getTime()) / 1000);
  const secondsToClose = Math.max(0, (closesAt.getTime() - input.capturedAt.getTime()) / 1000);
  const candles = sortedCandles(input.candle).filter((candle) => candle.openTime.getTime() <= input.capturedAt.getTime());
  const latest = candles.at(-1);
  const inWindow = candles.filter(
    (candle) => candle.openTime.getTime() >= startsAt.getTime() && candle.openTime.getTime() < input.capturedAt.getTime()
  );

  const state: Record<string, string | number | boolean | null> = {
    evaluation_time: input.capturedAt.toISOString(),
    window_start: startsAt.toISOString(),
    window_end: closesAt.toISOString(),
    window_slug: input.selectedMarket.categorySlug ?? `btc-updown-5m-${Math.floor(startsAt.getTime() / 1000)}`,
    seconds_to_close: round(secondsToClose),
    elapsed_minutes: round(elapsedSeconds / 60),
    elapsed_seconds: round(elapsedSeconds),
    signal_timing: signalTiming(input.capturedAt),
    signalTiming: signalTiming(input.capturedAt),
    up_bid: finite(input.pricing.up.bestBid) ? input.pricing.up.bestBid : null,
    up_ask: finite(input.pricing.up.bestAsk) ? input.pricing.up.bestAsk : null,
    down_bid: finite(input.pricing.down.bestBid) ? input.pricing.down.bestBid : null,
    down_ask: finite(input.pricing.down.bestAsk) ? input.pricing.down.bestAsk : null,
    btc_usd: finite(input.macro.btcUsd) ? input.macro.btcUsd : null,
    btc_24h_change_pct: finite(input.macro.btc24hChangePct) ? input.macro.btc24hChangePct : null,
    btc_7d_change_pct: finite(input.macro.btc7dChangePct) ? input.macro.btc7dChangePct : null,
    btc_volume_change_24h_pct: finite(input.macro.btcVolumeChange24hPct) ? input.macro.btcVolumeChange24hPct : null,
    label_direction: "up",
    label_magnitude_bps: 0,
    window_return: 0
  };

  if (!latest || latest.open <= 0) {
    return state;
  }

  const known = inWindow.length > 0 ? inWindow : [latest];
  const knownOpen = known[0].open;
  const knownHigh = Math.max(...known.map((candle) => candle.high));
  const knownLow = Math.min(...known.map((candle) => candle.low));
  const knownClose = known.at(-1)?.close ?? latest.close;
  const knownRange = knownHigh - knownLow;
  const partialReturn = knownOpen > 0 ? (knownClose - knownOpen) / knownOpen : null;
  const indicators = technicalIndicators(candles);

  return {
    ...state,
    known_open: round(knownOpen),
    known_high: round(knownHigh),
    known_low: round(knownLow),
    known_close: round(knownClose),
    partial_return: partialReturn === null ? null : round(partialReturn),
    partial_return_bps: partialReturn === null ? null : round(partialReturn * 10_000),
    partial_range_bps: knownOpen > 0 ? round((knownRange / knownOpen) * 10_000) : null,
    close_location: knownRange > 0 ? round((knownClose - knownLow) / knownRange) : null,
    ...indicators
  };
}

function sortedCandles(candle: BtcCandleMetadata): Candle[] {
  const candidates = candle.recentCandles && candle.recentCandles.length > 0 ? [...candle.recentCandles] : candle.latestCandle ? [candle.latestCandle] : [];
  return candidates
    .filter((item) => item.open > 0 && [item.high, item.low, item.close].every(Number.isFinite))
    .sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
}

function technicalIndicators(candles: readonly Candle[]): ModelFeatureState {
  const closes = candles.map((candle) => candle.close);
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  if (!latest) {
    return {};
  }

  const return1m = previous && previous.close > 0 ? (latest.close - previous.close) / previous.close : null;
  const body = latest.open > 0 ? (latest.close - latest.open) / latest.open : null;
  const range = latest.open > 0 ? (latest.high - latest.low) / latest.open : null;
  const rollingReturn5m = closes.length > 5 && closes.at(-6)! > 0 ? (latest.close - closes.at(-6)!) / closes.at(-6)! : null;
  const returnSeries = pctChanges(closes);
  const realizedVol15m = std(returnSeries.slice(-15).filter(finite));

  const state: Record<string, string | number | boolean | null> = {
    return_1m_bps: return1m === null ? null : round(return1m * 10_000),
    body_bps: body === null ? null : round(body * 10_000),
    range_bps: range === null ? null : round(range * 10_000),
    rolling_return_5m_bps: rollingReturn5m === null ? null : round(rollingReturn5m * 10_000),
    realized_vol_15m_bps: realizedVol15m === null ? null : round(realizedVol15m * 10_000),
    atr_14_bps: atrBps(candles, 14),
    ...bollingerState(closes, latest.close),
    rsi_7: rsi(closes, 7),
    rsi_14: rsi(closes, 14),
    rsi_21: rsi(closes, 21)
  };

  for (const period of [9, 21, 50, 200]) {
    const series = emaSeries(closes, period);
    const ema = series.at(-1);
    const prevEma = series.at(-2);
    state[`ema_${period}`] = valueOrNull(ema);
    state[`ema_${period}_distance_bps`] = ema && ema !== 0 ? round(((latest.close - ema) / ema) * 10_000) : null;
    state[`ema_${period}_slope_bps`] = ema && prevEma && prevEma !== 0 ? round(((ema - prevEma) / prevEma) * 10_000) : null;
  }

  return state;
}

function bollingerState(closes: readonly number[], latestClose: number): ModelFeatureState {
  const window = closes.slice(-20);
  if (window.length < 20) {
    return {
      bollinger_width_20_bps: null,
      bollinger_percent_b_20: null,
      bollinger_upper_distance_20_bps: null,
      bollinger_lower_distance_20_bps: null,
      bollinger_middle_distance_20_bps: null,
      bollinger_width_20_zscore_100: null,
      bollinger_width_20_percentile_100: null
    };
  }
  const middle = mean(window);
  const deviation = std(window) ?? 0;
  const upper = middle + 2 * deviation;
  const lower = middle - 2 * deviation;
  const width = upper - lower;
  const widths = rollingBollingerWidths(closes);
  const latestWidth = middle !== 0 ? (width / middle) * 10_000 : null;
  const widthMean = widths.length >= 20 ? mean(widths.slice(-100)) : null;
  const widthStd = widths.length >= 20 ? std(widths.slice(-100)) : null;
  return {
    bollinger_width_20_bps: latestWidth === null ? null : round(latestWidth),
    bollinger_percent_b_20: width !== 0 ? round((latestClose - lower) / width) : null,
    bollinger_upper_distance_20_bps: latestClose !== 0 ? round(((upper - latestClose) / latestClose) * 10_000) : null,
    bollinger_lower_distance_20_bps: latestClose !== 0 ? round(((latestClose - lower) / latestClose) * 10_000) : null,
    bollinger_middle_distance_20_bps: middle !== 0 ? round(((latestClose - middle) / middle) * 10_000) : null,
    bollinger_width_20_zscore_100: latestWidth !== null && widthMean !== null && widthStd ? round((latestWidth - widthMean) / widthStd) : null,
    bollinger_width_20_percentile_100: latestWidth !== null && widths.length > 0 ? round(percentileRank(widths.slice(-100), latestWidth)) : null
  };
}

function rollingBollingerWidths(closes: readonly number[]): number[] {
  const widths: number[] = [];
  for (let index = 19; index < closes.length; index += 1) {
    const window = closes.slice(index - 19, index + 1);
    const middle = mean(window);
    if (middle === 0) {
      continue;
    }
    widths.push(((4 * (std(window) ?? 0)) / middle) * 10_000);
  }
  return widths;
}

function atrBps(candles: readonly Candle[], period: number): number | null {
  if (candles.length < period + 1) {
    return null;
  }
  const ranges: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  const recent = ranges.slice(-period);
  const latestClose = candles.at(-1)?.close;
  return latestClose && latestClose > 0 ? round((mean(recent) / latestClose) * 10_000) : null;
}

function rsi(closes: readonly number[], period: number): number | null {
  if (closes.length <= period) {
    return null;
  }
  const changes = pctDiffs(closes).slice(-period);
  const gains = changes.map((value) => Math.max(0, value));
  const losses = changes.map((value) => Math.max(0, -value));
  const avgGain = mean(gains);
  const avgLoss = mean(losses);
  if (avgLoss === 0) {
    return avgGain === 0 ? 0 : 100;
  }
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs));
}

function emaSeries(values: readonly number[], period: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const alpha = 2 / (period + 1);
  const out = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    out.push(alpha * values[index] + (1 - alpha) * out[index - 1]);
  }
  return out;
}

function pctChanges(values: readonly number[]): Array<number | null> {
  return pctDiffs(values).map((value) => (Number.isFinite(value) ? value : null));
}

function pctDiffs(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    out.push(previous !== 0 ? (values[index] - previous) / previous : Number.NaN);
  }
  return out;
}

function signalTiming(capturedAt: Date): string {
  return capturedAt.getUTCSeconds() === 0 && capturedAt.getUTCMilliseconds() === 0
    ? "exact_completed_minute"
    : "intra_minute_extrapolated";
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function percentileRank(values: readonly number[], latest: number): number {
  return values.filter((value) => value <= latest).length / values.length;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function valueOrNull(value: number | undefined): number | null {
  return finite(value) ? round(value) : null;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
