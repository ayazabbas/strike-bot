import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  PredictFunSdkAuthSigner,
  RestPredictFunAuthAdapter,
  type PredictFunAuthSigner
} from "../src/adapters/PredictFunAuthAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe("RestPredictFunAuthAdapter", () => {
  it("reports not-ready auth status without calling the network when the API key is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-auth-no-key-"));
    tempDirs.push(dir);
    const fetchImpl = vi.fn();
    const signer: PredictFunAuthSigner = {
      async signPredictAccountMessage() {
        return "0xsignature";
      }
    };
    const adapter = new RestPredictFunAuthAdapter(
      { ...loadConfig({ PREDICT_FUN_JWT_CACHE_FILE: join(dir, "predict_fun_jwt") }), predictFunApiKey: undefined },
      signer,
      fetchImpl
    );

    await expect(adapter.checkReadiness({ acquireJwt: true })).resolves.toEqual({
      accountAddressConfigured: true,
      accountAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
      authMessageEndpointReachable: false,
      tokenCachePresent: false,
      jwtAcquisitionStatus: "not_ready",
      signing: false,
      broadcasting: false,
      reasons: ["predict_fun_api_key_missing"]
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches an auth message, signs it, posts the official REST auth body, and caches only the JWT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-auth-"));
    tempDirs.push(dir);
    const jwtPath = join(dir, "predict_fun_jwt");
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "Sign this Predict account message" })).mockResolvedValueOnce(
      jsonResponse({ jwt: "jwt-secret-value" })
    );
    const signer: PredictFunAuthSigner = {
      async signPredictAccountMessage(message: string) {
        expect(message).toBe("Sign this Predict account message");
        return "0xsigned";
      }
    };
    const adapter = new RestPredictFunAuthAdapter(
      loadConfig({ PREDICT_FUN_API_KEY: "api-key", PREDICT_FUN_JWT_CACHE_FILE: jwtPath }),
      signer,
      fetchImpl
    );

    const result = await adapter.checkReadiness({ acquireJwt: true });

    expect(result).toEqual({
      accountAddressConfigured: true,
      accountAddress: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
      authMessageEndpointReachable: true,
      tokenCachePresent: true,
      jwtAcquisitionStatus: "acquired",
      signing: false,
      broadcasting: false,
      reasons: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0].toString()).toBe("https://api.predict.fun/v1/auth/message");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "api-key" });
    expect(fetchImpl.mock.calls[1][0].toString()).toBe("https://api.predict.fun/v1/auth");
    expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string)).toEqual({
      signer: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55",
      message: "Sign this Predict account message",
      signature: "0xsigned"
    });
    expect(await readFile(jwtPath, "utf8")).toBe("jwt-secret-value\n");
    expect(JSON.stringify(result)).not.toContain("jwt-secret-value");
  });

  it("reports a present JWT cache without signing or posting a new token request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-auth-cache-"));
    tempDirs.push(dir);
    const jwtPath = join(dir, "predict_fun_jwt");
    await writeFile(jwtPath, "cached-jwt\n", { mode: 0o600 });
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ data: { message: "Sign this" } }));
    const signer: PredictFunAuthSigner = {
      async signPredictAccountMessage() {
        throw new Error("should_not_sign");
      }
    };
    const adapter = new RestPredictFunAuthAdapter(
      loadConfig({ PREDICT_FUN_API_KEY: "api-key", PREDICT_FUN_JWT_CACHE_FILE: jwtPath }),
      signer,
      fetchImpl
    );

    await expect(adapter.checkReadiness({ acquireJwt: true })).resolves.toMatchObject({
      authMessageEndpointReachable: true,
      tokenCachePresent: true,
      jwtAcquisitionStatus: "cached",
      reasons: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache a JWT inside the repository", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "Sign this" }));
    const signer: PredictFunAuthSigner = {
      async signPredictAccountMessage() {
        return "0xsigned";
      }
    };
    const adapter = new RestPredictFunAuthAdapter(
      loadConfig({ PREDICT_FUN_API_KEY: "api-key", PREDICT_FUN_JWT_CACHE_FILE: "./predict_fun_jwt" }),
      signer,
      fetchImpl,
      process.cwd()
    );

    await expect(adapter.checkReadiness({ acquireJwt: true })).resolves.toMatchObject({
      authMessageEndpointReachable: true,
      tokenCachePresent: false,
      jwtAcquisitionStatus: "failed",
      reasons: ["predict_fun_jwt_cache_file_inside_repo"]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("PredictFunSdkAuthSigner", () => {
  it("uses the official SDK OrderBuilder when it is available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "strike-bot-auth-signer-"));
    tempDirs.push(dir);
    const keyPath = join(dir, "predict_privy_key");
    await writeFile(keyPath, "0x0000000000000000000000000000000000000000000000000000000000000001\n", { mode: 0o600 });
    const make = vi.fn().mockReturnValue({
      async signPredictAccountMessage(message: string) {
        return `signed:${message}`;
      }
    });
    const Wallet = vi.fn();
    const signer = new PredictFunSdkAuthSigner(
      loadConfig({ PREDICT_FUN_PRIVY_KEY_FILE: keyPath }),
      async (specifier: string) => {
        if (specifier === "@predictdotfun/sdk") {
          return { ChainId: { BnbMainnet: 56 }, OrderBuilder: { make } };
        }
        if (specifier === "ethers") {
          return { Wallet };
        }
        throw new Error(`unexpected module: ${specifier}`);
      }
    );

    await expect(signer.signPredictAccountMessage("auth-message")).resolves.toBe("signed:auth-message");
    expect(Wallet).toHaveBeenCalledWith("0x0000000000000000000000000000000000000000000000000000000000000001");
    expect(make).toHaveBeenCalledWith(56, expect.any(Wallet), {
      predictAccount: "0x5b4D5ed6eD6c16Fe9eABf552479711C50e6D5E55"
    });
  });
});
