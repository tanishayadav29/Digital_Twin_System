import argparse
import random
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ML import fault_detector as detector_v1  # noqa: E402
from ML.engine_features import (  # noqa: E402
    RESIDUAL_SENSORS,
    SENSOR_KEYS,
    features_for,
    load_dataset,
    score_features,
)
from ML.rul_features import (  # noqa: E402
    DEVIATION_DECIMALS,
    RUL_FEATURE_NAMES,
    SLOPE_WINDOW_SECONDS,
    slope_matrix,
)


# ============================================================
# TRAIN SHORT-TERM RUL MODEL
# ============================================================
# Question it answers: "the detector has just said ANOMALY - how
# many seconds until this fault is fully developed (ACTIVE)?"
#
# Data   ML/data/test_faults.csv (from generate_dataset.py - it
#        already has fault_stage + fault_severity ground truth, so
#        no new data is generated here)
# Rows   only readings the live detector would flag as ANOMALY
#        during a fault episode - exactly when rul_estimator.py
#        is called, so training and live use match
# Label  seconds from this reading until the episode's
#        fault_stage first equals "ACTIVE" (0 once ACTIVE or
#        RECOVERING - it is already at / past critical)
# Inputs deviation + 60 s slope per sensor (ML/rul_features.py),
#        seconds since the anomaly was first flagged, detector's
#        fault_type (categorical)
# Split  by run_id (whole flights), never by row - neighbouring
#        seconds are almost identical, a row split would leak
#
# Three models: point estimate + 10th / 90th percentile band.
#
# NOTE ON RANGE: the simulator's DEVELOPING stage lasts 150-240 s
# and the detector usually fires part-way through, so labels -
# and predictions - never exceed ~240 s. If the simulator's
# FAULT_RAMP changes, retrain.
#
# USAGE (uav_digital_twin folder se, pehle generate_dataset.py):
#   python ML/train_rul_model.py
# Output: ML/models/rul_model.pkl
# ============================================================

ML_DIR = Path(__file__).resolve().parent

# Fault types the detector can return (v1 rule names == simulator names)
FAULT_CATEGORIES = [
    "OVERHEATING",
    "LUBRICATION_ISSUE",
    "MISFIRE",
    "ABNORMAL_VIBRATION",
    "INJECTOR_ABNORMALITY",
    "COMBUSTION_INSTABILITY",
    "ELECTRICAL_FAULT",
    "SENSOR_DRIFT_FAILURE",
    "UNKNOWN_ANOMALY",
]

# Same aliases as frontend/src/config/maintenance.js
FAULT_ALIASES = {
    "LOW_OIL_PRESSURE": "LUBRICATION_ISSUE",
    "HIGH_VIBRATION": "ABNORMAL_VIBRATION",
    "FUEL_ANOMALY": "INJECTOR_ABNORMALITY",
}

# An anomaly "streak" continues through gaps shorter than this (the
# detector can blink NORMAL for a reading or two mid-fault)
STREAK_GAP_SECONDS = 30

VAL_FRACTION = 0.25
SPLIT_SEED = 7


def fault_code(fault_type):

    fault_type = FAULT_ALIASES.get(fault_type, fault_type)
    return float(FAULT_CATEGORIES.index(fault_type)) if fault_type in FAULT_CATEGORIES else np.nan


@contextmanager
def rules_only_v1():

    # detector v1's Isolation Forest is ignored by fault_detector_v2
    # (only its rule names are used), but it costs ~20 ms per call.
    # Swap in a stub that always says "normal" so the rules can run
    # over 130k rows in seconds. v2 treats v1's UNKNOWN_ANOMALY as
    # "no rule matched" anyway, so the outcome is identical.
    class _AlwaysNormal:
        def predict(self, x):
            return np.ones(len(x), dtype=int)

        def decision_function(self, x):
            return np.zeros(len(x))

    real = detector_v1.model
    detector_v1.model = _AlwaysNormal()
    try:
        yield
    finally:
        detector_v1.model = real


def detector_outputs(bundle, data):

    # Batch replay of fault_detector_v2.detect_fault(): status, fault_type, deviation
    n = len(data["sim_time"])
    features = features_for(bundle, data)
    scores = score_features(bundle, features)
    model_anomaly = scores["forest_flag"] | scores["limit_flag"]

    rule_fault = np.empty(n, dtype=object)

    with rules_only_v1():
        for i in range(n):
            reading = {key: (None if np.isnan(data[key][i]) else float(data[key][i])) for key in SENSOR_KEYS}
            name = detector_v1.detect_fault(reading)["fault_type"]
            rule_fault[i] = name if name not in (None, "UNKNOWN_ANOMALY") else None

    has_rule = np.array([f is not None for f in rule_fault])
    anomaly = has_rule | model_anomaly
    fault_type = np.where(has_rule, rule_fault, np.where(model_anomaly, "UNKNOWN_ANOMALY", None))
    # Live detector reports `deviation` for the RESIDUAL_SENSORS only (first
    # columns); extra columns such as the physics residual are not part of it
    deviation = np.round(features[:, :len(RESIDUAL_SENSORS)], DEVIATION_DECIMALS)

    return anomaly, fault_type, deviation


def seconds_flagged(data, anomaly):

    # Seconds since the current anomaly streak started (0 when not flagged)
    out = np.zeros(len(anomaly))
    run, start, last = None, None, None

    for i, flagged in enumerate(anomaly):

        t = data["sim_time"][i]

        if data["run_id"][i] != run:
            run, start, last = data["run_id"][i], None, None

        if flagged:
            if last is None or t - last > STREAK_GAP_SECONDS:
                start = t
            last = t
            out[i] = t - start

    return out


