import argparse
import csv
import math
import random
import time
from datetime import datetime, timedelta, timezone

import requests


# ============================================================
# UAV ENGINE SENSOR SIMULATOR
# ============================================================
# Ye simulator ek chalte hue engine ki tarah behave karta hai:
#
# 1. FLIGHT PHASES  - takeoff, climb, cruise, loiter, descent.
#                     RPM phase ke hisaab se badalta hai aur baaki
#                     sensors (fuel flow, EGT, CHT ...) RPM ke saath
#                     move karte hain.
# 2. THERMAL LAG    - CHT aur oil temperature dheere-dheere badalte
#                     hain, turant nahi.
# 3. FAULT EPISODES - fault minutes mein develop hota hai:
#                     DEVELOPING -> ACTIVE -> RECOVERING.
#                     Ek time par ek hi fault.
#
# Backend ko sirf sensor readings jaati hain. Asli fault (ground
# truth) sirf terminal aur --log CSV mein hai, taaki detector ko
# evaluate kiya ja sake.
#
# USAGE (uav_digital_twin folder se):
#
#   python sensor_simulator.py                         steady cruise, random fault episodes
#   python sensor_simulator.py --profile mission       takeoff, climb, cruise, loiter, descent
#   python sensor_simulator.py --fault overheating     sirf ye fault (flag repeat kar sakte ho)
#   python sensor_simulator.py --fault-after 30 --speed 5
#                                                      pehla fault jaldi, 5x fast
#   python sensor_simulator.py --no-faults             sirf healthy engine
#   python sensor_simulator.py --log run.csv           readings + ground truth CSV mein bhi
#   python sensor_simulator.py --offline --duration 7200 --no-faults --log normal.csv
#                                                      2 ghante ka data turant, backend ke bina
#
# NOTE: frontend/src/lib/simulator.js iska browser copy hai -
# yahan kuch badlo toh wahan bhi same change karo.
# ============================================================


API_URL = "http://127.0.0.1:8000/sensor-data"

ENGINE_ID = "ENGINE_001"

SENSOR_KEYS = [
    "rpm",
    "cht",
    "egt",
    "oil_pressure",
    "oil_temperature",
    "fuel_flow",
    "vibration",
    "battery_voltage",
    "alternator_current",
    "injection_timing"
]


# ============================================================
# FLIGHT PHASES
# ============================================================
# rpm     = governor jis RPM ko hold karta hai
# cooling = CHT par airspeed ka asar (climb = slow + high power
#           = garam, descent = kam power + tez hawa = thanda)
#
# Cruise ki values purane simulator ki base values hain
# (RPM 2800, CHT 185, EGT 720 ...) jin par ML model train hua hai.
# ============================================================

PHASES = {
    "TAKEOFF": {"rpm": 3100, "cooling": 0},
    "CLIMB": {"rpm": 2950, "cooling": 4},
    "CRUISE": {"rpm": 2800, "cooling": 0},
    "LOITER": {"rpm": 2650, "cooling": 1},
    "DESCENT": {"rpm": 2450, "cooling": -4}
}

# Mission profile: takeoff + climb ek baar, phir ye loop chalta
# rehta hai (MALE UAV zyada time cruise / loiter mein rehta hai).
# (phase, seconds)
MISSION_START = [("TAKEOFF", 60), ("CLIMB", 240)]
MISSION_LOOP = [("CRUISE", 600), ("LOITER", 420), ("DESCENT", 120), ("LOITER", 300), ("CLIMB", 180)]


# ============================================================
# SENSOR NOISE
# ============================================================
# Har reading par measurement noise (standard deviation).
# --noise-scale se multiply hota hai (real sensors zyada noisy
# ho sakte hain - detector ko usse test karne ke liye).

NOISE = {
    "rpm": 12,
    "cht": 0.6,
    "egt": 3.0,
    "oil_pressure": 0.6,
    "oil_temperature": 0.4,
    "fuel_flow": 0.12,
    "vibration": 0.015,
    "battery_voltage": 0.08,
    "alternator_current": 0.15,
    "injection_timing": 0.1
}


