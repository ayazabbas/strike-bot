import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "../config.js";

const execFileAsync = promisify(execFile);

export interface TrustWalletReadiness {
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly credentialsCliRpcReady: boolean;
  readonly agentWalletConfigured: boolean;
  readonly agentWalletPasswordAvailable: boolean;
  readonly address: string | null;
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
    agentWalletPathOrCheckCli: string | (() => Promise<boolean>) = join(homedir(), ".twak", "wallet.json"),
    checkCli: () => Promise<boolean> = hasTwakCli,
    private readonly defaultWalletPasswordPath = join(homedir(), ".twak", "wallet-password")
  ) {
    if (typeof agentWalletPathOrCheckCli === "function") {
      this.agentWalletPath = join(homedir(), ".twak", "wallet.json");
      this.checkCli = agentWalletPathOrCheckCli;
    } else {
      this.agentWalletPath = agentWalletPathOrCheckCli;
      this.checkCli = checkCli;
    }
  }

  private readonly agentWalletPath: string;
  private readonly checkCli: () => Promise<boolean>;

  async checkReadiness(): Promise<TrustWalletReadiness> {
    const reasons: string[] = [];

    if (!this.config.trustWalletAgentKitEnabled) {
      reasons.push("twak_disabled");
    }

    const cliReady = await this.checkCli();
    const hasEnvCredentials = Boolean(this.env.TWAK_ACCESS_ID && this.env.TWAK_HMAC_SECRET);
    const hasDefaultCredentials = await fileExists(this.credentialsPath);
    const hasConfiguredCredentials = this.config.trustWalletAgentKitConfigPath
      ? await fileExists(this.config.trustWalletAgentKitConfigPath)
      : false;
    const credentialsReady = hasEnvCredentials || hasDefaultCredentials || hasConfiguredCredentials;
    const rpcReady = Boolean(this.config.bscRpcUrl);
    const walletPassword = await this.readWalletPassword();
    const fundingWallet = await this.readFundingWallet(cliReady, walletPassword);
    const agentWalletPasswordAvailable = Boolean(walletPassword);

    if (!credentialsReady) {
      reasons.push("twak_credentials_missing");
    }
    if (!rpcReady) {
      reasons.push("bsc_rpc_url_missing");
    }
    if (!cliReady) {
      reasons.push("twak_cli_missing");
    }
    if (!fundingWallet.configured) {
      reasons.push("twak_agent_wallet_missing");
    }
    if (!agentWalletPasswordAvailable) {
      reasons.push("twak_agent_wallet_password_missing");
    }

    const credentialsCliRpcReady = credentialsReady && rpcReady && cliReady && this.config.trustWalletAgentKitEnabled;
    const ready = credentialsCliRpcReady && fundingWallet.configured && agentWalletPasswordAvailable;

    return {
      enabled: this.config.trustWalletAgentKitEnabled,
      ready,
      credentialsCliRpcReady,
      agentWalletConfigured: fundingWallet.configured,
      agentWalletPasswordAvailable,
      address: fundingWallet.address,
      reasons
    };
  }

  private async readFundingWallet(cliReady: boolean, walletPassword: string | null): Promise<{ configured: boolean; address: string | null }> {
    const envAddress = normalizeAddress(this.env.TWAK_AGENT_WALLET_ADDRESS);
    if (envAddress) {
      return { configured: true, address: envAddress };
    }

    try {
      const raw = await readFile(this.agentWalletPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const fileAddress = normalizeAddress(
        firstString(parsed, ["address", "walletAddress", "fundingWalletAddress", "agentWalletAddress"])
      );
      return { configured: true, address: fileAddress ?? (await this.readFundingWalletAddressFromTwakCli(cliReady, walletPassword)) };
    } catch {
      return { configured: false, address: null };
    }
  }

  private async readWalletPassword(): Promise<string | null> {
    if (this.env.TWAK_WALLET_PASSWORD && this.env.TWAK_WALLET_PASSWORD.length > 0) {
      return this.env.TWAK_WALLET_PASSWORD;
    }
    for (const path of [this.env.TWAK_WALLET_PASSWORD_FILE, this.defaultWalletPasswordPath]) {
      if (!path) {
        continue;
      }
      try {
        const value = (await readFile(path, "utf8")).trim();
        if (value.length > 0) {
          return value;
        }
      } catch {
        // Keep readiness informational; never surface password-file contents or paths as errors.
      }
    }
    return null;
  }

  private async readFundingWalletAddressFromTwakCli(cliReady: boolean, walletPassword: string | null): Promise<string | null> {
    if (!cliReady || !walletPassword) {
      return null;
    }
    for (const command of ["twak", "trustwallet"]) {
      try {
        const { stdout } = await execFileAsync(command, ["wallet", "address", "--chain", "bsc", "--json"], {
          timeout: 5_000,
          env: { ...process.env, TWAK_WALLET_PASSWORD: walletPassword }
        });
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        return normalizeAddress(firstString(parsed, ["address", "walletAddress"]));
      } catch {
        // Try the next supported CLI command name.
      }
    }
    return null;
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

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function normalizeAddress(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? trimmed : null;
}
