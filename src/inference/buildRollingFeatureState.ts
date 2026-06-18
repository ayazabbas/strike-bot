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
  const rollingReturn5m = returnOverCandles(closes, 5);
  const returnSeries = pctChanges(closes);
  const realizedVol15m = std(returnSeries.slice(-15).filter(finite));
  const rsi14Series = rollingRsiSeries(closes, 14);
  const rsi14 = rsi14Series.at(-1) ?? null;
  const macd = macdState(closes);
  const ema9 = emaSeries(closes, 9).at(-1);
  const ema21 = emaSeries(closes, 21).at(-1);
  const ema50 = emaSeries(closes, 50).at(-1);
  const ema21Series = emaSeries(closes, 21);
  const ema21Slope = slopeBps(ema21Series, 1);

  const state: Record<string, string | number | boolean | null> = {
    return_1m_bps: return1m === null ? null : round(return1m * 10_000),
    body_bps: body === null ? null : round(body * 10_000),
    range_bps: range === null ? null : round(range * 10_000),
    rolling_return_5m_bps: rollingReturn5m === null ? null : round(rollingReturn5m * 10_000),
    ...multiWindowReturnState(closes),
    ...multiTimeframeState(candles),
    realized_vol_5m_bps: realizedVolBps(returnSeries, 5),
    realized_vol_15m_bps: realizedVol15m === null ? null : round(realizedVol15m * 10_000),
    realized_vol_30m_bps: realizedVolBps(returnSeries, 30),
    atr_14_bps: atrBps(candles, 14),
    ...bollingerState(closes, latest.close),
    rsi_7: rsi(closes, 7),
    rsi_14: rsi14,
    rsi_21: rsi(closes, 21),
    rsi_14_slope_3m: slope(rsi14Series, 3),
    rsi_14_slope_5m: slope(rsi14Series, 5),
    return_1m_minus_return_5m_avg_bps: return1m !== null && rollingReturn5m !== null ? round((return1m - rollingReturn5m / 5) * 10_000) : null,
    momentum_acceleration_3m_bps: momentumAccelerationBps(closes, 3),
    momentum_acceleration_5m_bps: momentumAccelerationBps(closes, 5),
    consecutive_up_1m_candles: consecutiveCandles(candles, "up"),
    consecutive_down_1m_candles: consecutiveCandles(candles, "down"),
    ema_9_below_21: finite(ema9) && finite(ema21) ? ema9 < ema21 : null,
    ema_21_below_50: finite(ema21) && finite(ema50) ? ema21 < ema50 : null,
    ema_stack_bullish: finite(ema9) && finite(ema21) && finite(ema50) ? ema9 > ema21 && ema21 > ema50 : false,
    ema_stack_bearish: finite(ema9) && finite(ema21) && finite(ema50) ? ema9 < ema21 && ema21 < ema50 : false,
    downtrend_strength_score: trendStrengthScore(latest.close, ema9, ema21, ema50, ema21Slope, "down"),
    uptrend_strength_score: trendStrengthScore(latest.close, ema9, ema21, ema50, ema21Slope, "up"),
    ...macd
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

function multiWindowReturnState(closes: readonly number[]): ModelFeatureState {
  const state: Record<string, number | null> = {};
  for (const minutes of [3, 5, 10, 15, 30, 60]) {
    const value = returnOverCandles(closes, minutes);
    state[`return_${minutes}m_bps`] = value === null ? null : round(value * 10_000);
  }
  return state;
}

function multiTimeframeState(candles: readonly Candle[]): ModelFeatureState {
  return {
    ...prefixedTimeframeState("tf5m", aggregateCandles(candles, 5)),
    ...prefixedTimeframeState("tf15m", aggregateCandles(candles, 15))
  };
}

function prefixedTimeframeState(prefix: string, candles: readonly Candle[]): ModelFeatureState {
  const closes = candles.map((candle) => candle.close);
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const returnValue = previous && previous.close > 0 && latest ? (latest.close - previous.close) / previous.close : null;
  const ema9Series = emaSeries(closes, 9);
  const ema21Series = emaSeries(closes, 21);
  const ema50Series = emaSeries(closes, 50);
  const ema9 = ema9Series.at(-1);
  const ema21 = ema21Series.at(-1);
  const ema50 = ema50Series.at(-1);
  return {
    [`${prefix}_return_bps`]: returnValue === null ? null : round(returnValue * 10_000),
    [`${prefix}_rsi_7`]: rsi(closes, 7),
    [`${prefix}_rsi_14`]: rsi(closes, 14),
    [`${prefix}_rsi_21`]: rsi(closes, 21),
    [`${prefix}_ema_9_distance_bps`]: latest && finite(ema9) && ema9 !== 0 ? round(((latest.close - ema9) / ema9) * 10_000) : null,
    [`${prefix}_ema_21_distance_bps`]: latest && finite(ema21) && ema21 !== 0 ? round(((latest.close - ema21) / ema21) * 10_000) : null,
    [`${prefix}_ema_50_distance_bps`]: latest && finite(ema50) && ema50 !== 0 ? round(((latest.close - ema50) / ema50) * 10_000) : null,
    [`${prefix}_ema_9_slope_bps`]: slopeBps(ema9Series, 1),
    [`${prefix}_ema_21_slope_bps`]: slopeBps(ema21Series, 1),
    [`${prefix}_ema_50_slope_bps`]: slopeBps(ema50Series, 1),
    [`${prefix}_ema_stack_bullish`]: finite(ema9) && finite(ema21) && finite(ema50) ? ema9 > ema21 && ema21 > ema50 : false,
    [`${prefix}_ema_stack_bearish`]: finite(ema9) && finite(ema21) && finite(ema50) ? ema9 < ema21 && ema21 < ema50 : false
  };
}

function aggregateCandles(candles: readonly Candle[], minutes: number): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.openTime.getTime() / (minutes * 60_000)) * minutes * 60_000;
    const group = groups.get(bucket) ?? [];
    group.push(candle);
    groups.set(bucket, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucket, group]) => {
      const ordered = [...group].sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
      return {
        openTime: new Date(bucket),
        open: ordered[0].open,
        high: Math.max(...ordered.map((candle) => candle.high)),
        low: Math.min(...ordered.map((candle) => candle.low)),
        close: ordered.at(-1)?.close ?? ordered[0].close,
        volume: ordered.some((candle) => finite(candle.volume))
          ? ordered.reduce((sum, candle) => sum + (finite(candle.volume) ? candle.volume : 0), 0)
          : undefined
      };
    });
}

