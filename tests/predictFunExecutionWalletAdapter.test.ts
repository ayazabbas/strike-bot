import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  deriveEthereumAddress,
  FilePredictFunExecutionWalletAdapter
} from "../src/adapters/PredictFunExecutionWalletAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("FilePredictFunExecutionWalletAdapter", () => {
  it("derives the predict.fun execution wallet address without returning the Privy key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-privy-"));
    tempDirs.push(dir);
    const keyPath = join(dir, "predict_privy_key");
    const privateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
    await writeFile(keyPath, `${privateKey}\n`, { mode: 0o600 });

    const adapter = new FilePredictFunExecutionWalletAdapter(loadConfig({ PREDICT_FUN_PRIVY_KEY_FILE: keyPath }));

    await expect(adapter.getStatus()).resolves.toEqual({
      configured: true,
      address: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
      keyFile: keyPath,
      signing: false,
      broadcasting: false,
      reasons: []
    });
  });

  it("reports a missing Privy key file without signing or broadcasting", async () => {
    const keyPath = "/tmp/strike-bot-missing-predict-privy-key";
    const adapter = new FilePredictFunExecutionWalletAdapter(loadConfig({ PREDICT_FUN_PRIVY_KEY_FILE: keyPath }));

    await expect(adapter.getStatus()).resolves.toEqual({
      configured: false,
      address: null,
      keyFile: keyPath,
      signing: false,
      broadcasting: false,
      reasons: ["predict_fun_privy_key_file_missing"]
    });
  });

  it("matches the Ethereum address test vector for private key one", () => {
    expect(deriveEthereumAddress(Buffer.from("0000000000000000000000000000000000000000000000000000000000000001", "hex"))).toBe(
      "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf"
    );
  });
});
