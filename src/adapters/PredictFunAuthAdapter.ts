import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { AppConfig } from "../config.js";
import { normalizePrivateKey } from "./PredictFunExecutionWalletAdapter.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;
type ModuleLoader = (specifier: string) => Promise<unknown>;

export type PredictFunJwtAcquisitionStatus = "cached" | "acquired" | "skipped" | "not_ready" | "failed";

export interface PredictFunAuthReadiness {
  readonly accountAddressConfigured: boolean;
  readonly accountAddress: string | null;
  readonly authMessageEndpointReachable: boolean;
  readonly tokenCachePresent: boolean;
  readonly jwtAcquisitionStatus: PredictFunJwtAcquisitionStatus;
  readonly signing: false;
  readonly broadcasting: false;
  readonly reasons: readonly string[];
}

export interface PredictFunAuthAdapter {
  checkReadiness(options?: { readonly acquireJwt?: boolean }): Promise<PredictFunAuthReadiness>;
}

export interface PredictFunAuthSigner {
  signPredictAccountMessage(message: string): Promise<string>;
}

export class RestPredictFunAuthAdapter implements PredictFunAuthAdapter {
  constructor(
    private readonly config: Pick<
      AppConfig,
      "predictFunBaseUrl" | "predictFunApiKey" | "predictFunAccountAddress" | "predictFunJwtCacheFile"
    >,
    private readonly signer: PredictFunAuthSigner,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly cwd: string = process.cwd()
  ) {}

  async checkReadiness(options: { readonly acquireJwt?: boolean } = {}): Promise<PredictFunAuthReadiness> {
    const accountAddress = this.config.predictFunAccountAddress;
    const tokenCachePresent = await hasNonEmptyFile(this.config.predictFunJwtCacheFile);
    const base = {
      accountAddressConfigured: Boolean(accountAddress),
      accountAddress: accountAddress || null,
      tokenCachePresent,
      signing: false as const,
      broadcasting: false as const
    };

    if (!accountAddress) {
      return {
        ...base,
        authMessageEndpointReachable: false,
        jwtAcquisitionStatus: "not_ready",
        reasons: ["predict_fun_account_address_missing"]
      };
    }

    if (!this.config.predictFunApiKey) {
      return {
        ...base,
        authMessageEndpointReachable: false,
        jwtAcquisitionStatus: tokenCachePresent ? "cached" : "not_ready",
        reasons: tokenCachePresent ? [] : ["predict_fun_api_key_missing"]
      };
    }

    const messageResult = await this.fetchAuthMessage();
    if (!messageResult.ok) {
      return {
        ...base,
        authMessageEndpointReachable: false,
        jwtAcquisitionStatus: tokenCachePresent ? "cached" : "failed",
        reasons: [messageResult.reason]
      };
    }

    if (tokenCachePresent) {
      return {
        ...base,
        authMessageEndpointReachable: true,
        jwtAcquisitionStatus: "cached",
        reasons: []
      };
    }

    if (!options.acquireJwt) {
      return {
        ...base,
        authMessageEndpointReachable: true,
        jwtAcquisitionStatus: "skipped",
        reasons: ["predict_fun_jwt_acquisition_not_requested"]
      };
    }

    if (isInsideDirectory(this.config.predictFunJwtCacheFile, this.cwd)) {
      return {
        ...base,
        authMessageEndpointReachable: true,
        jwtAcquisitionStatus: "failed",
        reasons: ["predict_fun_jwt_cache_file_inside_repo"]
      };
    }

    let signature: string;
    try {
      signature = await this.signer.signPredictAccountMessage(messageResult.message);
    } catch (error) {
      return {
        ...base,
        authMessageEndpointReachable: true,
        jwtAcquisitionStatus: "not_ready",
        reasons: [predictFunAuthFailureReason(error)]
      };
    }

    const jwtResult = await this.fetchJwt(accountAddress, messageResult.message, signature);
    if (!jwtResult.ok) {
      return {
        ...base,
        authMessageEndpointReachable: true,
        jwtAcquisitionStatus: "failed",
        reasons: [jwtResult.reason]
      };
    }

    await mkdir(dirname(this.config.predictFunJwtCacheFile), { recursive: true });
    await writeFile(this.config.predictFunJwtCacheFile, `${jwtResult.jwt}\n`, { mode: 0o600 });

    return {
      ...base,
      tokenCachePresent: true,
      authMessageEndpointReachable: true,
      jwtAcquisitionStatus: "acquired",
      reasons: []
    };
  }

  private async fetchAuthMessage(): Promise<{ ok: true; message: string } | { ok: false; reason: string }> {
    try {
      const response = await this.fetchImpl(new URL("/v1/auth/message", this.config.predictFunBaseUrl), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-api-key": this.config.predictFunApiKey ?? ""
        }
      });

