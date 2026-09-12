import argparse
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor, IsolationForest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ML.engine_features import (  # noqa: E402
    RESIDUAL_SENSORS,
    RPM_TIME_CONSTANTS,
    WINDOW_SECONDS,
    features_for,
    load_dataset,
    make_features,
    raw_scores,
    residual_matrix,
    rolling_matrix,
    rpm_feature_matrix,
)


# ============================================================
# TRAIN MODEL v2
# ============================================================
# Sirf healthy data se seekhta hai (koi fault label use nahi hota).
#
# STEP 1  BASELINE     har sensor ke liye regression: RPM (aur uske
#                      averages) -> expected sensor value
# STEP 2  FEATURES     residuals -> 30 s rolling mean
#                      (ML/engine_features.py)
# STEP 3  DETECTORS    a) Isolation Forest - kai sensors ka combined pattern
#                      b) Residual limit   - koi ek sensor expected se door
# STEP 4  THRESHOLDS   alag validation data par, taaki healthy engine par
#                      ~0.5 flagged readings / hour se zyada na aayein
#
# Model v1 (isolation_forest.pkl + fault_detector.py) ko ye touch
# nahi karta. Output: ML/models/engine_model_v2.pkl
#
# USAGE (uav_digital_twin folder se, pehle generate_dataset.py):
#   python ML/train_model_v2.py
# ============================================================

ML_DIR = Path(__file__).resolve().parent

# ASCII only - Windows consoles can't always print ° or ±
UNITS = {
    "cht": "degC", "egt": "degC", "oil_pressure": "psi", "oil_temperature": "degC", "fuel_flow": "L/h",
    "vibration": "g", "battery_voltage": "V", "alternator_current": "A", "injection_timing": "deg"
}


def warmed_up(data):

    # Rows at least one full window after their run started
    start = {}
    out = np.zeros(len(data["sim_time"]), dtype=bool)

    for i, run in enumerate(data["run_id"]):
        start.setdefault(run, data["sim_time"][i])
        out[i] = data["sim_time"][i] - start[run] >= WINDOW_SECONDS

    return out


def main():

    parser = argparse.ArgumentParser(description="Train anomaly model v2 on simulator data")
    parser.add_argument("--data-dir", type=Path, default=ML_DIR / "data")
    parser.add_argument("--out", type=Path, default=ML_DIR / "models" / "engine_model_v2.pkl")
    parser.add_argument(
        "--false-flags-per-hour", type=float, default=0.5,
        help="how many healthy readings per hour may be flagged on the validation data (default 0.5)"
    )
    args = parser.parse_args()

    started = time.time()

    train = load_dataset(args.data_dir / "train_normal.csv")
    val = load_dataset(args.data_dir / "val_normal.csv")

    train_hours = len(train["sim_time"]) / 3600
    val_hours = len(val["sim_time"]) / 3600

    print(f"Training data:   {train_hours:.0f} h healthy ({len(train['sim_time'])} readings)")
    print(f"Validation data: {val_hours:.0f} h healthy ({len(val['sim_time'])} readings)")


    # ========================================================
    # STEP 1: BASELINE - expected sensor value for the current RPM
    # ========================================================

    bundle = {
        "version": 2,
        "sensors": RESIDUAL_SENSORS,
        "rpm_time_constants": RPM_TIME_CONSTANTS,
        "window_seconds": WINDOW_SECONDS,
        "regressors": {},
        "residual_scale": {}
    }

    rpm_features = rpm_feature_matrix(train)
    usable = ~np.isnan(rpm_features).any(axis=1)

    print("\nSTEP 1  Expected value from RPM (spread of healthy readings around it)")

    for key in RESIDUAL_SENSORS:

        mask = usable & ~np.isnan(train[key])

        regressor = HistGradientBoostingRegressor(max_iter=200, random_state=0)
        regressor.fit(rpm_features[mask], train[key][mask])

        residual = train[key][mask] - regressor.predict(rpm_features[mask])

        # Robust standard deviation (median absolute deviation)
        scale = 1.4826 * np.median(np.abs(residual - np.median(residual)))

        bundle["regressors"][key] = regressor
        bundle["residual_scale"][key] = float(scale)

        explained = 1 - residual.var() / train[key][mask].var()
        print(f"   {key:19s} +/- {scale:.3f} {UNITS[key]:4s} (RPM explains {explained:5.1%} of its variation)")


    # ========================================================
    # STEP 2 + 3: FEATURES AND ISOLATION FOREST
    # ========================================================

    residuals = residual_matrix(bundle, train, rpm_features)
    means = rolling_matrix(train, residuals)
    warm = warmed_up(train)

    bundle["z_std"] = means[warm].std(axis=0)

    features = make_features(bundle, means)

    forest = IsolationForest(n_estimators=200, max_samples=512, random_state=42)
    forest.fit(features[warm])

    bundle["isolation_forest"] = forest
    bundle["forest_spread"] = float(forest.decision_function(features[warm]).std())

    print(f"\nSTEP 2-3  Isolation Forest trained on {warm.sum()} feature rows ({features.shape[1]} features)")


    # ========================================================
    # STEP 4: THRESHOLDS on validation data
    # ========================================================
    # Budget half-half dono detectors mein

    val_features = features_for(bundle, val)
    limit, forest_score = raw_scores(bundle, val_features)

    fraction = args.false_flags_per_hour / 2 / 3600

    bundle["limit_threshold"] = float(np.quantile(limit, 1 - fraction, method="higher"))
    bundle["forest_threshold"] = float(np.quantile(forest_score, fraction, method="lower"))
    bundle["false_flags_per_hour_target"] = args.false_flags_per_hour

    limit_flags = limit > bundle["limit_threshold"]
    forest_flags = forest_score < bundle["forest_threshold"]

    print("\nSTEP 4  Thresholds (validation data)")
    print(f"   residual limit   : {bundle['limit_threshold']:.2f} (30 s average, in standard deviations)"
          f" -> {limit_flags.sum()} flagged readings")
    print(f"   isolation forest : {bundle['forest_threshold']:+.4f}"
          f" -> {forest_flags.sum()} flagged readings")
    print(f"   either           : {(limit_flags | forest_flags).sum() / val_hours:.2f} flagged readings / hour"
          f" (target {args.false_flags_per_hour:g})")

    bundle["trained_on"] = {
        "train_readings": int(len(train["sim_time"])),
        "val_readings": int(len(val["sim_time"])),
        "sklearn_version": sklearn.__version__
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out, compress=3)

    print(f"\nSaved {args.out} ({args.out.stat().st_size / 1e6:.1f} MB) in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
