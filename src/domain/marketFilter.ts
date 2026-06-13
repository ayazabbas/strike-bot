import type { BtcFiveMinuteMarket, PredictFunMarket, SelectedBtcFiveMinuteMarket } from "./types.js";

export function isBtcFiveMinuteUpDownMarket(
  market: PredictFunMarket
): market is BtcFiveMinuteMarket {
  return (
    market.venue === "predict.fun" &&
    market.asset === "BTC" &&
    market.intervalMinutes === 5 &&
    market.status === "open" &&
    market.directions.length === 2 &&
    market.directions[0] === "UP" &&
    market.directions[1] === "DOWN"
  );
}

export function filterBtcFiveMinuteMarkets(
  markets: readonly PredictFunMarket[]
): BtcFiveMinuteMarket[] {
  return markets.filter(isBtcFiveMinuteUpDownMarket);
}

export function selectNearestTradableBtcFiveMinuteMarket(
  markets: readonly PredictFunMarket[],
  options: { readonly now?: Date; readonly minSecondsBeforeClose: number }
): SelectedBtcFiveMinuteMarket | undefined {
  const now = options.now ?? new Date();
  const minMillisBeforeClose = options.minSecondsBeforeClose * 1000;

  return filterBtcFiveMinuteMarkets(markets)
    .map((market) => ({
      market,
      timeRemainingMillis: market.closesAt.getTime() - now.getTime()
    }))
    .filter(({ market, timeRemainingMillis }) => {
      return timeRemainingMillis >= minMillisBeforeClose && market.resolvesAt.getTime() > now.getTime();
    })
    .sort((left, right) => {
      const leftStartDelta = Math.max(0, left.market.startsAt.getTime() - now.getTime());
      const rightStartDelta = Math.max(0, right.market.startsAt.getTime() - now.getTime());
      return leftStartDelta - rightStartDelta || left.timeRemainingMillis - right.timeRemainingMillis;
    })
    .map(({ market, timeRemainingMillis }) => ({
      id: market.id,
      categorySlug: market.categorySlug,
      startsAt: market.startsAt,
      closesAt: market.closesAt,
      timeRemainingSeconds: Math.floor(timeRemainingMillis / 1000),
      market
    }))[0];
}
