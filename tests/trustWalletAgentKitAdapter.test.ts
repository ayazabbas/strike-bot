import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { EnvTrustWalletAgentKitAdapter } from "../src/adapters/TrustWalletAgentKitAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("EnvTrustWalletAgentKitAdapter", () => {
  it("accepts TWAK env credentials plus BSC RPC and CLI readiness without reading secrets", async () => {
    const adapter = new EnvTrustWalletAgentKitAdapter(
      loadConfig({ BSC_RPC_URL: "https://bsc.example" }),
      {
        TWAK_ACCESS_ID: "id",
        TWAK_HMAC_SECRET: "secret",
        TWAK_AGENT_WALLET_ADDRESS: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
        TWAK_WALLET_PASSWORD: "password"
      },
      "/tmp/nonexistent-twak-credentials.json",
      async () => true
    );

    await expect(adapter.checkReadiness()).resolves.toEqual({
      enabled: true,
      ready: true,
      credentialsCliRpcReady: true,
      agentWalletConfigured: true,
      agentWalletPasswordAvailable: true,
      address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
      reasons: []
    });
  });

  it("accepts an external credentials file path without storing credentials in the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-twak-"));
    tempDirs.push(dir);
    const credentialsPath = join(dir, "credentials.json");
    const agentWalletPath = join(dir, "agent-wallet.json");
    await writeFile(credentialsPath, "{}", "utf8");
    await writeFile(agentWalletPath, JSON.stringify({ address: "0x0000000000000000000000000000000000000001" }), "utf8");
    const adapter = new EnvTrustWalletAgentKitAdapter(
      loadConfig({ BSC_RPC_URL: "https://bsc.example", TRUST_WALLET_AGENT_KIT_CONFIG_PATH: credentialsPath }),
      { TWAK_WALLET_PASSWORD: "password" },
      "/tmp/nonexistent-twak-credentials.json",
      agentWalletPath,
      async () => true
    );

    await expect(adapter.checkReadiness()).resolves.toMatchObject({
      ready: true,
      credentialsCliRpcReady: true,
      agentWalletConfigured: true,
      agentWalletPasswordAvailable: true,
      address: "0x0000000000000000000000000000000000000001",
      reasons: []
    });
  });

  it("distinguishes base TWAK readiness from missing agent wallet unlock settings", async () => {
    const adapter = new EnvTrustWalletAgentKitAdapter(
      loadConfig({ BSC_RPC_URL: "https://bsc.example" }),
      { TWAK_ACCESS_ID: "id", TWAK_HMAC_SECRET: "secret" },
      "/tmp/nonexistent-twak-credentials.json",
      "/tmp/nonexistent-twak-wallet.json",
      async () => true,
      "/tmp/nonexistent-twak-wallet-password"
    );

    await expect(adapter.checkReadiness()).resolves.toMatchObject({
      ready: false,
      credentialsCliRpcReady: true,
      agentWalletConfigured: false,
      agentWalletPasswordAvailable: false,
      address: null,
      reasons: ["twak_agent_wallet_missing", "twak_agent_wallet_password_missing"]
    });
  });

  it("reports missing TWAK readiness inputs explicitly", async () => {
    const adapter = new EnvTrustWalletAgentKitAdapter(
      loadConfig({}),
      {},
      "/tmp/nonexistent-twak-credentials.json",
      "/tmp/nonexistent-twak-wallet.json",
      async () => false,
      "/tmp/nonexistent-twak-wallet-password"
    );

    await expect(adapter.checkReadiness()).resolves.toMatchObject({
      ready: false,
      credentialsCliRpcReady: false,
      agentWalletConfigured: false,
      agentWalletPasswordAvailable: false,
      reasons: [
        "twak_credentials_missing",
        "bsc_rpc_url_missing",
        "twak_cli_missing",
        "twak_agent_wallet_missing",
        "twak_agent_wallet_password_missing"
      ]
    });
  });
});
