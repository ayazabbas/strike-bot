import { createECDH } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config.js";

export interface PredictFunExecutionWalletStatus {
  readonly configured: boolean;
  readonly address: string | null;
  readonly keyFile: string;
  readonly signing: false;
  readonly broadcasting: false;
  readonly reasons: readonly string[];
}

export interface PredictFunExecutionWalletAdapter {
  getStatus(): Promise<PredictFunExecutionWalletStatus>;
}

export class FilePredictFunExecutionWalletAdapter implements PredictFunExecutionWalletAdapter {
  constructor(private readonly config: Pick<AppConfig, "predictFunPrivyKeyFile">) {}

  async getStatus(): Promise<PredictFunExecutionWalletStatus> {
    try {
      const privateKey = normalizePrivateKey(await readFile(this.config.predictFunPrivyKeyFile, "utf8"));
      return {
        configured: true,
        address: deriveEthereumAddress(privateKey),
        keyFile: this.config.predictFunPrivyKeyFile,
        signing: false,
        broadcasting: false,
        reasons: []
      };
    } catch (error) {
      return {
        configured: false,
        address: null,
        keyFile: this.config.predictFunPrivyKeyFile,
        signing: false,
        broadcasting: false,
        reasons: [executionWalletFailureReason(error)]
      };
    }
  }
}

export function deriveEthereumAddress(privateKey: Buffer): string {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(privateKey);
  const publicKey = ecdh.getPublicKey(undefined, "uncompressed").subarray(1);
  const addressHex = keccak256(publicKey).subarray(12).toString("hex");
  return toChecksumAddress(addressHex);
}

export function normalizePrivateKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const match = /(?:^|\s)(?:0x)?([0-9a-fA-F]{64})(?:\s|$)/.exec(trimmed);
  if (!match) {
    throw new Error("predict_fun_privy_key_invalid");
  }
  return Buffer.from(match[1], "hex");
}

function executionWalletFailureReason(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "predict_fun_privy_key_file_missing";
  }
  if (error instanceof Error && error.message === "predict_fun_privy_key_invalid") {
    return "predict_fun_privy_key_invalid";
  }
  return "predict_fun_execution_wallet_unavailable";
}

function toChecksumAddress(addressHex: string): string {
  const lower = addressHex.toLowerCase();
  const hash = keccak256(Buffer.from(lower, "ascii")).toString("hex");
  let checksum = "0x";

  for (let index = 0; index < lower.length; index += 1) {
    checksum += Number.parseInt(hash[index], 16) >= 8 ? lower[index].toUpperCase() : lower[index];
  }

  return checksum;
}

const MASK_64 = (1n << 64n) - 1n;
const KECCAK_ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
];
const KECCAK_ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14]
];

function keccak256(input: Buffer): Buffer {
  const rateBytes = 136;
  const state = Array<bigint>(25).fill(0n);
  const padded = Buffer.concat([input, Buffer.from([0x01])]);
  const paddingLength = (rateBytes - (padded.length % rateBytes)) % rateBytes;
  const message = Buffer.concat([padded, Buffer.alloc(paddingLength)]);
  message[message.length - 1] ^= 0x80;

  for (let offset = 0; offset < message.length; offset += rateBytes) {
    for (let lane = 0; lane < rateBytes / 8; lane += 1) {
      state[lane] ^= message.readBigUInt64LE(offset + lane * 8);
    }
    keccakF1600(state);
  }

  const output = Buffer.alloc(32);
  for (let lane = 0; lane < output.length / 8; lane += 1) {
    output.writeBigUInt64LE(state[lane], lane * 8);
  }
  return output;
}

function keccakF1600(state: bigint[]): void {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const c = Array<bigint>(5);
    const d = Array<bigint>(5);
    const b = Array<bigint>(25);

    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      d[x] = c[(x + 4) % 5] ^ rotateLeft64(c[(x + 1) % 5], 1);
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64;
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft64(state[x + 5 * y], KECCAK_ROTATION_OFFSETS[x][y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (b[x + 5 * y] ^ ((~b[((x + 1) % 5) + 5 * y] & MASK_64) & b[((x + 2) % 5) + 5 * y])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

function rotateLeft64(value: bigint, shift: number): bigint {
  if (shift === 0) {
    return value & MASK_64;
  }
  const amount = BigInt(shift);
  return ((value << amount) | (value >> (64n - amount))) & MASK_64;
}
