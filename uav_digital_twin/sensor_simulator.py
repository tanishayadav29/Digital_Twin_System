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
#
# This simulator generates realistic-looking UAV engine telemetry
# for the Digital Twin project.
#
# Main components:
#   1. Flight phases
#   2. Thermal lag
#   3. Sensor measurement noise
#   4. Fault development / recovery
#   5. Long-term wear shift
#   6. Physics-informed derived features
#   7. FastAPI telemetry output
#   8. Optional CSV logging
#
# IMPORTANT:
# The physics calculations below are used as consistency / residual
# features. They do NOT overwrite the 10 original sensor readings.
# This keeps the ML training data compatible with the existing model.
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

PHASES = {
    "TAKEOFF": {"rpm": 3100, "cooling": 0},
    "CLIMB": {"rpm": 2950, "cooling": 4},
    "CRUISE": {"rpm": 2800, "cooling": 0},
    "LOITER": {"rpm": 2650, "cooling": 1},
    "DESCENT": {"rpm": 2450, "cooling": -4}
}

MISSION_START = [
    ("TAKEOFF", 60),
    ("CLIMB", 240)
]

MISSION_LOOP = [
    ("CRUISE", 600),
    ("LOITER", 420),
    ("DESCENT", 120),
    ("LOITER", 300),
    ("CLIMB", 180)
]


# ============================================================
# SENSOR NOISE
# ============================================================

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
# FAULT DEFINITIONS
# ============================================================

FAULTS = {
    "OVERHEATING": {
        "cause": "Cooling airflow blocked - engine temperatures climb",
        "effects": {
            "cht": 55,
            "egt": 70,
            "oil_temperature": 22,
            "oil_pressure": -4
        }
    },

    "LUBRICATION_ISSUE": {
        "cause": "Oil pump wear / oil leak - oil pressure falls",
        "effects": {
            "oil_pressure": -22,
            "oil_temperature": 12,
            "vibration": 0.12,
            "cht": 4
        }
    },

    "MISFIRE": {
        "cause": "Fouled spark plug - one cylinder stops firing",
        "effects": {
            "rpm": -300,
            "egt": -90,
            "vibration": 0.6
        }
    },

    "ABNORMAL_VIBRATION": {
        "cause": "Propeller imbalance - vibration grows",
        "effects": {
            "vibration": 0.8
        }
    },

    "INJECTOR_ABNORMALITY": {
        "cause": "Leaking injector - too much fuel, timing off",
        "effects": {
            "fuel_flow": 5.5,
            "injection_timing": 2.4,
            "egt": -40,
            "cht": -4,
            "rpm": -60
        }
    },

    "COMBUSTION_INSTABILITY": {
        "cause": "Lean mixture - unstable combustion",
        "effects": {
            "rpm": -150,
            "egt": -100,
            "vibration": 0.4
        }
    },

    "ELECTRICAL_FAULT": {
        "cause": "Alternator failing - battery draining",
        "effects": {
            "alternator_current": -5.2,
            "battery_voltage": -2.6
        }
    },

    "SENSOR_DRIFT_FAILURE": {
        "cause": "CHT thermocouple degrading - reads low, then drops out",
        "effects": {}
    }
}


# ============================================================
# LONG-TERM WEAR
# ============================================================
#
# These are design assumptions for simulation, not measured
# engine-specific values.
#
# At cumulative_wear = 1.0:
#   CHT shifts upward
#   oil pressure shifts downward
#   vibration shifts upward
#
# Default wear = 0, so the original healthy baseline is preserved.
# ============================================================

WEAR_SHIFT = {
    "cht": 15.0,
    "oil_pressure": -8.0,
    "vibration": 0.25
}


# ============================================================
# FAULT EPISODE TIMING
# ============================================================

FAULT_RAMP = (150, 240)
FAULT_HOLD = (60, 120)
FAULT_RECOVERY = (45, 90)
FAULT_GAP = (180, 360)


# ============================================================
# HELPERS
# ============================================================

def lag(current, target, tau, dt):
    """
    First-order response.

    The sensor/engine state moves gradually toward the target
    instead of changing instantly.
    """

    if current is None:
        return target

    return current + (target - current) * (
        1 - math.exp(-dt / tau)
    )