def seconds_to_active(data):

    # Label per row; nan = not in a fault episode, or episode never reached ACTIVE
    n = len(data["sim_time"])
    label = np.full(n, np.nan)
    i = 0

    while i < n:

        fault = data["true_fault"][i]

        if not fault:
            i += 1
            continue

        # One episode = consecutive rows of the same run with the same true_fault
        j = i
        while j < n and data["run_id"][j] == data["run_id"][i] and data["true_fault"][j] == fault:
            j += 1

        stages = data["fault_stage"][i:j]
        active = np.flatnonzero(stages == "ACTIVE")

        if len(active):
            active_start = data["sim_time"][i + active[0]]
            label[i:j] = np.maximum(0.0, active_start - data["sim_time"][i:j])

        i = j

    return label


def feature_matrix(deviation, slopes, flagged_for, fault_type):

    codes = np.array([fault_code(f) for f in fault_type])
    return np.column_stack([deviation, slopes, flagged_for, codes])


def report(name, y, pred, lo, hi):

    mae = np.abs(pred - y).mean()
    developing = y > 0
    mae_dev = np.abs(pred[developing] - y[developing]).mean() if developing.any() else float("nan")
    coverage = ((y >= lo) & (y <= hi)).mean()
    print(f"   {name:10s} MAE {mae:6.1f} s | MAE while still developing {mae_dev:6.1f} s"
          f" | 10-90% band holds truth {coverage:5.1%}")


def main():

    parser = argparse.ArgumentParser(description="Train the short-term (seconds) RUL model")
    parser.add_argument("--data", type=Path, default=ML_DIR / "data" / "test_faults.csv")
    parser.add_argument("--detector", type=Path, default=ML_DIR / "models" / "engine_model_v2.pkl")
    parser.add_argument("--out", type=Path, default=ML_DIR / "models" / "rul_model.pkl")
    args = parser.parse_args()

    started = time.time()

    data = load_dataset(args.data)
    detector = joblib.load(args.detector)

    print(f"Data: {args.data.name}, {len(data['sim_time'])} readings")

    anomaly, fault_type, deviation = detector_outputs(detector, data)
    slopes = slope_matrix(data, deviation)
    flagged_for = seconds_flagged(data, anomaly)
    label = seconds_to_active(data)

    X = feature_matrix(deviation, slopes, flagged_for, fault_type)
    use = anomaly & ~np.isnan(label)

    print(f"Detector flagged {anomaly.sum()} readings; {use.sum()} of them are inside a fault episode"
          f" that reaches ACTIVE -> training rows")
    print(f"Label range 0-{label[use].max():.0f} s, {np.mean(label[use] == 0):.0%} already ACTIVE/RECOVERING (label 0)")


    # ---------------- split by run_id ----------------
    runs = sorted(set(data["run_id"]))
    random.Random(SPLIT_SEED).shuffle(runs)
    val_runs = set(runs[: max(1, round(len(runs) * VAL_FRACTION))])
    is_val = np.array([r in val_runs for r in data["run_id"]])

    tr, va = use & ~is_val, use & is_val
    print(f"Split by run: {len(runs) - len(val_runs)} train runs ({tr.sum()} rows),"
          f" {len(val_runs)} validation runs ({va.sum()} rows)")


    # ---------------- models ----------------
    categorical = np.zeros(X.shape[1], dtype=bool)
    categorical[-1] = True

    def model(**kw):
        return HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40,
            categorical_features=categorical, random_state=0, **kw
        )

    point = model().fit(X[tr], label[tr])
    low = model(loss="quantile", quantile=0.1).fit(X[tr], label[tr])
    high = model(loss="quantile", quantile=0.9).fit(X[tr], label[tr])

    max_label = float(label[use].max())

    def predict(rows):
        p = np.clip(point.predict(rows), 0, max_label)
        lo = np.clip(low.predict(rows), 0, max_label)
        hi = np.clip(high.predict(rows), 0, max_label)
        return p, np.minimum(lo, p), np.maximum(hi, p)

    print("\nValidation (runs the model never saw)")
    p, lo, hi = predict(X[va])
    report("model", label[va], p, lo, hi)
    baseline = np.full(va.sum(), np.median(label[tr]))
    report("baseline", label[va], baseline, baseline, baseline)
    print("   (baseline = always answer the training median)")

    print("\nPer fault type (validation, MAE s)")
    for name in FAULT_CATEGORIES:
        rows = va & (fault_type == name)
        if rows.sum() >= 20:
            pr, _, _ = predict(X[rows])
            print(f"   {name:24s} {np.abs(pr - label[rows]).mean():6.1f}  ({rows.sum()} rows)")

    bundle = {
        "version": 1,
        "feature_names": RUL_FEATURE_NAMES + ["seconds_flagged", "fault_type"],
        "sensors": RESIDUAL_SENSORS,
        "slope_window_seconds": SLOPE_WINDOW_SECONDS,
        "streak_gap_seconds": STREAK_GAP_SECONDS,
        "fault_categories": FAULT_CATEGORIES,
        "fault_aliases": FAULT_ALIASES,
        "point": point,
        "low": low,
        "high": high,
        "max_seconds": max_label,
        "trained_on": {
            "data": args.data.name,
            "rows": int(tr.sum()),
            "val_runs": sorted(val_runs),
            "sklearn_version": sklearn.__version__,
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out, compress=3)
    print(f"\nSaved {args.out} ({args.out.stat().st_size / 1e6:.1f} MB) in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
