import { describe, expect, it } from "vitest";
import { makeStubPredictFunMarket } from "../src/adapters/PredictFunAdapter.js";
import {
  filterBtcFiveMinuteMarkets,
  isBtcFiveMinuteUpDownMarket,
  selectNearestTradableBtcFiveMinuteMarket
} from "../src/domain/marketFilter.js";

describe("market filter", () => {
  it("accepts only open BTC 5-minute predict.fun UP/DOWN markets", () => {
    const eligible = makeStubPredictFunMarket();
    const wrongAsset = makeStubPredictFunMarket({ id: "eth", asset: "ETH" });
    const wrongInterval = makeStubPredictFunMarket({ id: "btc-15", intervalMinutes: 15 });
    const closed = makeStubPredictFunMarket({ id: "closed", status: "closed" });

    expect(isBtcFiveMinuteUpDownMarket(eligible)).toBe(true);
    expect(filterBtcFiveMinuteMarkets([eligible, wrongAsset, wrongInterval, closed])).toEqual([eligible]);
  });

  it("selects the nearest tradable market with enough time before close", () => {
    const now = new Date("2026-06-13T12:02:00.000Z");
    const currentTooClose = makeStubPredictFunMarket({
      id: "too-close",
      startsAt: new Date("2026-06-13T12:00:00.000Z"),
      closesAt: new Date("2026-06-13T12:02:30.000Z")
    });
    const nearestTradable = makeStubPredictFunMarket({
      id: "nearest",
      categorySlug: "btc-updown-5m-1781372100",
      startsAt: new Date("2026-06-13T12:00:00.000Z"),
      closesAt: new Date("2026-06-13T12:05:00.000Z")
    });
    const laterTradable = makeStubPredictFunMarket({
      id: "later",
      startsAt: new Date("2026-06-13T12:05:00.000Z"),
      closesAt: new Date("2026-06-13T12:10:00.000Z")
    });
    const closed = makeStubPredictFunMarket({
      id: "closed",
      status: "closed",
      startsAt: new Date("2026-06-13T12:00:00.000Z"),
      closesAt: new Date("2026-06-13T12:05:00.000Z")
    });

    const selected = selectNearestTradableBtcFiveMinuteMarket(
      [currentTooClose, laterTradable, nearestTradable, closed],
      { now, minSecondsBeforeClose: 60 }
    );

    expect(selected).toMatchObject({
      id: "nearest",
      categorySlug: "btc-updown-5m-1781372100",
      timeRemainingSeconds: 180
    });
  });

  it("can select an upcoming market when predict.fun marks it open and tradable", () => {
    const now = new Date("2026-06-13T12:02:00.000Z");
    const upcoming = makeStubPredictFunMarket({
      id: "upcoming",
      startsAt: new Date("2026-06-13T12:05:00.000Z"),
      closesAt: new Date("2026-06-13T12:10:00.000Z"),
      resolvesAt: new Date("2026-06-13T12:11:00.000Z")
    });

    const selected = selectNearestTradableBtcFiveMinuteMarket([upcoming], { now, minSecondsBeforeClose: 60 });

    expect(selected).toMatchObject({
      id: "upcoming",
      timeRemainingSeconds: 480
    });
  });
});
