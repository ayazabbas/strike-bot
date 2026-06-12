import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";

const execFileAsync = promisify(execFile);

export interface TrustWalletReadiness {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly reasons: readonly string[];
}

export interface TrustWalletAgentKitAdapter {
  checkReadiness(): Promise<TrustWalletReadiness>;
}

export class EnvTrustWalletAgentKitAdapter implements TrustWalletAgentKitAdapter {
  constructor(
    private readonly config: AppConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly credentialsPath = join(homedir(), ".twak", "credentials.json"),
    private readonly checkCli: () => Promise<boolean> = hasTwakCli
  ) {}

  async checkReadiness(): Promise<TrustWalletReadiness> {
    const reasons: string[] = [];

    if (!this.config.trustWalletAgentKitEnabled) {
      reasons.push("twak_disabled");
    }

    const hasEnvCredentials = Boolean(this.env.TWAK_ACCESS_ID && this.env.TWAK_HMAC_SECRET);
    const hasDefaultCredentials = await fileExists(this.credentialsPath);
    const hasConfiguredCredentials = this.config.trustWalletAgentKitConfigPath
      ? await fileExists(this.config.trustWalletAgentKitConfigPath)
      : false;

    if (!hasEnvCredentials && !hasDefaultCredentials && !hasConfiguredCredentials) {
      reasons.push("twak_credentials_missing");
    }
    if (!this.config.bscRpcUrl) {
      reasons.push("bsc_rpc_url_missing");
    }
    if (!(await this.checkCli())) {
      reasons.push("twak_cli_missing");
    }

    return {
      enabled: this.config.trustWalletAgentKitEnabled,
      ready: reasons.length === 0,
      reasons
    };
  }
}

export class StubTrustWalletAgentKitAdapter extends EnvTrustWalletAgentKitAdapter {}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hasTwakCli(): Promise<boolean> {
  for (const command of ["twak", "trustwallet"]) {
    try {
      await execFileAsync(command, ["--version"], { timeout: 2_000 });
      return true;
    } catch {
      // Keep readiness informational; absence must never escalate to signing fallback.
    }
  }
  return false;
}
