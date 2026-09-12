import csv
import math
from collections import deque

import numpy as np


# ============================================================
# ENGINE FEATURES (model v2)
# ============================================================
# Model v1 raw sensor values dekhta hai, isliye:
# - har flight phase (climb, loiter ...) usko anomaly lagta hai
# - sirf ek sensor kharab ho toh pakad nahi pata
# - dheere-dheere badhne wala fault (drift) miss hota hai
#
# Model v2 ke features:
#
# 1. RESIDUAL      = (sensor value - is RPM par expected value) / normal spread
#                    Expected value ek regression model healthy data se
#                    seekhta hai. "CHT is RPM ke liye zyada garam hai"
#                    -> residual bada. RPM ke 10 / 60 / 300 s averages bhi
#                    input hain, taaki CHT / oil temp ka thermal lag
#                    samajh aaye.
# 2. ROLLING MEAN  = pichhle 30 s ka average residual. Noise kam ho jaata
#                    hai, isliye chhota drift bhi jaldi dikhta hai.
#
# Training (poora dataset ek saath) aur live detector (ek reading at a
# time) dono yahi classes use karte hain, taaki features dono jagah
# bilkul same bane.
# ============================================================

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

# RPM se predict hone wale sensors
RESIDUAL_SENSORS = [key for key in SENSOR_KEYS if key != "rpm"]

RPM_TIME_CONSTANTS = (10, 60, 300)  # seconds
WINDOW_SECONDS = 30
FULL_WINDOW_READINGS = 30           # readings in a full window at 1 Hz
SENSOR_Z_TO_REPORT = 3.0            # sensors this far from expected are listed in alerts

NUMERIC_COLUMNS = {"sim_time", "noise_scale", "fault_severity", *SENSOR_KEYS}


# ============================================================
# STREAMING STATE (one per engine)
# ============================================================

class RpmContext:

    """RPM plus its exponential averages - the regression inputs."""

    def __init__(self):

        self.last_time = None
        self.last_rpm = None
        self.averages = None

    def update(self, t, rpm):

        # RPM missing: last known value use karo
        if rpm is None:
            rpm = self.last_rpm

        if rpm is None:
            return None

        if self.averages is None:
            self.averages = [rpm] * len(RPM_TIME_CONSTANTS)

        else:
            dt = min(max(t - self.last_time, 0.0), 30.0)
            self.averages = [
                average + (rpm - average) * (1 - math.exp(-dt / tau))
                for average, tau in zip(self.averages, RPM_TIME_CONSTANTS)
            ]

        self.last_time = t
        self.last_rpm = rpm

        return [rpm, *self.averages]


class RollingResiduals:

    """30 s rolling mean of each residual (missing values skipped)."""

    def __init__(self):

        n = len(RESIDUAL_SENSORS)
        self.items = deque()
        self.total = np.zeros(n)
        self.count = np.zeros(n)

    def update(self, t, residuals):

        valid = ~np.isnan(residuals)
        values = np.where(valid, residuals, 0.0)

        self.items.append((t, values, valid))
        self.total += values
        self.count += valid

        while self.items[0][0] <= t - WINDOW_SECONDS:
            _, old_values, old_valid = self.items.popleft()
            self.total -= old_values
            self.count -= old_valid

        # Window abhi bhara nahi (start / missing data): average ko
        # shrink karo, taaki kam readings ka noisy average false alarm na de
        mean = self.total / np.maximum(self.count, 1)
        return mean * np.sqrt(np.minimum(self.count, FULL_WINDOW_READINGS) / FULL_WINDOW_READINGS)


# ============================================================
# FEATURES + SCORES
# ============================================================
# `bundle` = trained model v2 (see train_model_v2.py)

def make_features(bundle, means):

    # (n, 9) rolling residual means -> standardized features
    return means / bundle["z_std"]


def raw_scores(bundle, features):

    # Residual limit: sabse zyada deviate hone wala sensor
    limit = np.abs(features).max(axis=1)

    # Isolation Forest: combined pattern kitna unusual hai (neeche = zyada unusual)
    forest = bundle["isolation_forest"].decision_function(features)

    return limit, forest


def score_features(bundle, features):

    limit, forest = raw_scores(bundle, features)

    # Dono ko threshold ke relative scale karo: < 0 = anomaly
    limit_margin = (bundle["limit_threshold"] - limit) / bundle["limit_threshold"]
    forest_margin = (forest - bundle["forest_threshold"]) / bundle["forest_spread"]

    return {
        "limit_flag": limit_margin < 0,
        "forest_flag": forest_margin < 0,
        "anomaly_score": np.minimum(limit_margin, forest_margin)
    }


def ranked_sensors(feature_row):

    # Sensors sorted by how far they are from their expected value
    scores = dict(zip(RESIDUAL_SENSORS, np.abs(feature_row)))

    ranked = sorted(
        (key for key, value in scores.items() if value >= SENSOR_Z_TO_REPORT),
        key=scores.get,
        reverse=True
    )

    return ranked or [max(scores, key=scores.get)]


# ============================================================
# BATCH HELPERS (training / evaluation)
# ============================================================

def load_dataset(path):

    # CSV from generate_dataset.py -> {column: numpy array}; missing values = nan
    with open(path, newline="") as file:
        reader = csv.DictReader(file)
        columns = {name: [] for name in reader.fieldnames}
        for row in reader:
            for name, value in row.items():
                columns[name].append(value)

    return {
        name: (
            np.array([float(v) if v != "" else np.nan for v in values])
            if name in NUMERIC_COLUMNS
            else np.array(values, dtype=object)
        )
        for name, values in columns.items()
    }


def rpm_feature_matrix(data):

    n = len(data["sim_time"])
    out = np.full((n, 1 + len(RPM_TIME_CONSTANTS)), np.nan)
    context, run = None, None

    for i in range(n):

        if data["run_id"][i] != run:
            context, run = RpmContext(), data["run_id"][i]

        rpm = data["rpm"][i]
        row = context.update(data["sim_time"][i], None if np.isnan(rpm) else float(rpm))

        if row is not None:
            out[i] = row

    return out


def residual_matrix(bundle, data, rpm_features):

    n = len(rpm_features)
    usable = ~np.isnan(rpm_features).any(axis=1)
    residuals = np.full((n, len(RESIDUAL_SENSORS)), np.nan)

    for j, key in enumerate(RESIDUAL_SENSORS):
        expected = np.full(n, np.nan)
        expected[usable] = bundle["regressors"][key].predict(rpm_features[usable])
        residuals[:, j] = (data[key] - expected) / bundle["residual_scale"][key]

    return residuals


def rolling_matrix(data, residuals):

    means = np.zeros_like(residuals)
    rolling, run = None, None

    for i in range(len(residuals)):

        if data["run_id"][i] != run:
            rolling, run = RollingResiduals(), data["run_id"][i]

        means[i] = rolling.update(data["sim_time"][i], residuals[i])

    return means


def features_for(bundle, data):

    rpm_features = rpm_feature_matrix(data)
    residuals = residual_matrix(bundle, data, rpm_features)

    return make_features(bundle, rolling_matrix(data, residuals))