# ============================================================
# FAULTS
# ============================================================
# effects = full severity par sensor kitna shift hota hai.
# Severity 0 -> 1 badhne ke saath effect bhi badhta hai, isliye
# detector ki threshold beech mein (~60-80% severity par) cross
# hoti hai. Usse pehle sensors trend karte dikhte hain - yahi
# early warning ka mauka hai.
#
# Kuch faults ka extra behaviour _fault_effects() mein hai
# (misfire jhatke, combustion oscillation, sensor dropout).
# ============================================================

FAULTS = {
    "OVERHEATING": {
        "cause": "Cooling airflow blocked - engine temperatures climb",
        "effects": {"cht": 55, "egt": 70, "oil_temperature": 22, "oil_pressure": -4}
    },
    "LUBRICATION_ISSUE": {
        "cause": "Oil pump wear / oil leak - oil pressure falls",
        "effects": {"oil_pressure": -22, "oil_temperature": 12, "vibration": 0.12, "cht": 4}
    },
    "MISFIRE": {
        "cause": "Fouled spark plug - one cylinder stops firing",
        "effects": {"rpm": -300, "egt": -90, "vibration": 0.6}
    },
    "ABNORMAL_VIBRATION": {
        "cause": "Propeller imbalance - vibration grows",
        "effects": {"vibration": 0.8}
    },
    "INJECTOR_ABNORMALITY": {
        "cause": "Leaking injector - too much fuel, timing off",
        "effects": {"fuel_flow": 5.5, "injection_timing": 2.4, "egt": -40, "cht": -4, "rpm": -60}
    },
    "COMBUSTION_INSTABILITY": {
        "cause": "Lean mixture - unstable combustion",
        "effects": {"rpm": -150, "egt": -100, "vibration": 0.4}
    },
    "ELECTRICAL_FAULT": {
        "cause": "Alternator failing - battery draining",
        "effects": {"alternator_current": -5.2, "battery_voltage": -2.6}
    },
    "SENSOR_DRIFT_FAILURE": {
        "cause": "CHT thermocouple degrading - reads low, then drops out",
        "effects": {}
    }
}

# Episode timing (simulated seconds): (min, max)
FAULT_RAMP = (150, 240)       # DEVELOPING: pehle symptom se full severity tak
FAULT_HOLD = (60, 120)        # ACTIVE: full severity
FAULT_RECOVERY = (45, 90)     # RECOVERING: wapas normal
FAULT_GAP = (180, 360)        # do episodes ke beech healthy time


# ============================================================
# HELPERS
# ============================================================

def lag(current, target, tau, dt):

    # First-order lag: value target ki taraf time constant tau
    # (seconds) ke saath badhti hai. Pehli reading par seedha target.
    if current is None:
        return target

    return current + (target - current) * (1 - math.exp(-dt / tau))


class FaultEpisode:

    def __init__(self, fault, start, rng):

        self.fault = fault
        self.start = start
        self.ramp = rng.uniform(*FAULT_RAMP)
        self.hold = rng.uniform(*FAULT_HOLD)
        self.recovery = rng.uniform(*FAULT_RECOVERY)

    def progress(self, now):

        # Returns (stage, severity 0-1), ya (None, 0) jab episode khatam
        elapsed = now - self.start

        if elapsed < self.ramp:
            # Degradation shuru mein dheere, phir tez hoti hai
            return "DEVELOPING", (elapsed / self.ramp) ** 1.5

        elapsed -= self.ramp

        if elapsed < self.hold:
            return "ACTIVE", 1.0

        elapsed -= self.hold

        if elapsed < self.recovery:
            return "RECOVERING", 1 - elapsed / self.recovery

        return None, 0.0


# ============================================================
# ENGINE SIMULATOR
# ============================================================

