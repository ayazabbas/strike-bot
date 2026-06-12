import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { RunMode } from "../config.js";
import type { ExecutionResult, MarketSnapshot, StrategyDecision } from "../domain/types.js";

export interface RunRecord {
  readonly id: string;
  readonly mode: RunMode;
  readonly startedAt: Date;
}

export interface RunRepository {
  init(): Promise<void>;
  createRun(mode: RunMode): Promise<RunRecord>;
  recordMarketSnapshot(runId: string, snapshot: MarketSnapshot): Promise<void>;
  recordDecision(runId: string, decision: StrategyDecision): Promise<void>;
  recordExecution(runId: string, result: ExecutionResult): Promise<void>;
}

export class NoopSqliteRunRepository implements RunRepository {
  constructor(private readonly databasePath: string) {}

  async init(): Promise<void> {
    if (this.databasePath !== ":memory:") {
      await mkdir(dirname(this.databasePath), { recursive: true });
    }
  }

  async createRun(mode: RunMode): Promise<RunRecord> {
    return {
      id: randomUUID(),
      mode,
      startedAt: new Date()
    };
  }

  async recordMarketSnapshot(): Promise<void> {
    return;
  }

  async recordDecision(): Promise<void> {
    return;
  }

  async recordExecution(): Promise<void> {
    return;
  }
}
