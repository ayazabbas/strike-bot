import type { MacroSnapshot } from "../domain/types.js";

export interface CmcAdapter {
  getMacroSnapshot(): Promise<MacroSnapshot>;
}

export class StubCmcAdapter implements CmcAdapter {
  async getMacroSnapshot(): Promise<MacroSnapshot> {
    return {
      capturedAt: new Date(),
      source: "coinmarketcap",
      stubbed: true
    };
  }
}
