import threading
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np

from ML import fault_detector as detector_v1
from ML.engine_features import (
    RESIDUAL_SENSORS,
    RPM_TIME_CONSTANTS,
    SENSOR_KEYS,
    WINDOW_SECONDS,
    RollingResiduals,
    RpmContext,
    make_features,
    ranked_sensors,
    score_features,
)


# ============================================================
# FAULT DETECTOR v2
# ============================================================
# fault_detector.py (v1) jaisa hi output deta hai, isliye backend
# mein switch karna ek line ka change hai (main.py):
#
#   from ML.fault_detector_v2 import detect_fault
#
# Kaun kya karta hai:
# - Fault ka NAAM: v1 ke rules (OVERHEATING, MISFIRE ...), unchanged
# - Anomaly hai ya nahi: rules YA model v2 (engine_model_v2.pkl)
#     model v2 = Isolation Forest (combined pattern)
#              + residual limit (koi ek sensor expected se door)
#
# Model v2 ko pichhli readings yaad rehti hain (30 s rolling
# average), isliye har engine_id ka alag state rakhta hai.
#
# Extra output key: flagged_by = ["rules", "isolation_forest", "residual_limit"]
# ============================================================

MODEL_PATH = Path(__file__).resolve().parent / "models" / "engine_model_v2.pkl"

bundle = joblib.load(MODEL_PATH)

if (
    tuple(bundle["rpm_time_constants"]) != RPM_TIME_CONSTANTS
    or bundle["window_seconds"] != WINDOW_SECONDS
    or bundle["isolation_forest"].n_features_in_ != len(RESIDUAL_SENSORS)
):
    raise RuntimeError("engine_features.py changed since the model was trained - run ML/train_model_v2.py again")

_engines = {}
_lock = threading.Lock()


def reset():

    # Forget every engine's history
    with _lock:
        _engines.clear()


def _seconds(timestamp):

    if timestamp is None:
        return time.time()

    if isinstance(timestamp, datetime):
        return timestamp.timestamp()

    if isinstance(timestamp, str):
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()

    return float(timestamp)


def score_reading(sensor_data):

    # Model v2 only. Returns None until the engine has sent an RPM value.
    t = _seconds(sensor_data.get("timestamp"))
    rpm = sensor_data.get("rpm")

    with _lock:

        rpm_context, rolling = _engines.setdefault(
            sensor_data.get("engine_id") or "default",
            (RpmContext(), RollingResiduals())
        )

        context = rpm_context.update(t, rpm)
        residuals = np.full(len(RESIDUAL_SENSORS), np.nan)

        if context is not None:
            x = np.array([context])
            for j, key in enumerate(RESIDUAL_SENSORS):
                value = sensor_data.get(key)
                if value is not None:
                    expected = bundle["regressors"][key].predict(x)[0]
                    residuals[j] = (float(value) - expected) / bundle["residual_scale"][key]

        means = rolling.update(t, residuals)

    if context is None:
        return None

    features = make_features(bundle, means[None, :])
    scores = score_features(bundle, features)

    flagged_by = []

    if scores["forest_flag"][0]:
        flagged_by.append("isolation_forest")

    if scores["limit_flag"][0]:
        flagged_by.append("residual_limit")

    return {
        "anomaly": bool(flagged_by),
        "anomaly_score": float(scores["anomaly_score"][0]),
        "flagged_by": flagged_by,
        "sensors": ranked_sensors(features[0]),
        # Har sensor apni expected value se kitne standard deviations door hai
        # (30 s average). Dashboard isse part health dikhata hai.
        "deviation": {key: round(float(features[0][j]), 2) for j, key in enumerate(RESIDUAL_SENSORS)}
    }


def detect_fault(sensor_data):

    # v1 rules name the fault (v1's own Isolation Forest result is ignored)
    rules = detector_v1.detect_fault(sensor_data)
    model = score_reading(sensor_data)

    rule_fault = rules["fault_type"] if rules["fault_type"] not in (None, "UNKNOWN_ANOMALY") else None
    model_anomaly = model is not None and model["anomaly"]

    if rule_fault:
        status, fault_type, severity = "ANOMALY", rule_fault, rules["severity"]

    elif model_anomaly:
        status, fault_type, severity = "ANOMALY", "UNKNOWN_ANOMALY", "MEDIUM"

    else:
        status, fault_type, severity = "NORMAL", None, "NONE"

    sensors = []

    if status == "ANOMALY":
        missing = [key for key in SENSOR_KEYS if sensor_data.get(key) is None]
        ranked = model["sensors"] if model else rules["sensors"]
        sensors = missing + [key for key in ranked if key not in missing]

    return {
        "status": status,
        "fault_type": fault_type,
        "severity": severity,
        # < 0 = model v2 sees an anomaly
        "anomaly_score": model["anomaly_score"] if model else 0.0,
        "model_prediction": "ANOMALY" if model_anomaly else "NORMAL",
        "sensors": sensors,
        "deviation": model["deviation"] if model else {},
        "flagged_by": (["rules"] if rule_fault else []) + (model["flagged_by"] if model else [])
    }
