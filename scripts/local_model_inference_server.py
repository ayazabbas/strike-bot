#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pickle
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

DEFAULT_RESEARCH_DIR = Path("/home/ubuntu/.hermes/workspace/strike-bot-research")
DEFAULT_MODEL_PATH = DEFAULT_RESEARCH_DIR / "data/experiments/20260618_185155_full_model_matrix/ev_hist_gradient_boosting.pkl"
DEFAULT_DIRECTION_MODEL_PATH = DEFAULT_RESEARCH_DIR / "data/experiments/20260618_185155_full_model_matrix/direction_logistic.pkl"


class InferenceService:
    def __init__(self, model_path: Path, direction_model_path: Path | None) -> None:
        self.model_path = model_path
        self.direction_model_path = direction_model_path
        self.model = load_model_bundle(model_path)
        self.direction_model = load_model_bundle(direction_model_path) if direction_model_path else None
        direction_name = direction_model_path.name if direction_model_path else "none"
        self.model_version = f"sklearn-local:{model_path.name}:{direction_name}"

    def infer(self, request: dict[str, Any]) -> dict[str, Any]:
        row = request_to_feature_row(request)
        candidates = build_side_candidate_rows(row)
        if candidates.empty:
            return ok_response(self.model_version, [])

        out = score_profitability(candidates, self.model)
        if self.direction_model is not None:
            out = score_direction(row, out, self.direction_model)

        outputs = []
        for item in out.sort_values("predictedEv", ascending=False).to_dict("records"):
            outputs.append(
                {
                    "direction": item["direction"],
                    "entryAsk": json_number(item.get("entryAsk")),
                    "entryBid": json_number(item.get("entryBid")),
                    "profitabilityProbability": json_number(item.get("profitabilityProbability")),
                    "directionProbability": json_number(item.get("directionProbability")),
                    "predictedEv": json_number(item.get("predictedEv")),
                    "directionEdge": json_number(item.get("directionEdge")),
                    "modelScore": json_number(item.get("predictedEv")),
                }
            )
        return ok_response(self.model_version, outputs)


def request_to_feature_row(request: dict[str, Any]) -> pd.DataFrame:
    features = request.get("features") if isinstance(request.get("features"), dict) else {}
    feature_state = features.get("featureState") if isinstance(features.get("featureState"), dict) else {}
    market = request.get("market") if isinstance(request.get("market"), dict) else {}
    pricing = request.get("pricing") if isinstance(request.get("pricing"), dict) else {}

    row: dict[str, Any] = dict(feature_state)
    captured_at = request.get("capturedAt")
    row.setdefault("evaluation_time", captured_at)
    row.setdefault("window_start", market.get("startsAt"))
    row.setdefault("window_end", market.get("closesAt"))
    row.setdefault("seconds_to_close", market.get("timeRemainingSeconds"))
    row.setdefault("elapsed_seconds", features.get("elapsedSeconds"))
    if "elapsed_minutes" not in row and numeric(row.get("elapsed_seconds")) is not None:
        row["elapsed_minutes"] = float(row["elapsed_seconds"]) / 60.0
    row.setdefault("label_direction", "up")
    row.setdefault("label_magnitude_bps", 0.0)
    row.setdefault("window_return", 0.0)

    for side in ("up", "down"):
        side_payload = pricing.get(side) if isinstance(pricing.get(side), dict) else {}
        row.setdefault(f"{side}_bid", side_payload.get("bestBid"))
        row.setdefault(f"{side}_ask", side_payload.get("bestAsk"))

    latest = features.get("latestCandle") if isinstance(features.get("latestCandle"), dict) else {}
    if latest:
        row.setdefault("known_open", latest.get("open"))
        row.setdefault("known_high", latest.get("high"))
        row.setdefault("known_low", latest.get("low"))
        row.setdefault("known_close", latest.get("close"))
        open_price = numeric(row.get("known_open"))
        close = numeric(row.get("known_close"))
        high = numeric(row.get("known_high"))
        low = numeric(row.get("known_low"))
        if open_price and close is not None:
            row.setdefault("partial_return", (close - open_price) / open_price)
            row.setdefault("partial_return_bps", ((close - open_price) / open_price) * 10_000)
        if open_price and high is not None and low is not None:
            row.setdefault("partial_range_bps", ((high - low) / open_price) * 10_000)
            row.setdefault("range_bps", ((high - low) / open_price) * 10_000)
            row.setdefault("close_location", ((close - low) / (high - low)) if close is not None and high > low else np.nan)

    normalized = {key: normalize_value(value) for key, value in row.items()}
    return pd.DataFrame([normalized])


