export const ATTEMPTED_MARKET_HEARTBEAT_MS = 10_000;

export function shouldEmitAttemptedMarketHeartbeat(
  marketId: string | undefined,
  lastHeartbeat: { marketId?: string; emittedAtMs?: number },
  nowMs: number,
  intervalMs = ATTEMPTED_MARKET_HEARTBEAT_MS
): boolean {
  if (!marketId) {
    return false;
  }
  if (lastHeartbeat.marketId !== marketId) {
    return true;
  }
  if (lastHeartbeat.emittedAtMs === undefined) {
    return true;
  }
  return nowMs - lastHeartbeat.emittedAtMs >= intervalMs;
}
