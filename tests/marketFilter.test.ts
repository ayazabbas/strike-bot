import { describe, expect, it } from "vitest";
import { makeStubPredictFunMarket } from "../src/adapters/PredictFunAdapter.js";
import { filterBtcFiveMinuteMarkets, isBtcFiveMinuteUpDownMarket } from "../src/domain/marketFilter.js";

describe("market filter", () => {
  it("accepts only open BTC 5-minute predict.fun UP/DOWN markets", () => {
    const eligible = makeStubPredictFunMarket();
    const wrongAsset = makeStubPredictFunMarket({ id: "eth", asset: "ETH" });
    const wrongInterval = makeStubPredictFunMarket({ id: "btc-15", intervalMinutes: 15 });
    const closed = makeStubPredictFunMarket({ id: "closed", status: "closed" });

    expect(isBtcFiveMinuteUpDownMarket(eligible)).toBe(true);
    expect(filterBtcFiveMinuteMarkets([eligible, wrongAsset, wrongInterval, closed])).toEqual([eligible]);
  });
});
