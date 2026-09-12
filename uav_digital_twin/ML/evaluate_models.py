import argparse
import collections
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import ML.fault_detector as detector_v1  # noqa: E402
import ML.fault_detector_v2 as detector_v2  # noqa: E402
from ML.engine_features import SENSOR_KEYS, features_for, load_dataset, score_features  # noqa: E402
from sensor_simulator import FAULTS  # noqa: E402


# ============================================================
# EVALUATE MODELS: v1 vs v2
# ============================================================
# Teen detectors compare hote hain:
#
#   rules  sirf fault rules (fault_detector.py ke thresholds)
#   v1     rules + model v1 (isolation_forest.pkl) - backend abhi yahi chalata hai
#   v2     rules + model v2 (engine_model_v2.pkl)
#
# 1. HEALTHY ENGINE (test_normal.csv): false alarms per hour,
#    flight phase aur sensor noise ke hisaab se
# 2. FAULTS (test_faults.csv): har fault episode ke liye
#    - found      kitne episodes pakde gaye
#    - @severity  pehli detection par fault kitna develop ho chuka tha
#                 (kam = jaldi pakda)
#    - after      episode shuru hone ke kitne seconds baad
#
# USAGE (uav_digital_twin folder se, generate + train ke baad):
#   python ML/evaluate_models.py
# ============================================================

DATA_DIR = Path(__file__).resolve().parent / "data"
ALERT_GAP_SECONDS = 15  # the dashboard merges repeats within 15 s into one alert
PHASE_ORDER = ["TAKEOFF", "CLIMB", "CRUISE", "LOITER", "DESCENT"]
DETECTORS = ["rules", "v1", "v2"]


def reading_at(data, i):

    return {key: None if np.isnan(data[key][i]) else float(data[key][i]) for key in SENSOR_KEYS}


def run_v1(data):

    """Rules + model v1 for every row.

    Calls the real detect_fault per row, but the Isolation Forest is evaluated for all rows in one
    batch first (identical results, minutes faster)."""

    n = len(data["sim_time"])
    readings = [reading_at(data, i) for i in range(n)]

    X = np.array([
        [detector_v1.NORMAL_PROFILE[key][0] if r[key] is None else r[key] for key in detector_v1.FEATURES]
        for r in readings
    ])
    real_model = detector_v1.model
    lookup = {
        row.tobytes(): (prediction, score)
        for row, prediction, score in zip(X, real_model.predict(X), real_model.decision_function(X))
    }

    class BatchedModel:
        def predict(self, x):
            return [lookup[x[0].tobytes()][0]]

        def decision_function(self, x):
            return [lookup[x[0].tobytes()][1]]

    detector_v1.model = BatchedModel()
    try:
        results = [detector_v1.detect_fault(r) for r in readings]
    finally:
        detector_v1.model = real_model

    rule_label = np.array(
        [r["fault_type"] if r["fault_type"] not in (None, "UNKNOWN_ANOMALY") else "" for r in results],
        dtype=object
    )
    v1_flag = np.array([r["status"] == "ANOMALY" for r in results])

    return rule_label, v1_flag


def run_v2(data, rule_label):

    scores = score_features(detector_v2.bundle, features_for(detector_v2.bundle, data))
    model_flag = scores["limit_flag"] | scores["forest_flag"]

    return (rule_label != "") | model_flag, scores


def check_online_matches_batch(data, scores, rows=900):

    # The live detector (one reading at a time) must produce the same scores as this batch evaluation
    detector_v2.reset()
    worst = 0.0

    for i in range(rows):
        if data["run_id"][i] != data["run_id"][0]:
            break
        out = detector_v2.score_reading({**reading_at(data, i), "engine_id": "check", "timestamp": float(data["sim_time"][i])})
        if out is not None:
            worst = max(worst, abs(out["anomaly_score"] - scores["anomaly_score"][i]))

    detector_v2.reset()
    return worst


def alert_starts(data, flags):

    # Flagged readings more than 15 s after the previous flagged one = a new dashboard alert
    starts = np.zeros(len(flags), dtype=bool)
    last_run, last_time = None, None

    for i in np.flatnonzero(flags):
        run, t = data["run_id"][i], data["sim_time"][i]
        if run != last_run or t - last_time > ALERT_GAP_SECONDS:
            starts[i] = True
        last_run, last_time = run, t

    return starts


