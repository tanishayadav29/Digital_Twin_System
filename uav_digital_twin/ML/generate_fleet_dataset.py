import argparse
import csv
import json
import math
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sensor_simulator import EngineSimulator  # noqa: E402


# ============================================================
# FLEET DATASET GENERATOR (long-term RUL, years)
# ============================================================
# Same idea as generate_dataset.py, but one row per FLIGHT, not per
# second. Each fake engine flies flight after flight until it wears
# out; the per-flight summaries teach train_rul_years_model.py how
# many flights an engine has left.
#
# WEAR = PALMGREN-MINER CUMULATIVE DAMAGE
#   Every flight uses up a fraction of the engine's life:
#       damage = sum over stresses of (time at that stress) / (life at that stress)
#   and damage adds up across flights (Miner's rule):
#       cumulative_wear += damage      end of life when cumulative_wear >= 1.0
#
#   Stresses (every constant below is a DESIGN ASSUMPTION, tuned so an
#   engine lasts a few hundred flights - not measured Rotax data):
#   1. running time, with a Basquin S-N curve on vibration:
#          life_hours(vib) = BASE_LIFE_HOURS * (VIB_REF / vib) ** BASQUIN_EXPONENT
#      so shaking harder wears the engine much faster
#   2. time with CHT above the caution limit (205 degC, same as /engine-health):
#          life = THERMAL_LIFE_HOURS of hot running
#   3. each fault episode that happens in the flight: FAULT_DAMAGE
#
#   Feedback: the simulator shifts baselines with wear (sensor_simulator.py
#   WEAR_SHIFT - hotter, lower oil pressure, more vibration), so a worn engine
#   takes more damage per flight and wear speeds up towards the end.
#
# Every engine also gets a hidden life multiplier (manufacturing
# scatter) and a hidden fault-proneness, so two engines with the same
# wear do not have exactly the same life left.
#
# USAGE (uav_digital_twin folder se):
#   python ML/generate_fleet_dataset.py             50 engines (~2-3 min)
#   python ML/generate_fleet_dataset.py --quick     10 engines
# Output: ML/data/fleet_flights.csv
# ============================================================

DATA_DIR = Path(__file__).resolve().parent / "data"

SIM_DT = 10.0                  # simulated seconds per step (a flight summary does not need 1 Hz)
FLIGHT_HOURS = (1.0, 2.5)      # random flight length

# --- Palmgren-Miner damage model (design assumptions) ---
BASE_LIFE_HOURS = 2000.0       # new engine at reference vibration, no faults, no hot running (order of a Rotax 912 TBO)
VIB_REF = 0.30                 # g, healthy cruise vibration (simulator baseline)
BASQUIN_EXPONENT = 3.0         # S-N curve slope: 2x vibration -> 8x damage rate
CHT_LIMIT = 205.0              # degC, caution limit used by main.py /engine-health
THERMAL_LIFE_HOURS = 30.0      # hours above CHT_LIMIT that would use up a whole life
FAULT_DAMAGE = 0.01            # each fault episode uses 1% of life

# --- chance of a fault in a flight: grows as the engine wears ---
FAULT_CHANCE_NEW = 0.06
FAULT_CHANCE_WORN = 0.40       # at wear 1.0

# --- hidden per-engine scatter ---
LIFE_SCATTER = 0.20            # lognormal sigma on BASE_LIFE_HOURS
FAULT_PRONENESS = (0.5, 1.8)   # multiplier on the fault chance

MAX_FLIGHTS = 1500             # safety stop

FLIGHT_COLUMNS = [
    "flight_hours", "mean_cht", "max_cht", "mean_vibration", "max_vibration",
    "mean_oil_pressure", "min_oil_pressure", "hours_above_cht_limit",
    "fault_count_this_flight", "fault_type", "damage_this_flight",
]

COLUMNS = [
    "engine_id", "flight_num", "wear_before", "cumulative_wear",
    *FLIGHT_COLUMNS, "flights_remaining_to_eol",
]