# ============================================================
# PHYSICS-INFORMED FEATURES
# ============================================================

def physics_features(
    reading,
    ambient=0.0,
    cooling=0.0,
    vibration_history=None
):
    """
    Calculate physics-informed derived values.

    IMPORTANT:
    These values are NOT used to replace the original 10 sensors.

    They are consistency features / residuals that can later be
    used by the hybrid physics + ML layer.

    Available sensor set does not contain:
        - torque
        - air mass flow

    Therefore:
        - exact engine power is NOT calculated
        - exact AFR is NOT calculated

    Instead, normalized proxies are used.
    """

    vibration_history = vibration_history or []

    rpm = reading.get("rpm")
    cht = reading.get("cht")
    fuel_flow = reading.get("fuel_flow")
    voltage = reading.get("battery_voltage")
    current = reading.get("alternator_current")

    # --------------------------------------------------------
    # 1. RPM -> normalized power proxy
    # --------------------------------------------------------
    #
    # Exact:
    #   P = 2*pi*N*T/60
    #
    # Torque is not one of the available sensors, so we cannot
    # calculate exact power.
    #
    # Instead:
    #   normalized_power_proxy = RPM / reference_RPM

    reference_rpm = 2800.0

    if rpm is not None:
        power_proxy = rpm / reference_rpm
    else:
        power_proxy = 0.0


    # --------------------------------------------------------
    # 2. Newton cooling relation
    # --------------------------------------------------------
    #
    # Q = h*A*(Ts - T_inf)
    #
    # Exact h and A are not measured in the simulator.
    # We therefore use a normalized hA coefficient.
    #
    # This is a physics-informed thermal consistency quantity,
    # not an absolute heat-transfer measurement.

    if cht is not None:
        hA = 1.0
        heat_loss_proxy = hA * (cht - ambient)
    else:
        heat_loss_proxy = 0.0


    # --------------------------------------------------------
    # 3. Fuel-flow / AFR proxy
    # --------------------------------------------------------
    #
    # Exact AFR:
    #   AFR = air_mass_flow / fuel_mass_flow
    #
    # No air-mass-flow sensor exists in the 10-parameter set.
    # RPM is therefore used as a normalized air-flow proxy.

    if rpm is not None:
        estimated_air_flow_proxy = max(
            rpm / reference_rpm,
            0.01
        )
    else:
        estimated_air_flow_proxy = 0.0

    if fuel_flow is not None and fuel_flow > 0:
        afr_proxy = (
            estimated_air_flow_proxy / fuel_flow
        )
    else:
        afr_proxy = 0.0


    # --------------------------------------------------------
    # 4. Vibration RMS
    # --------------------------------------------------------
    #
    # RMS = sqrt(mean(x^2))
    #
    # This is calculated from the latest vibration history.

    if vibration_history:
        vibration_rms = math.sqrt(
            sum(v * v for v in vibration_history)
            / len(vibration_history)
        )
    else:
        vibration_rms = 0.0


    # --------------------------------------------------------
    # 5. Electrical consistency using Ohm's law
    # --------------------------------------------------------
    #
    # V = I*R
    #
    # A simplified assumed resistance is used because actual
    # circuit resistance is not a sensor in this simulator.

    assumed_resistance = 3.0

    if voltage is not None:
        expected_current = (
            voltage / assumed_resistance
        )
    else:
        expected_current = 0.0

    if current is not None:
        current_residual = (
            current - expected_current
        )
    else:
        current_residual = 0.0


    # --------------------------------------------------------
    # 6. RPM-temperature consistency
    # --------------------------------------------------------
    #
    # Simple simulator-specific expected CHT relationship:
    #
    # expected CHT = 185 + 5*RPM deviation + cooling
    #
    # This captures the relationship already used by the
    # simulator itself and creates a useful residual.

    if rpm is not None and cht is not None:
        rpm_relative = (rpm - 2800.0) / 100.0

        expected_cht = (
            185.0
            + 5.0 * rpm_relative
            + cooling
            + 0.8 * ambient
        )

        cht_residual = cht - expected_cht

    else:
        expected_cht = 0.0
        cht_residual = 0.0


    return {
        "power_proxy": round(power_proxy, 6),
        "heat_loss_proxy": round(heat_loss_proxy, 6),
        "afr_proxy": round(afr_proxy, 6),
        "vibration_rms": round(vibration_rms, 6),
        "expected_current": round(expected_current, 6),
        "current_residual": round(current_residual, 6),
        "expected_cht": round(expected_cht, 6),
        "cht_residual": round(cht_residual, 6)
    }


