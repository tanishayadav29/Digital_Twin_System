import math
from pathlib import Path

import joblib
import numpy as np


# ============================================================
# LONG-TERM RUL (years) - features + live inference
# ============================================================
# Engine life is tracked as Palmgren-Miner cumulative damage
# (see generate_fleet_dataset.py): cumulative_wear goes 0 -> 1.0,
# end of life at 1.0.
#
# The model (train_rul_years_model.py) predicts FLIGHTS remaining.
# Years = flights / ASSUMED_FLIGHTS_PER_YEAR. That conversion is an
# explicit ASSUMPTION about how hard the engine is used, not
# something the model learns - change it here if your ops differ.
#
# Features = current wear + how the last few flights went (the
# "trend"). If wear was set by hand and there is no flight history
# yet, the trend features are NaN and the model falls back to a
# wear-only estimate (it was trained with that case included).
#
# Both training and the backend call history_features(), so the
# inputs are built the same way in both places.
# ============================================================

ASSUMED_FLIGHTS_PER_YEAR = 200

RECENT_FLIGHTS = 10         # "recent" = the last 10 flights
TREND_FLIGHTS = 20          # damage acceleration measured over the last 20

YEARS_FEATURES = [
    "cumulative_wear",
    "recent_damage_per_flight",
    "damage_trend",
    "recent_fault_rate",
    "recent_mean_cht",
    "recent_mean_vibration",
    "recent_max_vibration",
]

MODEL_PATH = Path(__file__).resolve().parent / "models" / "rul_years_model.pkl"


def history_features(cumulative_wear, history):

    """history: list of per-flight dicts, oldest first, with keys
    damage_this_flight, fault_count_this_flight, mean_cht, mean_vibration, max_vibration."""

    row = [float(cumulative_wear)] + [math.nan] * (len(YEARS_FEATURES) - 1)

    if not history:
        return row

    recent = history[-RECENT_FLIGHTS:]
    damage = np.array([float(h["damage_this_flight"]) for h in recent])

    row[1] = float(damage.mean())
    row[3] = float(np.mean([float(h["fault_count_this_flight"]) for h in recent]))
    row[4] = float(np.mean([float(h["mean_cht"]) for h in recent]))
    row[5] = float(np.mean([float(h["mean_vibration"]) for h in recent]))
    row[6] = float(np.mean([float(h["max_vibration"]) for h in recent]))

    trend = np.array([float(h["damage_this_flight"]) for h in history[-TREND_FLIGHTS:]])
    if len(trend) >= 5:
        # damage added per flight, per flight (> 0 = wearing faster and faster)
        row[2] = float(np.polyfit(np.arange(len(trend)), trend, 1)[0])

    return row


def _plural(n, word):

    return f"{n} {word}" + ("" if n == 1 else "s")


def human_duration(years):

    """1.19 -> "1 year 2 months", 0.17 -> "2 months", 0.03 -> "1 week"."""

    if years <= 0:
        return "0 days"

    days = years * 365
    if days < 7:
        return _plural(max(1, round(days)), "day")

    months = round(years * 12)
    if months < 1:
        return _plural(round(days / 7), "week")

    y, m = divmod(months, 12)
    parts = ([_plural(y, "year")] if y else []) + ([_plural(m, "month")] if m else [])
    return " ".join(parts)


_bundle = None


def _model():

    global _bundle
    if _bundle is None and MODEL_PATH.exists():
        _bundle = joblib.load(MODEL_PATH)
    return _bundle


def estimate_rul_years(cumulative_wear, history=None):

    """Returns {"flights": .., "years": .., "low_years": .., "high_years": .., ...} or None if no model."""

    history = history or []

    if cumulative_wear >= 1.0:
        return {
            "flights": 0.0, "years": 0.0, "low_years": 0.0, "high_years": 0.0,
            "end_of_life": True, "basis": "wear >= 1.0",
            "flights_per_year_assumed": ASSUMED_FLIGHTS_PER_YEAR,
            "remaining": "0 days",
            "range": "0 days",
            "summary": "Engine has reached end of life - overhaul due.",
        }

    bundle = _model()
    if bundle is None:
        return None

    x = np.array([history_features(cumulative_wear, history)])
    cap = bundle["max_flights"]
    flights = float(np.clip(bundle["point"].predict(x)[0], 0, cap))
    low = float(np.clip(bundle["low"].predict(x)[0], 0, cap))
    high = float(np.clip(bundle["high"].predict(x)[0], 0, cap))

    per_year = ASSUMED_FLIGHTS_PER_YEAR
    years, low_years, high_years = flights / per_year, min(low, flights) / per_year, max(high, flights) / per_year

    # Readable text (numbers above stay for code / charts)
    remaining = human_duration(years)
    low_text, high_text = human_duration(low_years), human_duration(high_years)

    return {
        "flights": round(flights, 1),
        "years": round(years, 2),
        "low_years": round(low_years, 2),
        "high_years": round(high_years, 2),
        "end_of_life": False,
        "basis": "wear + last flights" if history else "wear only (no flight history yet)",
        "flights_per_year_assumed": per_year,
        "remaining": remaining,
        "range": low_text if low_text == high_text else f"{low_text} to {high_text}",
        "summary": (
            f"About {remaining} of engine life left"
            f" (~{round(flights)} flights at {per_year} flights/year)."
        ),
    }