      if (!response.ok) {
        return { ok: false, reason: "predict_fun_auth_message_unreachable" };
      }

      const message = extractString(await response.json(), ["message", "authMessage", "signingMessage"]);
      return message ? { ok: true, message } : { ok: false, reason: "predict_fun_auth_message_missing" };
    } catch {
      return { ok: false, reason: "predict_fun_auth_message_unreachable" };
    }
  }

  private async fetchJwt(
    signer: string,
    message: string,
    signature: string
  ): Promise<{ ok: true; jwt: string } | { ok: false; reason: string }> {
    try {
      const response = await this.fetchImpl(new URL("/v1/auth", this.config.predictFunBaseUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": this.config.predictFunApiKey ?? ""
        },
        body: JSON.stringify({ signer, message, signature })
      });

      if (!response.ok) {
        return { ok: false, reason: "predict_fun_jwt_request_failed" };
      }

      const jwt = extractString(await response.json(), ["jwt", "token", "accessToken", "access_token"]);
      return jwt ? { ok: true, jwt } : { ok: false, reason: "predict_fun_jwt_missing" };
    } catch {
      return { ok: false, reason: "predict_fun_jwt_request_failed" };
    }
  }
}

export class PredictFunSdkAuthSigner implements PredictFunAuthSigner {
  constructor(
    private readonly config: Pick<AppConfig, "predictFunPrivyKeyFile" | "predictFunAccountAddress">,
    private readonly loadModule: ModuleLoader = defaultModuleLoader
  ) {}

  async signPredictAccountMessage(message: string): Promise<string> {
    const [sdk, ethers] = await Promise.all([this.loadModule("@predictdotfun/sdk"), this.loadModule("ethers")]);
    const sdkRecord = asRecord(sdk);
    const orderBuilder = asRecord(sdkRecord["OrderBuilder"]);
    const chainId = asRecord(sdkRecord["ChainId"]);
    const ethersRecord = asRecord(ethers);
    const Wallet = ethersRecord["Wallet"];
    const make = orderBuilder["make"];

    if (typeof make !== "function" || typeof Wallet !== "function" || chainId["BnbMainnet"] === undefined) {
      throw new Error("predict_fun_sdk_auth_signer_unavailable");
    }

    const privateKey = normalizePrivateKey(await readFile(this.config.predictFunPrivyKeyFile, "utf8"));
    const wallet = new (Wallet as new (privateKey: string) => unknown)(`0x${privateKey.toString("hex")}`);
    const builder = asRecord(
      await make(chainId["BnbMainnet"], wallet, {
        predictAccount: this.config.predictFunAccountAddress
      })
    );
    const signPredictAccountMessage = builder["signPredictAccountMessage"] ?? sdkRecord["signPredictAccountMessage"];

    if (typeof signPredictAccountMessage !== "function") {
      throw new Error("predict_fun_sdk_auth_signer_unavailable");
    }

    const signature =
      builder["signPredictAccountMessage"] === signPredictAccountMessage
        ? await signPredictAccountMessage.call(builder, message)
        : await signPredictAccountMessage(message);

    if (typeof signature !== "string" || signature.length === 0) {
      throw new Error("predict_fun_sdk_auth_signature_invalid");
    }

    return signature;
  }
}

export class NotReadyPredictFunAuthSigner implements PredictFunAuthSigner {
  async signPredictAccountMessage(): Promise<string> {
    throw new Error("predict_fun_sdk_auth_signer_unavailable");
  }
}

function defaultModuleLoader(specifier: string): Promise<unknown> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
  return dynamicImport(specifier);
}

function extractString(payload: unknown, keys: readonly string[]): string | undefined {
  if (typeof payload === "string") {
    return payload.trim().length > 0 ? payload : undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  for (const key of ["data", "result"]) {
    const nested = extractString(payload[key], keys);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function predictFunAuthFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    if (error.message === "predict_fun_privy_key_invalid") {
      return error.message;
    }
    if (error.message.startsWith("Cannot find package") || error.message.includes("ERR_MODULE_NOT_FOUND")) {
      return "predict_fun_sdk_auth_signer_unavailable";
    }
    if (error.message.startsWith("ENOENT:")) {
      return "predict_fun_privy_key_file_missing";
    }
    if (error.message.startsWith("predict_fun_")) {
      return error.message;
    }
  }

  return "predict_fun_auth_signing_failed";
}

async function hasNonEmptyFile(path: string): Promise<boolean> {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return (await readFile(path, "utf8")).trim().length > 0;
  } catch {
    return false;
  }
}

function isInsideDirectory(path: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(path));
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function isRecord(value: unknown): value is UnknownRecord {
  return (typeof value === "object" || typeof value === "function") && value !== null;
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}
