import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAttemptedMarketIds, tryClaimMarketAttempt } from "../src/storage/MarketAttemptStore.js";

describe("MarketAttemptStore", () => {
  it("atomically allows only one claim for a market", () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-attempts-"));
    const statePath = join(dir, "attempted-markets.json");

    try {
      expect(tryClaimMarketAttempt(statePath, "512209")).toBe(true);
      expect(tryClaimMarketAttempt(statePath, "512209")).toBe(false);
      expect(loadAttemptedMarketIds(statePath)).toEqual(new Set(["512209"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves existing attempts when claiming a new market", () => {
    const dir = mkdtempSync(join(tmpdir(), "strike-bot-attempts-"));
    const statePath = join(dir, "attempted-markets.json");

    try {
      expect(tryClaimMarketAttempt(statePath, "512209")).toBe(true);
      expect(tryClaimMarketAttempt(statePath, "512210")).toBe(true);
      expect(loadAttemptedMarketIds(statePath)).toEqual(new Set(["512209", "512210"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