def add_odds_features(states: pd.DataFrame) -> pd.DataFrame:
    out = states.copy()
    for column in ("up_bid", "up_ask", "down_bid", "down_ask"):
        out[column] = pd.to_numeric(out[column], errors="coerce") if column in out else np.nan
    out["up_implied_mid"] = (out["up_bid"] + out["up_ask"]) / 2.0
    out["down_implied_mid"] = (out["down_bid"] + out["down_ask"]) / 2.0
    out["up_spread"] = out["up_ask"] - out["up_bid"]
    out["down_spread"] = out["down_ask"] - out["down_bid"]
    out["market_spread_sum"] = out["up_spread"] + out["down_spread"]
    out["book_overround_ask"] = out["up_ask"] + out["down_ask"] - 1.0
    out["book_underround_bid"] = 1.0 - (out["up_bid"] + out["down_bid"])
    partial_return = pd.to_numeric(out.get("partial_return_bps", pd.Series([np.nan])), errors="coerce")
    momentum_up_probability = (0.5 + (partial_return / 100.0)).clip(0.01, 0.99).fillna(0.5)
    out["pyth_vs_up_ask_edge_proxy"] = momentum_up_probability - out["up_ask"]
    out["pyth_vs_down_ask_edge_proxy"] = (1.0 - momentum_up_probability) - out["down_ask"]
    evaluation_time = pd.to_datetime(out.get("evaluation_time"), utc=True, errors="coerce")
    hour = evaluation_time.dt.hour.fillna(0)
    day = evaluation_time.dt.dayofweek.fillna(0)
    out["utc_hour_sin"] = np.sin(2.0 * np.pi * hour / 24.0)
    out["utc_hour_cos"] = np.cos(2.0 * np.pi * hour / 24.0)
    out["day_of_week_sin"] = np.sin(2.0 * np.pi * day / 7.0)
    out["day_of_week_cos"] = np.cos(2.0 * np.pi * day / 7.0)
    return out


def build_side_candidate_rows(states: pd.DataFrame) -> pd.DataFrame:
    source = add_odds_features(states)
    source["row_id"] = np.arange(len(source))
    frames = []
    for side in ("up", "down"):
        side_frame = source.copy()
        opposite = "down" if side == "up" else "up"
        side_frame["side"] = side
        side_frame["side_is_up"] = 1 if side == "up" else 0
        side_frame["side_ask"] = side_frame[f"{side}_ask"]
        side_frame["side_bid"] = side_frame[f"{side}_bid"]
        side_frame["opposite_ask"] = side_frame[f"{opposite}_ask"]
        side_frame["opposite_bid"] = side_frame[f"{opposite}_bid"]
        side_frame["side_implied_mid"] = side_frame[f"{side}_implied_mid"]
        side_frame["opposite_implied_mid"] = side_frame[f"{opposite}_implied_mid"]
        side_frame["side_spread"] = side_frame[f"{side}_spread"]
        side_frame["opposite_spread"] = side_frame[f"{opposite}_spread"]
        side_frame["side_edge_proxy"] = side_frame[f"pyth_vs_{side}_ask_edge_proxy"]
        side_frame["opposite_edge_proxy"] = side_frame[f"pyth_vs_{opposite}_ask_edge_proxy"]
        frames.append(side_frame)
    candidates = pd.concat(frames, ignore_index=True)
    return candidates.dropna(subset=["side_ask"]).reset_index(drop=True)


