import argparse
import csv
import random
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ML.rul_years import (  # noqa: E402
    ASSUMED_FLIGHTS_PER_YEAR,
    YEARS_FEATURES,
    history_features,
)


# ============================================================
# TRAIN LONG-TERM RUL MODEL (years)
# ============================================================
# Data   ML/data/fleet_flights.csv (generate_fleet_dataset.py),
#        one row per flight
# Label  flights_remaining_to_eol
# Inputs ML/rul_years.py -> history_features(): current wear + the
#        last flights' damage, damage trend, fault rate, CHT, vibration
# Split  by engine_id (whole engines), never by row
#
# Some training rows get their history features blanked (NaN), so the
# model also learns to answer from wear alone - that is the situation
# right after POST /engine-wear sets wear by hand.
#
# Printed comparison: the plain Miner extrapolation
#     flights left = (1 - wear) / recent damage per flight
# assumes wear keeps its current pace; the model can learn that wear
# speeds up as the engine gets worse.
#
# Model choice: HistGradientBoostingRegressor (same tool as the rest of
# ML/). A Weibull survival model (lifelines) would be the more rigorous
# option if real fleet data with censored engines (still flying) arrives.
#
# USAGE (uav_digital_twin folder se, pehle generate_fleet_dataset.py):
#   python ML/train_rul_years_model.py
# Output: ML/models/rul_years_model.pkl
# ============================================================

ML_DIR = Path(__file__).resolve().parent

TEST_FRACTION = 0.2
SPLIT_SEED = 11
NO_HISTORY_FRACTION = 0.25


def load(path):

    engines = {}
    with open(path, newline="") as file:
        for row in csv.DictReader(file):
            engines.setdefault(row["engine_id"], []).append(row)
    return engines


def build(engines, ids, rng, blank_fraction):

    X, y = [], []
    for engine_id in ids:
        flights = engines[engine_id]
        for i, row in enumerate(flights):
            history = flights[: i + 1]
            if rng.random() < blank_fraction:
                history = []
            X.append(history_features(float(row["cumulative_wear"]), history))
            y.append(float(row["flights_remaining_to_eol"]))
    return np.array(X), np.array(y)


def main():

    parser = argparse.ArgumentParser(description="Train the long-term (years) RUL model")
    parser.add_argument("--data", type=Path, default=ML_DIR / "data" / "fleet_flights.csv")
    parser.add_argument("--out", type=Path, default=ML_DIR / "models" / "rul_years_model.pkl")
    args = parser.parse_args()

    started = time.time()
    engines = load(args.data)

    ids = sorted(engines)
    random.Random(SPLIT_SEED).shuffle(ids)
    test_ids = sorted(ids[: max(1, round(len(ids) * TEST_FRACTION))])
    train_ids = sorted(ids[len(test_ids):])

    rng = random.Random(0)
    X_tr, y_tr = build(engines, train_ids, rng, NO_HISTORY_FRACTION)
    X_te, y_te = build(engines, test_ids, rng, 0.0)
    X_te_blank, _ = build(engines, test_ids, random.Random(0), 1.0)

    print(f"Engines: {len(train_ids)} train / {len(test_ids)} test  |  flights: {len(y_tr)} train / {len(y_te)} test")

    def model(**kw):
        return HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=30, random_state=0, **kw
        )

    point = model().fit(X_tr, y_tr)
    # Bands: simpler trees (bigger leaves) - flights of one engine are strongly
    # correlated, so detailed quantile trees overfit and give bands that are too narrow
    band = dict(max_iter=150, min_samples_leaf=300)
    low = HistGradientBoostingRegressor(loss="quantile", quantile=0.1, random_state=0, **band).fit(X_tr, y_tr)
    high = HistGradientBoostingRegressor(loss="quantile", quantile=0.9, random_state=0, **band).fit(X_tr, y_tr)

    cap = float(y_tr.max())

    def evaluate(name, X):
        p = np.clip(point.predict(X), 0, cap)
        lo = np.minimum(np.clip(low.predict(X), 0, cap), p)
        hi = np.maximum(np.clip(high.predict(X), 0, cap), p)
        mae = np.abs(p - y_te).mean()
        cover = ((y_te >= lo) & (y_te <= hi)).mean()
        print(f"   {name:34s} MAE {mae:6.1f} flights = {mae / ASSUMED_FLIGHTS_PER_YEAR:4.2f} years"
              f" | 10-90% band holds truth {cover:5.1%}")

    print(f"\nTest engines (never seen in training), years at {ASSUMED_FLIGHTS_PER_YEAR} flights/year")
    evaluate("model, wear + flight history", X_te)
    evaluate("model, wear only", X_te_blank)

    rate = X_te[:, YEARS_FEATURES.index("recent_damage_per_flight")]
    wear = X_te[:, YEARS_FEATURES.index("cumulative_wear")]
    miner = np.clip((1 - wear) / np.maximum(rate, 1e-6), 0, cap)
    print(f"   {'baseline: linear Miner extrapolation':34s} MAE {np.abs(miner - y_te).mean():6.1f} flights"
          f" = {np.abs(miner - y_te).mean() / ASSUMED_FLIGHTS_PER_YEAR:4.2f} years")

    late = wear > 0.7
    print(f"   late life only (wear > 0.7): model MAE {np.abs(np.clip(point.predict(X_te[late]), 0, cap) - y_te[late]).mean():.1f}"
          f" flights, Miner {np.abs(miner[late] - y_te[late]).mean():.1f} flights")

    bundle = {
        "version": 1,
        "features": YEARS_FEATURES,
        "point": point,
        "low": low,
        "high": high,
        "max_flights": cap,
        "flights_per_year_assumed": ASSUMED_FLIGHTS_PER_YEAR,
        "trained_on": {
            "data": args.data.name,
            "train_engines": train_ids,
            "test_engines": test_ids,
            "sklearn_version": sklearn.__version__,
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out, compress=3)
    print(f"\nSaved {args.out} ({args.out.stat().st_size / 1e6:.1f} MB) in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