class EngineSimulator:

    def __init__(self, profile="cruise", fault_types=None, faults_enabled=True, fault_after=120, seed=None, noise_scale=1.0):

        self.rng = random.Random(seed)
        self.profile = profile
        self.fault_types = fault_types or list(FAULTS)
        self.faults_enabled = faults_enabled
        self.noise_scale = noise_scale

        self.time = 0.0             # simulated seconds
        self.mission_clock = 0.0    # phase schedule; fault episode ke dauraan ruka rehta hai
        self.episode = None
        self.next_fault_at = fault_after

        # Dheere badalne wale random effects
        self.ambient = 0.0          # outside air temperature ka asar
        self.load = 0.0             # electrical load
        self.rpm_wander = 0.0       # governor hunting

        # Lagged engine states (engine start par already warm hai)
        self.rpm = PHASES[self.phase()]["rpm"]
        self.cht = None
        self.oil_temperature = None


    def phase(self):

        if self.profile == "cruise":
            return "CRUISE"

        t = self.mission_clock

        for name, duration in MISSION_START:
            if t < duration:
                return name
            t -= duration

        t %= sum(duration for _, duration in MISSION_LOOP)

        for name, duration in MISSION_LOOP:
            if t < duration:
                return name
            t -= duration


    def step(self, dt=1.0):

        # ----------------------------------------------------
        # 1. Time aage badhao
        # ----------------------------------------------------
        # Fault episode ke dauraan phase schedule ruka rehta hai
        # (operator fault handle karte waqt altitude hold karta hai),
        # taaki fault ka signature phase change se mix na ho.

        self.time += dt

        if self.episode is None:
            self.mission_clock += dt

        phase = self.phase()
        spec = PHASES[phase]

        fault, stage, severity = self._update_fault(phase)
        fx = self._fault_effects(fault, severity)


        # ----------------------------------------------------
        # 2. Slow random wander
        # ----------------------------------------------------

        self.ambient = self._wander(self.ambient, sd=1.0, tau=400, dt=dt)
        self.load = self._wander(self.load, sd=0.3, tau=120, dt=dt)
        self.rpm_wander = self._wander(self.rpm_wander, sd=10, tau=30, dt=dt)


        # ----------------------------------------------------
        # 3. Healthy engine relationships
        # ----------------------------------------------------
        # r = cruise (2800) se kitne sau RPM upar / neeche.
        # Zyada RPM -> zyada fuel, garam EGT / CHT / oil,
        # zyada oil pressure. Garam oil patla hota hai isliye
        # oil pressure thoda girta hai.

        self.rpm = lag(self.rpm, spec["rpm"] + self.rpm_wander, 6, dt)

        r = (self.rpm - 2800) / 100
        ambient = self.ambient

        self.cht = lag(
            self.cht,
            185 + 5 * r + spec["cooling"] + 0.8 * ambient + fx["cht"],
            60,
            dt
        )

        self.oil_temperature = lag(
            self.oil_temperature,
            90 + 1.5 * r + 0.5 * ambient + fx["oil_temperature"],
            150,
            dt
        )

        actual = {
            "rpm": self.rpm + fx["rpm"],
            "cht": self.cht,
            "egt": 720 + 12 * r + 2 * ambient + fx["egt"],
            "oil_pressure": 45 + 1.2 * r - 0.25 * (self.oil_temperature - 90) + fx["oil_pressure"],
            "oil_temperature": self.oil_temperature,
            "fuel_flow": 12 + 0.9 * r + fx["fuel_flow"],
            "vibration": 0.30 + 0.025 * r + fx["vibration"],
            "battery_voltage": 24.5 + 0.1 * self.load + fx["battery_voltage"],
            "alternator_current": 8 + 0.15 * r + self.load + fx["alternator_current"],
            "injection_timing": 12 + 0.15 * r + fx["injection_timing"]
        }


        # ----------------------------------------------------
        # 4. Sensor readings = actual value + measurement noise
        # ----------------------------------------------------

        reading = {
            key: round(value + self.rng.gauss(0, NOISE[key] * self.noise_scale), 3)
            for key, value in actual.items()
        }

        if fault == "SENSOR_DRIFT_FAILURE":

            # Engine asal mein normal hai, sirf CHT sensor kharab:
            # reading neeche drift karti hai, phir aana band.
            reading["cht"] = round(reading["cht"] - 90 * severity, 3)

            dropout_chance = 0.7 if stage == "ACTIVE" else 0.2 if severity > 0.85 else 0.0

            if self.rng.random() < dropout_chance:
                reading["cht"] = None

        truth = {
            "phase": phase,
            "fault": fault,
            "stage": stage,
            "severity": round(severity, 3)
        }

        return reading, truth


    def _update_fault(self, phase):

        if self.episode is None:

            # Naya fault sirf steady flight (cruise / loiter) mein shuru hota hai
            if (
                self.faults_enabled
                and self.time >= self.next_fault_at
                and phase in ("CRUISE", "LOITER")
            ):
                self.episode = FaultEpisode(self.rng.choice(self.fault_types), self.time, self.rng)

            else:
                return None, None, 0.0

        stage, severity = self.episode.progress(self.time)

        if stage is None:
            self.episode = None
            self.next_fault_at = self.time + self.rng.uniform(*FAULT_GAP)
            return None, None, 0.0

        return self.episode.fault, stage, severity


    def _fault_effects(self, fault, severity):

        fx = dict.fromkeys(SENSOR_KEYS, 0.0)

        if fault is None:
            return fx

        for key, peak in FAULTS[fault]["effects"].items():
            fx[key] = peak * severity

        rng = self.rng
        s = severity
        t = self.time

        if fault == "MISFIRE":
            # Misfire intermittent hai: kuch readings mein extra jhatka
            if rng.random() < 0.15 + 0.5 * s:
                fx["vibration"] += rng.uniform(0.1, 0.4) * s
                fx["rpm"] -= rng.uniform(50, 150) * s

        elif fault == "COMBUSTION_INSTABILITY":
            # EGT aur RPM oscillate karte hain
            fx["egt"] += 25 * s * math.sin(2 * math.pi * t / 7)
            fx["rpm"] += 40 * s * math.sin(2 * math.pi * t / 5)
            fx["vibration"] += 0.03 * s * abs(rng.gauss(0, 1))

        elif fault == "ABNORMAL_VIBRATION":
            # Imbalance se RPM mein halka wobble
            fx["rpm"] += 20 * s * math.sin(2 * math.pi * t / 3)

        elif fault == "ELECTRICAL_FAULT":
            # Failing alternator ka output flicker karta hai
            fx["alternator_current"] += rng.gauss(0, 0.4 * s)

        return fx


    def _wander(self, value, sd, tau, dt):

        # Mean-reverting random walk (Ornstein-Uhlenbeck) jiska
        # long-run standard deviation = sd
        return value - value * dt / tau + sd * math.sqrt(2 * dt / tau) * self.rng.gauss(0, 1)