def score_profitability(candidates: pd.DataFrame, bundle: dict[str, Any]) -> pd.DataFrame:
    feature_columns = list(bundle["feature_columns"])
    features = candidates.reindex(columns=feature_columns).replace({pd.NA: np.nan}).infer_objects()
    probabilities = bundle["pipeline"].predict_proba(features)[:, 1]
    out = candidates.copy()
    out["direction"] = out["side"].map({"up": "UP", "down": "DOWN"})
    out["entryAsk"] = pd.to_numeric(out["side_ask"], errors="coerce")
    out["entryBid"] = pd.to_numeric(out["side_bid"], errors="coerce")
    out["profitabilityProbability"] = probabilities
    out["predictedEv"] = out["profitabilityProbability"] - out["entryAsk"]
    return out


def score_direction(row: pd.DataFrame, candidates: pd.DataFrame, bundle: dict[str, Any]) -> pd.DataFrame:
    feature_columns = list(bundle["feature_columns"])
    features = row.reindex(columns=feature_columns).replace({pd.NA: np.nan}).infer_objects()
    up_probabilities = bundle["pipeline"].predict_proba(features)[:, 1]
    up_by_row = pd.Series(up_probabilities, index=np.arange(len(row)))
    out = candidates.copy()
    up_probability = out["row_id"].map(up_by_row)
    out["directionProbability"] = np.where(out["side"] == "up", up_probability, 1.0 - up_probability)
    out["directionEdge"] = out["directionProbability"] - out["entryAsk"]
    out["direction_rank"] = out.groupby("row_id")["directionEdge"].rank(method="first", ascending=False)
    return out[out["direction_rank"] == 1.0].drop(columns=["direction_rank"]).copy()


def load_model_bundle(model_path: Path | None) -> dict[str, Any]:
    if model_path is None:
        raise RuntimeError("model path is not configured")
    with model_path.open("rb") as handle:
        bundle = pickle.load(handle)
    if not isinstance(bundle, dict) or "pipeline" not in bundle or "feature_columns" not in bundle:
        raise RuntimeError(f"unexpected model bundle shape at {model_path}")
    return bundle


def ok_response(model_version: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "status": "ok",
        "capturedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "modelVersion": model_version,
        "candidates": candidates,
    }


def normalize_value(value: Any) -> Any:
    if value is None:
        return np.nan
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        parsed = numeric(value)
        return parsed if parsed is not None else value
    return np.nan


def numeric(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if np.isfinite(parsed) else None


def json_number(value: Any) -> float | None:
    parsed = numeric(value)
    return parsed if parsed is not None else None


class Handler(BaseHTTPRequestHandler):
    service: InferenceService

    def do_POST(self) -> None:
        if self.path != "/infer":
            self.send_json({"error": "not_found"}, status=404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request body must be a JSON object")
            self.send_json(self.service.infer(payload))
        except Exception as exc:  # noqa: BLE001 - endpoint returns structured local unavailability.
            self.send_json({"status": "unavailable", "reason": "invalid_response", "error": str(exc)}, status=500)

    def log_message(self, format: str, *args: Any) -> None:
        return

    def send_json(self, payload: dict[str, Any], *, status: int = 200) -> None:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    host = os.environ.get("MODEL_INFERENCE_HOST", "127.0.0.1")
    port = int(os.environ.get("MODEL_INFERENCE_PORT", "8765"))
    model_path = Path(os.environ.get("MODEL_PROFITABILITY_MODEL_PATH", str(DEFAULT_MODEL_PATH))).expanduser()
    direction_raw = os.environ.get("MODEL_DIRECTION_MODEL_PATH", str(DEFAULT_DIRECTION_MODEL_PATH)).strip()
    direction_model_path = Path(direction_raw).expanduser() if direction_raw else None
    Handler.service = InferenceService(model_path, direction_model_path)
    server = ThreadingHTTPServer((host, port), Handler)
    print(json.dumps({"event": "model_inference_server_ready", "host": host, "port": port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
