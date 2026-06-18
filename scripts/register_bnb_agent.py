#!/usr/bin/env python3
"""Dry-run-first BNB Agent SDK registration readiness helper.

This script validates the local agent profile and prints a registration plan.
Default behavior never imports private keys, signs, or broadcasts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any


REGISTRIES = {
    "bsc-mainnet": {"chain_id": 56, "identity_registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"},
    "bsc-testnet": {"chain_id": 97, "identity_registry": "0x8004A818BFB912233c491871b3d84c89A494BD9e"},
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare a dry-run BNB ERC-8004 agent registration plan.")
    parser.add_argument("--dry-run", action="store_true", default=os.environ.get("BNB_AGENT_DRY_RUN", "true").lower() != "false")
    parser.add_argument("--network", default=os.environ.get("BNB_AGENT_NETWORK", "bsc-mainnet"), choices=sorted(REGISTRIES))
    parser.add_argument("--wallet-mode", default=os.environ.get("BNB_AGENT_WALLET_MODE", "twak"), choices=["twak", "privy", "private_key"])
    parser.add_argument("--profile", default=os.environ.get("BNB_AGENT_PROFILE_PATH", "docs/hackathon/agent-profile.json"))
    args = parser.parse_args()

    if not args.dry_run:
        raise SystemExit("Refusing non-dry-run registration from this helper. Broadcast requires a separate explicit operator-approved path.")

    profile_path = Path(args.profile)
    profile = load_profile(profile_path)
    profile_bytes = json.dumps(profile, sort_keys=True, separators=(",", ":")).encode("utf-8")
    profile_hash = "0x" + hashlib.sha256(profile_bytes).hexdigest()
    wallet_address = selected_public_wallet(args.wallet_mode)
    network = REGISTRIES[args.network]

    print(
        json.dumps(
            {
                "mode": "bnb_agent_registration_readiness",
                "dryRun": True,
                "signing": False,
                "broadcasting": False,
                "network": args.network,
                "chainId": network["chain_id"],
                "identityRegistry": network["identity_registry"],
                "walletMode": args.wallet_mode,
                "publicWalletAddress": wallet_address,
                "profilePath": str(profile_path),
                "profileHashSha256": profile_hash,
                "profileName": profile.get("name"),
                "profileUriPreview": f"file://{profile_path.resolve()}",
                "nextStep": "Ask organizers which wallet/network should be registered, then use an explicit approval-gated registration path.",
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def load_profile(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Profile file does not exist: {path}")
    with path.open("r", encoding="utf-8") as handle:
        profile = json.load(handle)
    if not isinstance(profile, dict):
        raise SystemExit("Profile JSON must be an object")
    for field in ("name", "description"):
        if not isinstance(profile.get(field), str) or not profile[field].strip():
            raise SystemExit(f"Profile field {field!r} is required")
    return profile


def selected_public_wallet(wallet_mode: str) -> str | None:
    env_by_mode = {
        "twak": "TWAK_AGENT_WALLET_ADDRESS",
        "privy": "PREDICT_FUN_EXECUTION_WALLET_ADDRESS",
        "private_key": "BNB_AGENT_PUBLIC_WALLET",
    }
    value = os.environ.get(env_by_mode[wallet_mode]) or os.environ.get("BNB_AGENT_PUBLIC_WALLET")
    if value and value.startswith("0x") and len(value) == 42:
        return value
    return None


if __name__ == "__main__":
    raise SystemExit(main())
