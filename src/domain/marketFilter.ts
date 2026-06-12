import type { BtcFiveMinuteMarket, PredictFunMarket } from "./types.js";

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