# ============================================================
# FAULT EPISODE
# ============================================================

class FaultEpisode:

    def __init__(self, fault, start, rng):

        self.fault = fault
        self.start = start

        self.ramp = rng.uniform(*FAULT_RAMP)
        self.hold = rng.uniform(*FAULT_HOLD)
        self.recovery = rng.uniform(*FAULT_RECOVERY)


    def progress(self, now):

        elapsed = now - self.start

        # ----------------------------------------------------
        # DEVELOPING
        # ----------------------------------------------------

        if elapsed < self.ramp:

            severity = (
                elapsed / self.ramp
            ) ** 1.5

            return "DEVELOPING", severity


        elapsed -= self.ramp


        # ----------------------------------------------------
        # ACTIVE
        # ----------------------------------------------------

        if elapsed < self.hold:

            return "ACTIVE", 1.0


        elapsed -= self.hold


        # ----------------------------------------------------
        # RECOVERING
        # ----------------------------------------------------

        if elapsed < self.recovery:

            severity = (
                1 - elapsed / self.recovery
            )

            return "RECOVERING", severity


        return None, 0.0


# ============================================================
# ENGINE SIMULATOR
# ============================================================

class EngineSimulator:

    def __init__(
        self,
        profile="cruise",
        fault_types=None,
        faults_enabled=True,
        fault_after=120,
        seed=None,
        noise_scale=1.0,
        cumulative_wear=0.0
    ):

        self.rng = random.Random(seed)

        # ----------------------------------------------------
        # Configuration
        # ----------------------------------------------------

        self.cumulative_wear = cumulative_wear
        self.profile = profile
        self.fault_types = (
            fault_types
            or list(FAULTS)
        )

        self.faults_enabled = faults_enabled
        self.noise_scale = noise_scale


        # ----------------------------------------------------
        # Time
        # ----------------------------------------------------

        self.time = 0.0
        self.mission_clock = 0.0

        self.episode = None
        self.next_fault_at = fault_after


        # ----------------------------------------------------
        # Slowly changing environmental / operating effects
        # ----------------------------------------------------

        self.ambient = 0.0
        self.load = 0.0
        self.rpm_wander = 0.0


        # ----------------------------------------------------
        # Lagged engine states
        # ----------------------------------------------------

        self.rpm = PHASES[
            self.phase()
        ]["rpm"]

        self.cht = None
        self.oil_temperature = None


        # ----------------------------------------------------
        # Vibration history for RMS calculation
        # ----------------------------------------------------

        self.vibration_history = []


    # ========================================================
    # FLIGHT PHASE
    # ========================================================

    def phase(self):

        if self.profile == "cruise":
            return "CRUISE"


        t = self.mission_clock


        # Mission start
        for name, duration in MISSION_START:

            if t < duration:
                return name

            t -= duration


        # Mission loop
        loop_duration = sum(
            duration
            for _, duration in MISSION_LOOP
        )

        t %= loop_duration


        for name, duration in MISSION_LOOP:

            if t < duration:
                return name

            t -= duration


        return "CRUISE"


    # ========================================================
    # RANDOM WALK / SLOW VARIATION
    # ========================================================

    def _wander(
        self,
        current,
        sd,
        tau,
        dt
    ):

        # Generate a small random target
        target = current + self.rng.gauss(0, sd)

        # Smoothly move toward it
        return lag(
            current,
            target,
            tau,
            dt
        )


    # ========================================================
    # ONE SIMULATION STEP
    # ========================================================

    def step(self, dt=1.0):

        # ----------------------------------------------------
        # 1. Time
        # ----------------------------------------------------

        self.time += dt


        # During an active fault episode, the mission phase
        # schedule is paused.

        if self.episode is None:
            self.mission_clock += dt


        phase = self.phase()
        spec = PHASES[phase]


        # ----------------------------------------------------
        # 2. Fault state
        # ----------------------------------------------------

        fault, stage, severity = (
            self._update_fault(phase)
        )

        fx = self._fault_effects(
            fault,
            severity
        )


        # ----------------------------------------------------
        # 3. Slowly changing operating conditions
        # ----------------------------------------------------

        self.ambient = self._wander(
            self.ambient,
            sd=1.0,
            tau=400,
            dt=dt
        )

        self.load = self._wander(
            self.load,
            sd=0.3,
            tau=120,
            dt=dt
        )

        self.rpm_wander = self._wander(
            self.rpm_wander,
            sd=10,
            tau=30,
            dt=dt
        )


        # ----------------------------------------------------
        # 4. Healthy engine relationships
        # ----------------------------------------------------

        self.rpm = lag(
            self.rpm,
            spec["rpm"] + self.rpm_wander,
            6,
            dt
        )


        # RPM deviation from cruise reference
        r = (
            self.rpm - 2800
        ) / 100.0

        ambient = self.ambient
        wear = self.cumulative_wear


        # ----------------------------------------------------
        # Cylinder Head Temperature
        # ----------------------------------------------------

        self.cht = lag(
            self.cht,
            (
                185
                + 5 * r
                + spec["cooling"]
                + 0.8 * ambient
                + fx["cht"]
                + WEAR_SHIFT["cht"] * wear
            ),
            60,
            dt
        )


        # ----------------------------------------------------
        # Oil Temperature
        # ----------------------------------------------------

        self.oil_temperature = lag(
            self.oil_temperature,
            (
                90
                + 1.5 * r
                + 0.5 * ambient
                + fx["oil_temperature"]
            ),
            150,
            dt
        )


        # ----------------------------------------------------
        # 5. Actual physical engine state
        # ----------------------------------------------------

        actual = {

            "rpm":
                self.rpm
                + fx["rpm"],

            "cht":
                self.cht,

            "egt":
                720
                + 12 * r
                + 2 * ambient
                + fx["egt"],

            "oil_pressure":
                (
                    45
                    + 1.2 * r
                    - 0.25 * (
                        self.oil_temperature - 90
                    )
                    + fx["oil_pressure"]
                    + WEAR_SHIFT["oil_pressure"]
                    * wear
                ),

            "oil_temperature":
                self.oil_temperature,

            "fuel_flow":
                12
                + 0.9 * r
                + fx["fuel_flow"],

            "vibration":
                (
                    0.30
                    + 0.025 * r
                    + fx["vibration"]
                    + WEAR_SHIFT["vibration"]
                    * wear
                ),

            "battery_voltage":
                (
                    24.5
                    + 0.1 * self.load
                    + fx["battery_voltage"]
                ),

            "alternator_current":
                (
                    8
                    + 0.15 * r
                    + self.load
                    + fx["alternator_current"]
                ),

            "injection_timing":
                (
                    12
                    + 0.15 * r
                    + fx["injection_timing"]
                )
        }


        # ----------------------------------------------------
        # 6. Sensor readings = actual + measurement noise
        # ----------------------------------------------------

        reading = {

            key: round(
                value
                + self.rng.gauss(
                    0,
                    NOISE[key]
                    * self.noise_scale
                ),
                3
            )

            for key, value in actual.items()
        }


        # ----------------------------------------------------
        # 7. Sensor drift / failure
        # ----------------------------------------------------

        if fault == "SENSOR_DRIFT_FAILURE":

            # Engine itself remains normal.
            # Only the CHT sensor starts drifting.

            reading["cht"] = round(
                reading["cht"]
                - 90 * severity,
                3
            )


            dropout_chance = (
                0.7
                if stage == "ACTIVE"
                else 0.2
                if severity > 0.85
                else 0.0
            )


            if (
                self.rng.random()
                < dropout_chance
            ):

                reading["cht"] = None


        # ----------------------------------------------------
        # 8. Vibration history
        # ----------------------------------------------------

        if reading["vibration"] is not None:

            self.vibration_history.append(
                reading["vibration"]
            )


        # Keep only the latest 10 readings
        if len(self.vibration_history) > 10:

            self.vibration_history.pop(0)


        # ----------------------------------------------------
        # 9. Physics-informed features
        # ----------------------------------------------------
        #
        # These are derived AFTER sensor faults/noise so that
        # sensor anomalies can appear as physics residuals.
        # ----------------------------------------------------

        physics = physics_features(
            reading=reading,
            ambient=self.ambient,
            cooling=spec["cooling"],
            vibration_history=self.vibration_history
        )


        # ----------------------------------------------------
        # 10. Ground truth
        # ----------------------------------------------------

        truth = {

            "phase":
                phase,

            "fault":
                fault,

            "stage":
                stage,

            "severity":
                round(
                    severity,
                    3
                )
        }


        return reading, truth, physics


    # ========================================================
    # FAULT EPISODE UPDATE
    # ========================================================

    def _update_fault(self, phase):

        if self.episode is None:

            # New fault only begins during steady flight.

            if (
                self.faults_enabled
                and self.time >= self.next_fault_at
                and phase in (
                    "CRUISE",
                    "LOITER"
                )
            ):

                self.episode = FaultEpisode(
                    self.rng.choice(
                        self.fault_types
                    ),
                    self.time,
                    self.rng
                )

            else:

                return None, None, 0.0


        stage, severity = (
            self.episode.progress(
                self.time
            )
        )


        # Episode finished
        if stage is None:

            self.episode = None

            self.next_fault_at = (
                self.time
                + self.rng.uniform(
                    *FAULT_GAP
                )
            )

            return None, None, 0.0


        return (
            self.episode.fault,
            stage,
            severity
        )


    # ========================================================
    # FAULT SENSOR EFFECTS
    # ========================================================

    def _fault_effects(
        self,
        fault,
        severity
    ):

        fx = dict.fromkeys(
            SENSOR_KEYS,
            0.0
        )


        if fault is None:
            return fx


        # Base fault effects
        for key, peak in FAULTS[
            fault
        ]["effects"].items():

            fx[key] = (
                peak * severity
            )


        rng = self.rng
        s = severity
        t = self.time


        # ----------------------------------------------------
        # Misfire
        # ----------------------------------------------------

        if fault == "MISFIRE":

            if rng.random() < (
                0.15 + 0.5 * s
            ):

                fx["vibration"] += (
                    rng.uniform(
                        0.1,
                        0.4
                    ) * s
                )

                fx["rpm"] -= (
                    rng.uniform(
                        50,
                        150
                    ) * s
                )


        # ----------------------------------------------------
        # Combustion instability
        # ----------------------------------------------------

        elif fault == "COMBUSTION_INSTABILITY":

            fx["egt"] += (
                25
                * s
                * math.sin(
                    2
                    * math.pi
                    * t
                    / 7
                )
            )

            fx["rpm"] += (
                40
                * s
                * math.sin(
                    2
                    * math.pi
                    * t
                    / 5
                )
            )

            fx["vibration"] += (
                0.03
                * s
                * abs(
                    rng.gauss(
                        0,
                        1
                    )
                )
            )


        # ----------------------------------------------------
        # Abnormal vibration
        # ----------------------------------------------------

        elif fault == "ABNORMAL_VIBRATION":

            fx["rpm"] += (
                20
                * s
                * math.sin(
                    2
                    * math.pi
                    * t
                    / 3
                )
            )


        # ----------------------------------------------------
        # Electrical fault
        # ----------------------------------------------------

        elif fault == "ELECTRICAL_FAULT":

            fx["alternator_current"] += (
                rng.gauss(
                    0,
                    0.4 * s
                )
            )


        return fx