# ============================================================
# BACKEND + OUTPUT
# ============================================================

def send_reading(session, url, engine_id, timestamp, reading):

    data = {
        "engine_id": engine_id,
        "timestamp": timestamp.isoformat(),
        **reading
    }

    try:
        response = session.post(url, json=data, timeout=5)
        body = response.json()

    except Exception as e:
        # Agar FastAPI unavailable hai
        print("Error sending telemetry:", e)
        return {}

    if "error" in body:
        print("Backend error:", body["error"])

    # Backend ne ML se kya detect kiya
    return body.get("fault") or {}


def fmt(value, decimals):

    return "--" if value is None else f"{value:.{decimals}f}"


def describe_truth(truth):

    if truth["fault"] is None:
        return "healthy"

    return f"{truth['fault']} {truth['stage'].lower()} {truth['severity']:.0%}"


def parse_args():

    parser = argparse.ArgumentParser(description="UAV engine sensor simulator")

    parser.add_argument(
        "--profile", choices=["cruise", "mission"], default="cruise",
        help="cruise = steady cruise (what the ML model was trained on); "
             "mission = takeoff, climb, cruise, loiter, descent"
    )
    parser.add_argument(
        "--fault", action="append", type=str.upper, choices=list(FAULTS), metavar="NAME",
        help="only simulate this fault; repeat for more. One of: " + ", ".join(FAULTS)
    )
    parser.add_argument("--no-faults", action="store_true", help="healthy engine only")
    parser.add_argument(
        "--noise-scale", type=float, default=1.0,
        help="multiply sensor measurement noise, e.g. 2 for noisier sensors (default 1)"
    )
    parser.add_argument(
        "--fault-after", type=float, default=120,
        help="simulated seconds before the first fault can start (default 120)"
    )
    parser.add_argument(
        "--speed", type=float, default=1.0,
        help="simulated seconds per reading; readings are still sent once a second (default 1)"
    )
    parser.add_argument("--offline", action="store_true", help="don't call the backend, generate data as fast as possible")
    parser.add_argument("--duration", type=float, help="stop after this many simulated seconds")
    parser.add_argument("--log", metavar="FILE", help="also write readings and ground truth to this CSV file")
    parser.add_argument("--seed", type=int, help="random seed for a repeatable run")
    parser.add_argument("--url", default=API_URL, help=f"backend endpoint (default {API_URL})")
    parser.add_argument("--engine-id", default=ENGINE_ID)

    args = parser.parse_args()

    if args.offline and (args.duration is None or args.log is None):
        parser.error("--offline needs --duration and --log")

    return args