function returnOverCandles(closes: readonly number[], periods: number): number | null {
  if (closes.length <= periods) {
    return null;
  }
  const base = closes.at(-(periods + 1));
  const latest = closes.at(-1);
  return base && latest !== undefined && base > 0 ? (latest - base) / base : null;
}

function realizedVolBps(returnSeries: readonly (number | null)[], periods: number): number | null {
  const value = std(returnSeries.slice(-periods).filter(finite));
  return value === null ? null : round(value * 10_000);
}

function rollingRsiSeries(closes: readonly number[], period: number): number[] {
  const out: number[] = [];
  for (let index = period + 1; index <= closes.length; index += 1) {
    const value = rsi(closes.slice(0, index), period);
    if (finite(value)) {
      out.push(value);
    }
  }
  return out;
}

function slope(values: readonly number[], periods: number): number | null {
  if (values.length <= periods) {
    return null;
  }
  const latest = values.at(-1);
  const previous = values.at(-(periods + 1));
  return finite(latest) && finite(previous) ? round(latest - previous) : null;
}

function slopeBps(values: readonly number[], periods: number): number | null {
  if (values.length <= periods) {
    return null;
  }
  const latest = values.at(-1);
  const previous = values.at(-(periods + 1));
  return finite(latest) && finite(previous) && previous !== 0 ? round(((latest - previous) / previous) * 10_000) : null;
}

function momentumAccelerationBps(closes: readonly number[], periods: number): number | null {
  if (closes.length <= periods * 2) {
    return null;
  }
  const latest = returnOverCandles(closes, periods);
  const previousSlice = closes.slice(0, -periods);
  const previous = returnOverCandles(previousSlice, periods);
  return latest !== null && previous !== null ? round((latest - previous) * 10_000) : null;
}

function consecutiveCandles(candles: readonly Candle[], direction: "up" | "down"): number {
  let count = 0;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (direction === "up" ? candle.close > candle.open : candle.close < candle.open) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function macdState(closes: readonly number[]): ModelFeatureState {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdLine = closes.map((_close, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    return finite(fastValue) && finite(slowValue) ? fastValue - slowValue : Number.NaN;
  });
  const signalLine = emaSeries(macdLine.filter(finite), 9);
  const latestMacd = macdLine.filter(finite).at(-1);
  const latestSignal = signalLine.at(-1);
  const previousMacd = macdLine.filter(finite).at(-2);
  const previousSignal = signalLine.at(-2);
  const histogram = finite(latestMacd) && finite(latestSignal) ? latestMacd - latestSignal : null;
  const previousHistogram = finite(previousMacd) && finite(previousSignal) ? previousMacd - previousSignal : null;
  return {
    macd: histogram === null || !finite(latestMacd) ? null : round(latestMacd),
    macd_signal: histogram === null || !finite(latestSignal) ? null : round(latestSignal),
    macd_histogram: histogram === null ? null : round(histogram),
    macd_histogram_slope: histogram !== null && previousHistogram !== null ? round(histogram - previousHistogram) : null
  };
}

function trendStrengthScore(
  close: number,
  ema9: number | undefined,
  ema21: number | undefined,
  ema50: number | undefined,
  ema21SlopeBps: number | null,
  direction: "up" | "down"
): number | null {
  if (!finite(ema9) || !finite(ema21) || !finite(ema50)) {
    return null;
  }
  const bullishStack = close > ema9 && ema9 > ema21 && ema21 > ema50;
  const bearishStack = close < ema9 && ema9 < ema21 && ema21 < ema50;
  const stackScore = direction === "up" ? (bullishStack ? 1 : 0) : bearishStack ? 1 : 0;
  const slopeScore = ema21SlopeBps === null ? 0 : direction === "up" ? Math.max(0, ema21SlopeBps) : Math.max(0, -ema21SlopeBps);
  return round(stackScore + slopeScore / 10);
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
