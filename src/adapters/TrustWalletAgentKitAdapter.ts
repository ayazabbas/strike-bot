import type { AppConfig } from "../config.js";

export interface TrustWalletReadiness {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export interface TrustWalletAgentKitAdapter {
  checkReadiness(): Promise<TrustWalletReadiness>;
}

export class StubTrustWalletAgentKitAdapter implements TrustWalletAgentKitAdapter {
  constructor(private readonly config: AppConfig) {}

  async checkReadiness(): Promise<TrustWalletReadiness> {
    const reasons: string[] = [];

    if (!this.config.trustWalletAgentKitEnabled) {
      reasons.push("twak_disabled");
    }
    if (!this.config.trustWalletAgentKitConfigPath) {
      reasons.push("twak_config_path_missing");
    }
    if (!this.config.bscRpcUrl) {
      reasons.push("bsc_rpc_url_missing");
    }

    return {
      enabled: this.config.trustWalletAgentKitEnabled,
      ready: reasons.length === 0,
      reasons
    };
  }
}