# ============================================================
# MAIN LOOP
# ============================================================

def main():

    args = parse_args()

    sim = EngineSimulator(
        profile=args.profile,
        fault_types=args.fault,
        faults_enabled=not args.no_faults,
        fault_after=args.fault_after,
        seed=args.seed,
        noise_scale=args.noise_scale
    )

    session = None if args.offline else requests.Session()

    log_file = open(args.log, "w", newline="") if args.log else None
    writer = csv.writer(log_file) if log_file else None

    if writer:
        writer.writerow([
            "timestamp", "sim_time", *SENSOR_KEYS,
            "phase", "true_fault", "fault_stage", "fault_severity",
            "ml_status", "ml_fault_type", "ml_model_prediction", "ml_anomaly_score"
        ])

    print(
        f"Simulating {args.engine_id} | profile: {args.profile} | "
        f"faults: {'off' if args.no_faults else ', '.join(sim.fault_types)} | "
        f"first fault after {args.fault_after:g}s | speed x{args.speed:g}"
    )

    start = datetime.now(timezone.utc)
    next_tick = time.monotonic()
    counter = 0
    last_fault = None

    try:

        while args.duration is None or sim.time < args.duration:

            counter += 1

            reading, truth = sim.step(args.speed)

            if args.offline:
                timestamp = start + timedelta(seconds=sim.time)
                ml = {}

            else:
                timestamp = datetime.now(timezone.utc)
                ml = send_reading(session, args.url, args.engine_id, timestamp, reading)

                if truth["fault"] != last_fault:
                    if truth["fault"]:
                        print(f"\n>>> FAULT EPISODE STARTED: {truth['fault']} - {FAULTS[truth['fault']]['cause']}\n")
                    else:
                        print(f"\n>>> FAULT EPISODE OVER: engine healthy again\n")
                    last_fault = truth["fault"]

                ml_label = ml.get("fault_type") or ml.get("status", "-")

                # Terminal: asli condition vs ML detection + important readings
                print(
                    f"{counter:05d} | {truth['phase']:7s} | "
                    f"Truth: {describe_truth(truth):38s} | "
                    f"ML: {ml_label:22s} | "
                    f"RPM {fmt(reading['rpm'], 0)} "
                    f"CHT {fmt(reading['cht'], 1)} "
                    f"EGT {fmt(reading['egt'], 0)} "
                    f"OilP {fmt(reading['oil_pressure'], 1)} "
                    f"OilT {fmt(reading['oil_temperature'], 1)} "
                    f"Fuel {fmt(reading['fuel_flow'], 1)} "
                    f"Vib {fmt(reading['vibration'], 2)} "
                    f"Alt {fmt(reading['alternator_current'], 1)}"
                )

            if writer:
                writer.writerow([
                    timestamp.isoformat(), round(sim.time, 1),
                    *["" if reading[key] is None else reading[key] for key in SENSOR_KEYS],
                    truth["phase"], truth["fault"] or "", truth["stage"] or "", truth["severity"],
                    ml.get("status", ""), ml.get("fault_type") or "",
                    ml.get("model_prediction", ""), ml.get("anomaly_score", "")
                ])

            if not args.offline:
                # Har second ek reading (POST ka time minus karke)
                next_tick = max(next_tick + 1.0, time.monotonic())
                time.sleep(max(0.0, next_tick - time.monotonic()))

    except KeyboardInterrupt:
        pass

    finally:
        if log_file:
            log_file.close()
            print(f"Wrote {counter} readings to {args.log}")


if __name__ == "__main__":
    main()
