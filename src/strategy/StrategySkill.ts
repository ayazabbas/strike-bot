import type {
  BtcCandleMetadata,
  BtcFiveMinuteMarket,
  MacroSnapshot,
  StrategyDecision
} from "../domain/types.js";
import type { RunMode } from "../config.js";

export interface StrategyContext {
  readonly runMode: RunMode;
  readonly macro: MacroSnapshot;
  readonly candle: BtcCandleMetadata;
  readonly markets: readonly BtcFiveMinuteMarket[];
}

export interface StrategySkill {
  readonly name: string;
  decide(context: StrategyContext): Promise<StrategyDecision>;
}