# ============================================================
# BACKEND
# ============================================================

def send_reading(
    session,
    url,
    engine_id,
    timestamp,
    reading
):

    # Only the original 10 sensor parameters are sent to the
    # existing FastAPI endpoint. This preserves compatibility
    # with the current backend/database/ML pipeline.

    data = {
        "engine_id": engine_id,
        "timestamp": timestamp.isoformat(),
        **reading
    }


    try:

        response = session.post(
            url,
            json=data,
            timeout=5
        )

        body = response.json()


    except Exception as e:

        print(
            "Error sending telemetry:",
            e
        )

        return {}


    if "error" in body:

        print(
            "Backend error:",
            body["error"]
        )


    return body.get(
        "fault"
    ) or {}


# ============================================================
# OUTPUT HELPERS
# ============================================================

def fmt(value, decimals):

    if value is None:
        return "--"

    return f"{value:.{decimals}f}"


def describe_truth(truth):

    if truth["fault"] is None:
        return "healthy"

    return (
        f"{truth['fault']} "
        f"{truth['stage'].lower()} "
        f"{truth['severity']:.0%}"
    )


# ============================================================
# COMMAND-LINE ARGUMENTS
# ============================================================

def parse_args():

    parser = argparse.ArgumentParser(
        description="UAV engine sensor simulator"
    )


    parser.add_argument(
        "--profile",
        choices=[
            "cruise",
            "mission"
        ],
        default="cruise",
        help=(
            "cruise = steady cruise; "
            "mission = takeoff, climb, cruise, "
            "loiter, descent"
        )
    )


    parser.add_argument(
        "--fault",
        action="append",
        type=str.upper,
        choices=list(FAULTS),
        metavar="NAME",
        help=(
            "only simulate this fault; "
            "repeat for more"
        )
    )


    parser.add_argument(
        "--no-faults",
        action="store_true",
        help="healthy engine only"
    )


    parser.add_argument(
        "--noise-scale",
        type=float,
        default=1.0,
        help=(
            "multiply sensor measurement noise"
        )
    )


    parser.add_argument(
        "--fault-after",
        type=float,
        default=120,
        help=(
            "simulated seconds before first fault"
        )
    )


    parser.add_argument(
        "--speed",
        type=float,
        default=1.0,
        help=(
            "simulated seconds per reading"
        )
    )


    parser.add_argument(
        "--offline",
        action="store_true",
        help=(
            "do not call backend; "
            "generate data locally"
        )
    )


    parser.add_argument(
        "--duration",
        type=float,
        help=(
            "stop after this many simulated seconds"
        )
    )


    parser.add_argument(
        "--log",
        metavar="FILE",
        help=(
            "write readings and ground truth "
            "to CSV"
        )
    )


    parser.add_argument(
        "--seed",
        type=int,
        help=(
            "random seed for repeatable run"
        )
    )


    parser.add_argument(
        "--url",
        default=API_URL,
        help=(
            f"backend endpoint "
            f"(default {API_URL})"
        )
    )


    parser.add_argument(
        "--engine-id",
        default=ENGINE_ID
    )


    args = parser.parse_args()


    if args.offline and (
        args.duration is None
        or args.log is None
    ):

        parser.error(
            "--offline needs "
            "--duration and --log"
        )


    return args


