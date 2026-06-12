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
      { TWAK_ACCESS_ID: "id", TWAK_HMAC_SECRET: "secret" },
      "/tmp/nonexistent-twak-credentials.json",
      async () => true
    );

    await expect(adapter.checkReadiness()).resolves.toEqual({
      enabled: true,
      ready: true,
      reasons: []
    });
  });

  it("accepts an external credentials file path without storing credentials in the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-twak-"));
    tempDirs.push(dir);
    const credentialsPath = join(dir, "credentials.json");
    await writeFile(credentialsPath, "{}", "utf8");
    const adapter = new EnvTrustWalletAgentKitAdapter(
      loadConfig({ BSC_RPC_URL: "https://bsc.example", TRUST_WALLET_AGENT_KIT_CONFIG_PATH: credentialsPath }),
      {},
      "/tmp/nonexistent-twak-credentials.json",
      async () => true
    );

    await expect(adapter.checkReadiness()).resolves.toMatchObject({ ready: true, reasons: [] });
  });

  it("reports missing TWAK readiness inputs explicitly", async () => {
    const adapter = new EnvTrustWalletAgentKitAdapter(loadConfig({}), {}, "/tmp/nonexistent-twak-credentials.json", async () => false);

    await expect(adapter.checkReadiness()).resolves.toMatchObject({
      ready: false,
      reasons: ["twak_credentials_missing", "bsc_rpc_url_missing", "twak_cli_missing"]
    });
  });
});
