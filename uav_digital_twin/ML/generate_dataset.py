import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sensor_simulator import SENSOR_KEYS, EngineSimulator  # noqa: E402


# ============================================================
# DATASET GENERATOR
# ============================================================
# sensor_simulator.py se training aur testing ka data banata hai
# (backend ki zaroorat nahi, seconds mein ban jaata hai).
#
# train_normal.csv  healthy engine, full mission    -> model v2 seekhta hai "normal" kya hai
# val_normal.csv    healthy, alag seeds             -> alert threshold set karne ke liye
# test_normal.csv   healthy, alag seeds, 2x noise   -> false alarms kitne aate hain
# test_faults.csv   fault episodes ke saath         -> faults kitni jaldi pakde jaate hain
#
# Har file mein ground truth columns hain (phase, true_fault,
# fault_stage, fault_severity). Model sirf healthy data par train
# hota hai; labels sirf evaluation mein use hote hain.
#
# Har run ka apna seed hai, isliye same command hamesha same
# data banati hai.
#
# USAGE (uav_digital_twin folder se):
#   python ML/generate_dataset.py            full size (~115 hours, ~1 min)
#   python ML/generate_dataset.py --quick    10% size, for trying things out
# ============================================================

DATA_DIR = Path(__file__).resolve().parent / "data"

# Each part: `runs` separate flights of `hours` each, seeds seed, seed+1, ...
DATASETS = {
    "train_normal": [
        {"runs": 16, "hours": 2, "profile": "mission", "faults": False, "noise_scale": 1.0, "seed": 1000},
    ],
    "val_normal": [
        {"runs": 10, "hours": 2, "profile": "mission", "faults": False, "noise_scale": 1.0, "seed": 2000},
    ],
    "test_normal": [
        {"runs": 6, "hours": 2, "profile": "mission", "faults": False, "noise_scale": 1.0, "seed": 3000},
        {"runs": 4, "hours": 2, "profile": "cruise", "faults": False, "noise_scale": 1.0, "seed": 3100},
        {"runs": 4, "hours": 2, "profile": "mission", "faults": False, "noise_scale": 2.0, "seed": 3200},
    ],
    "test_faults": [
        {"runs": 12, "hours": 2, "profile": "mission", "faults": True, "noise_scale": 1.0, "seed": 4000},
        {"runs": 6, "hours": 2, "profile": "cruise", "faults": True, "noise_scale": 1.0, "seed": 4100},
    ],
}

COLUMNS = [
    "run_id", "profile", "noise_scale", "sim_time", *SENSOR_KEYS,
    "phase", "true_fault", "fault_stage", "fault_severity"
]


def generate(name, parts, scale, data_dir):

    rows = 0
    episodes = 0

    with open(data_dir / f"{name}.csv", "w", newline="") as file:

        writer = csv.writer(file)
        writer.writerow(COLUMNS)

        for part in parts:
            for k in range(part["runs"]):

                seed = part["seed"] + k
                run_id = f"{part['profile']}-noise{part['noise_scale']:g}-seed{seed}"

                sim = EngineSimulator(
                    profile=part["profile"],
                    faults_enabled=part["faults"],
                    noise_scale=part["noise_scale"],
                    seed=seed
                )

                last_fault = None

                for _ in range(int(part["hours"] * 3600 * scale)):

                    reading, truth = sim.step(1.0)

                    if truth["fault"] and truth["fault"] != last_fault:
                        episodes += 1
                    last_fault = truth["fault"]

                    writer.writerow([
                        run_id, part["profile"], part["noise_scale"], round(sim.time, 1),
                        *["" if reading[key] is None else reading[key] for key in SENSOR_KEYS],
                        truth["phase"], truth["fault"] or "", truth["stage"] or "", truth["severity"]
                    ])
                    rows += 1

    return rows, episodes


def main():

    parser = argparse.ArgumentParser(description="Generate training / test datasets from sensor_simulator.py")
    parser.add_argument("--quick", action="store_true", help="10%% of the full size")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    scale = 0.1 if args.quick else 1.0
    args.data_dir.mkdir(parents=True, exist_ok=True)

    info = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scale": scale,
        "datasets": {}
    }

    for name, parts in DATASETS.items():

        started = time.time()
        rows, episodes = generate(name, parts, scale, args.data_dir)

        info["datasets"][name] = {"parts": parts, "rows": rows, "fault_episodes": episodes}
        print(
            f"{name + '.csv':18s} {rows:7d} readings ({rows / 3600:5.1f} h)"
            f"{f', {episodes} fault episodes' if episodes else ''}  [{time.time() - started:.0f}s]"
        )

    with open(args.data_dir / "dataset_info.json", "w") as file:
        json.dump(info, file, indent=2)

    print(f"Saved to {args.data_dir}")


if __name__ == "__main__":
    main()