# ============================================================
# MAIN LOOP
# ============================================================

def main():

    args = parse_args()


    sim = EngineSimulator(

        profile=args.profile,

        fault_types=args.fault,

        faults_enabled=(
            not args.no_faults
        ),

        fault_after=args.fault_after,

        seed=args.seed,

        noise_scale=args.noise_scale
    )


    session = (
        None
        if args.offline
        else requests.Session()
    )


    log_file = (
        open(
            args.log,
            "w",
            newline=""
        )
        if args.log
        else None
    )


    writer = (
        csv.writer(log_file)
        if log_file
        else None
    )


    # --------------------------------------------------------
    # CSV HEADER
    # --------------------------------------------------------

    if writer:

        writer.writerow([

            "timestamp",
            "sim_time",

            *SENSOR_KEYS,

            "phase",
            "true_fault",
            "fault_stage",
            "fault_severity",

            # Physics-informed derived values
            "power_proxy",
            "heat_loss_proxy",
            "afr_proxy",
            "vibration_rms",
            "expected_current",
            "current_residual",
            "expected_cht",
            "cht_residual",

            # Backend ML output
            "ml_status",
            "ml_fault_type",
            "ml_model_prediction",
            "ml_anomaly_score"
        ])


    print(
        f"Simulating {args.engine_id} | "
        f"profile: {args.profile} | "
        f"faults: "
        f"{'off' if args.no_faults else ', '.join(sim.fault_types)} | "
        f"first fault after "
        f"{args.fault_after:g}s | "
        f"speed x{args.speed:g}"
    )


    start = datetime.now(
        timezone.utc
    )

    next_tick = time.monotonic()

    counter = 0
    last_fault = None


    try:

        while (
            args.duration is None
            or sim.time < args.duration
        ):

            counter += 1


            # ------------------------------------------------
            # Generate one reading
            # ------------------------------------------------

            reading, truth, physics = (
                sim.step(args.speed)
            )


            # ------------------------------------------------
            # Timestamp
            # ------------------------------------------------

            if args.offline:

                timestamp = (
                    start
                    + timedelta(
                        seconds=sim.time
                    )
                )

                ml = {}

            else:

                timestamp = (
                    datetime.now(
                        timezone.utc
                    )
                )

                ml = send_reading(
                    session,
                    args.url,
                    args.engine_id,
                    timestamp,
                    reading
                )


            # ------------------------------------------------
            # Fault episode messages
            # ------------------------------------------------

            if truth["fault"] != last_fault:

                if truth["fault"]:

                    print(
                        "\n>>> FAULT EPISODE STARTED: "
                        f"{truth['fault']} - "
                        f"{FAULTS[truth['fault']]['cause']}\n"
                    )

                else:

                    print(
                        "\n>>> FAULT EPISODE OVER: "
                        "engine healthy again\n"
                    )

                last_fault = truth["fault"]


            # ------------------------------------------------
            # Terminal output
            # ------------------------------------------------

            if not args.offline:

                ml_label = (
                    ml.get("fault_type")
                    or ml.get(
                        "status",
                        "-"
                    )
                )

                print(

                    f"{counter:05d} | "
                    f"{truth['phase']:7s} | "

                    f"Truth: "
                    f"{describe_truth(truth):38s} | "

                    f"ML: "
                    f"{ml_label:22s} | "

                    f"RPM "
                    f"{fmt(reading['rpm'], 0)} "

                    f"CHT "
                    f"{fmt(reading['cht'], 1)} "

                    f"EGT "
                    f"{fmt(reading['egt'], 0)} "

                    f"OilP "
                    f"{fmt(reading['oil_pressure'], 1)} "

                    f"OilT "
                    f"{fmt(reading['oil_temperature'], 1)} "

                    f"Fuel "
                    f"{fmt(reading['fuel_flow'], 1)} "

                    f"Vib "
                    f"{fmt(reading['vibration'], 2)} "

                    f"Alt "
                    f"{fmt(reading['alternator_current'], 1)}"
                )


            # ------------------------------------------------
            # CSV output
            # ------------------------------------------------

            if writer:

                writer.writerow([

                    timestamp.isoformat(),

                    round(
                        sim.time,
                        1
                    ),

                    *[
                        ""
                        if reading[key] is None
                        else reading[key]
                        for key in SENSOR_KEYS
                    ],

                    truth["phase"],

                    truth["fault"] or "",

                    truth["stage"] or "",

                    truth["severity"],

                    # Physics features
                    physics[
                        "power_proxy"
                    ],

                    physics[
                        "heat_loss_proxy"
                    ],

                    physics[
                        "afr_proxy"
                    ],

                    physics[
                        "vibration_rms"
                    ],

                    physics[
                        "expected_current"
                    ],

                    physics[
                        "current_residual"
                    ],

                    physics[
                        "expected_cht"
                    ],

                    physics[
                        "cht_residual"
                    ],

                    # ML output
                    ml.get(
                        "status",
                        ""
                    ),

                    ml.get(
                        "fault_type",
                        ""
                    ),

                    ml.get(
                        "model_prediction",
                        ""
                    ),

                    ml.get(
                        "anomaly_score",
                        ""
                    )
                ])


            # ------------------------------------------------
            # Real-time pacing
            # ------------------------------------------------

            if not args.offline:

                # One reading approximately every second.
                # args.speed controls simulated seconds per reading.

                next_tick = max(
                    next_tick + 1.0,
                    time.monotonic()
                )

                time.sleep(
                    max(
                        0.0,
                        next_tick
                        - time.monotonic()
                    )
                )


    except KeyboardInterrupt:

        pass


    finally:

        if log_file:

            log_file.close()

            print(
                f"Wrote {counter} readings "
                f"to {args.log}"
            )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()
