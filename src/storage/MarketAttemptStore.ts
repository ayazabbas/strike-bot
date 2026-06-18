import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface LiveRunnerState {
  readonly attemptedMarketIds?: readonly string[];
}

export function loadAttemptedMarketIds(path: string): Set<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LiveRunnerState;
    return new Set((parsed.attemptedMarketIds ?? []).map(String));
  } catch {
    return new Set();
  }
}

export function saveAttemptedMarketIds(path: string, attempted: Set<string>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ attemptedMarketIds: Array.from(attempted).sort() }, null, 2));
  renameSync(tmp, path);
}

export function tryClaimMarketAttempt(path: string, marketId: string): boolean {
  const attempted = loadAttemptedMarketIds(path);
  if (attempted.has(marketId)) {
    return false;
  }

  const lockRoot = join(dirname(path), ".attempt-locks");
  mkdirSync(lockRoot, { recursive: true });
  const lockDir = join(lockRoot, sanitizeMarketId(marketId));
  try {
    mkdirSync(lockDir, { recursive: false });
  } catch (error) {
    if (isAlreadyExists(error)) {
      return false;
    }
    throw error;
  }

  const latest = loadAttemptedMarketIds(path);
  if (latest.has(marketId)) {
    return false;
  }
  latest.add(marketId);
  saveAttemptedMarketIds(path, latest);
  return true;
}

function sanitizeMarketId(marketId: string): string {
  return marketId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}