def simulate_flight(cumulative_wear, seed, life_multiplier=1.0, fault_proneness=1.0):

    """One flight at the given wear. Returns a summary dict incl. damage_this_flight.

    Deterministic for a given (wear, seed) - the /simulate-flight endpoint relies on
    this so demos are reproducible.
    """

    rng = random.Random(seed)
    duration = rng.uniform(*FLIGHT_HOURS) * 3600

    fault_chance = min(0.95, fault_proneness * (
        FAULT_CHANCE_NEW + (FAULT_CHANCE_WORN - FAULT_CHANCE_NEW) * min(cumulative_wear, 1.0)
    ))
    has_fault = rng.random() < fault_chance

    sim = EngineSimulator(
        profile="mission",
        faults_enabled=has_fault,
        fault_after=rng.uniform(0.15, 0.7) * duration,
        seed=seed,
        cumulative_wear=cumulative_wear,
    )

    life_hours = BASE_LIFE_HOURS * life_multiplier
    steps = int(duration / SIM_DT)
    cht_sum = vib_sum = oil_sum = 0.0
    cht_n = vib_n = oil_n = 0
    max_cht = max_vib = -math.inf
    min_oil = math.inf
    hot_seconds = 0.0
    run_damage = 0.0
    faults, fault_type, in_fault = 0, "", False

    for _ in range(steps):

        reading, truth = sim.step(SIM_DT)

        if truth["fault"] and not in_fault:
            faults += 1
            fault_type = truth["fault"]
        if in_fault and not truth["fault"]:
            sim.faults_enabled = False      # at most one fault episode per flight
        in_fault = bool(truth["fault"])

        cht, vib, oil = reading["cht"], reading["vibration"], reading["oil_pressure"]

        if cht is not None:
            cht_sum, cht_n = cht_sum + cht, cht_n + 1
            max_cht = max(max_cht, cht)
            if cht > CHT_LIMIT:
                hot_seconds += SIM_DT

        if vib is not None:
            vib_sum, vib_n = vib_sum + vib, vib_n + 1
            max_vib = max(max_vib, vib)
            # Basquin: damage rate grows with vibration ** exponent
            run_damage += (SIM_DT / 3600) / (life_hours * (VIB_REF / max(vib, 0.05)) ** BASQUIN_EXPONENT)

        if oil is not None:
            oil_sum, oil_n = oil_sum + oil, oil_n + 1
            min_oil = min(min_oil, oil)

    hours_hot = hot_seconds / 3600
    damage = run_damage + hours_hot / THERMAL_LIFE_HOURS + FAULT_DAMAGE * faults

    return {
        "flight_hours": round(duration / 3600, 3),
        "mean_cht": round(cht_sum / max(cht_n, 1), 2),
        "max_cht": round(max_cht, 2),
        "mean_vibration": round(vib_sum / max(vib_n, 1), 4),
        "max_vibration": round(max_vib, 4),
        "mean_oil_pressure": round(oil_sum / max(oil_n, 1), 2),
        "min_oil_pressure": round(min_oil, 2),
        "hours_above_cht_limit": round(hours_hot, 4),
        "fault_count_this_flight": faults,
        "fault_type": fault_type,
        "damage_this_flight": round(damage, 6),
    }


def simulate_engine(index, base_seed):

    rng = random.Random(base_seed + index)
    engine_id = f"FLEET_{index + 1:03d}"
    life_multiplier = math.exp(rng.gauss(0, LIFE_SCATTER))
    fault_proneness = rng.uniform(*FAULT_PRONENESS)

    wear, flights = 0.0, []

    while wear < 1.0 and len(flights) < MAX_FLIGHTS:

        flight = simulate_flight(
            wear, seed=(base_seed + index) * 100_000 + len(flights),
            life_multiplier=life_multiplier, fault_proneness=fault_proneness,
        )
        before = wear
        wear = wear + flight["damage_this_flight"]
        flights.append({
            "engine_id": engine_id,
            "flight_num": len(flights) + 1,
            "wear_before": round(before, 6),
            "cumulative_wear": round(wear, 6),
            **flight,
        })

    # End of life = the flight on which wear crossed 1.0
    eol = len(flights)
    for row in flights:
        row["flights_remaining_to_eol"] = eol - row["flight_num"]

    return flights


def main():

    parser = argparse.ArgumentParser(description="Generate the per-flight fleet wear dataset")
    parser.add_argument("--engines", type=int, default=50)
    parser.add_argument("--quick", action="store_true", help="10 engines, for trying things out")
    parser.add_argument("--seed", type=int, default=5000)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    engines = 10 if args.quick else args.engines
    args.data_dir.mkdir(parents=True, exist_ok=True)
    out = args.data_dir / "fleet_flights.csv"
    started = time.time()
    lives = []

    with open(out, "w", newline="") as file:

        writer = csv.DictWriter(file, fieldnames=COLUMNS)
        writer.writeheader()

        for i in range(engines):
            flights = simulate_engine(i, args.seed)
            writer.writerows(flights)
            lives.append(len(flights))
            print(f"\r{i + 1}/{engines} engines, last one lasted {len(flights)} flights", end="", flush=True)

    lives.sort()
    print(f"\n{out.name}: {sum(lives)} flights from {engines} engines;"
          f" life min {lives[0]} / median {lives[len(lives) // 2]} / max {lives[-1]} flights"
          f"  [{time.time() - started:.0f}s]")

    with open(args.data_dir / "fleet_info.json", "w") as file:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "engines": engines, "seed": args.seed, "flights": sum(lives),
            "life_flights": {"min": lives[0], "median": lives[len(lives) // 2], "max": lives[-1]},
        }, file, indent=2)


if __name__ == "__main__":
    main()