def healthy_report(data, flags):

    starts = {name: alert_starts(data, f) for name, f in flags.items()}

    print("\n1. HEALTHY ENGINE - false alarms (test_normal.csv)")
    print(f"   {'profile':8s} {'noise':>5s} {'phase':8s} {'hours':>5s} | "
          + " | ".join(f"{name + ' alerts/h':>13s} {'flagged':>7s}" for name in DETECTORS))

    for profile in sorted(set(data["profile"])):
        for noise in sorted(set(data["noise_scale"])):

            base = (data["profile"] == profile) & (data["noise_scale"] == noise)
            if not base.any():
                continue

            phases = [p for p in PHASE_ORDER if (base & (data["phase"] == p)).any()]

            for phase in phases + (["ALL"] if len(phases) > 1 else []):
                mask = base if phase == "ALL" else base & (data["phase"] == phase)
                hours = mask.sum() / 3600
                cells = [
                    f"{starts[name][mask].sum() / hours:>13.1f} {flags[name][mask].mean():>7.1%}"
                    for name in DETECTORS
                ]
                print(f"   {profile:8s} {noise:>5g} {phase:8s} {hours:>5.1f} | " + " | ".join(cells))


def fault_episodes(data):

    episodes = []
    i, n = 0, len(data["sim_time"])

    while i < n:
        fault = data["true_fault"][i]
        if fault == "":
            i += 1
            continue
        j = i
        while j + 1 < n and data["run_id"][j + 1] == data["run_id"][i] and data["true_fault"][j + 1] == fault:
            j += 1
        episodes.append((i, j, fault))
        i = j + 1

    return episodes


def median_or_dash(values, fmt):

    return fmt.format(statistics.median(values)) if values else "-"


def fault_report(data, flags, rule_label):

    stats = collections.defaultdict(lambda: collections.defaultdict(list))

    for start, end, fault in fault_episodes(data):

        first = {}
        for name, f in flags.items():
            hits = np.flatnonzero(f[start:end + 1])
            first[name] = start + hits[0] if len(hits) else None

        profile = data["profile"][start]

        for key in ((profile, fault), (profile, "ALL FAULTS")):
            s = stats[key]
            s["episodes"].append(1)
            s["named"].append(bool((rule_label[start:end + 1] == fault).any()))

            for name, i in first.items():
                s[f"{name}_found"].append(i is not None)
                if i is not None:
                    s[f"{name}_severity"].append(data["fault_severity"][i])
                    s[f"{name}_after"].append(data["sim_time"][i] - data["sim_time"][start])

            if first["rules"] is not None and first["v2"] is not None:
                s["v2_lead"].append(data["sim_time"][first["rules"]] - data["sim_time"][first["v2"]])

    print("\n2. FAULT EPISODES (test_faults.csv)")
    print("   found = episodes detected | @sev = median fault severity at first detection | "
          "after = median seconds into the episode")
    print(f"   {'profile':8s} {'fault':24s} {'eps':>3s} | "
          + " | ".join(f"{name:^20s}" for name in DETECTORS)
          + f" | {'v2 before':>9s} | {'rules name':>10s}")
    print(f"   {'':8s} {'':24s} {'':>3s} | "
          + " | ".join(f"{'found':>5s} {'@sev':>5s} {'after':>8s}" for _ in DETECTORS)
          + f" | {'rules by':>9s} | {'it right':>10s}")

    order = list(FAULTS) + ["ALL FAULTS"]

    for profile in sorted({p for p, _ in stats}):
        for fault in order:
            s = stats.get((profile, fault))
            if not s:
                continue
            cells = []
            for name in DETECTORS:
                found = s[f"{name}_found"]
                cells.append(
                    f"{sum(found) / len(found):>5.0%} "
                    f"{median_or_dash(s[f'{name}_severity'], '{:.0%}'):>5s} "
                    f"{median_or_dash(s[f'{name}_after'], '{:.0f}s'):>8s}"
                )
            print(
                f"   {profile:8s} {fault:24s} {len(s['episodes']):>3d} | " + " | ".join(cells)
                + f" | {median_or_dash(s['v2_lead'], '{:+.0f}s'):>9s}"
                + f" | {sum(s['named']) / len(s['named']):>10.0%}"
            )
        print()

    print("   Note: in the mission profile v1 flags most healthy non-cruise readings, so its")
    print("   'detections' there mostly come from false alarms that were already firing.")


def main():

    parser = argparse.ArgumentParser(description="Compare anomaly detection v1 vs v2 on simulator data")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    started = time.time()

    normal = load_dataset(args.data_dir / "test_normal.csv")
    rule_label, v1_flag = run_v1(normal)
    v2_flag, _ = run_v2(normal, rule_label)
    healthy_report(normal, {"rules": rule_label != "", "v1": v1_flag, "v2": v2_flag})

    faults = load_dataset(args.data_dir / "test_faults.csv")
    rule_label, v1_flag = run_v1(faults)
    v2_flag, scores = run_v2(faults, rule_label)
    fault_report(faults, {"rules": rule_label != "", "v1": v1_flag, "v2": v2_flag}, rule_label)

    worst = check_online_matches_batch(faults, scores)
    print(f"\nLive detector vs batch evaluation: max score difference {worst:.1e} "
          f"({'OK' if worst < 1e-6 else 'MISMATCH - features differ between training and live use'})")
    print(f"Done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
