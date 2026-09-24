import threading
from pathlib import Path

import joblib
import numpy as np

from ML.engine_features import RESIDUAL_SENSORS
from ML.fault_detector_v2 import _seconds
from ML.rul_features import SLOPE_WINDOW_SECONDS, RollingResidualSlopes, rul_feature_row


# ============================================================
# SHORT-TERM RUL ESTIMATOR (live)
# ============================================================
# "Anomaly detected" -> "about N seconds until this fault is fully
# developed (ACTIVE / critical)".
#
# Two calls from main.py:
#
#   observe(sensor_data, detected_fault)
#       EVERY reading. Cheap: updates the 60 s slope window from the
#       detector's `deviation` output. It has to see the readings
#       before the anomaly, otherwise there is no trend to measure.
#
#   estimate_rul_seconds(sensor_data, current_fault_type)
#       ONLY when detect_fault() returned status == "ANOMALY".
#       Runs the model trained by ML/train_rul_model.py.
#
# Like fault_detector_v2.py, state is kept per engine_id.
# The model is loaded once at import (same as engine_model_v2.pkl).
# If rul_model.pkl is missing the backend still runs - RUL is
# simply None - so this never breaks detection.
# ============================================================

MODEL_PATH = Path(__file__).resolve().parent / "models" / "rul_model.pkl"

bundle = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None

if bundle is not None and (
    bundle["slope_window_seconds"] != SLOPE_WINDOW_SECONDS
    or list(bundle["sensors"]) != RESIDUAL_SENSORS
):
    raise RuntimeError("rul_features.py changed since the RUL model was trained - run ML/train_rul_model.py again")

_engines = {}
_lock = threading.Lock()


class _EngineState:

    def __init__(self):

        self.slopes = RollingResidualSlopes()
        self.features = None        # latest rul_feature_row
        self.streak_start = None    # anomaly streak (same rule as training)
        self.last_flag = None
        self.time = None


def reset():

    with _lock:
        _engines.clear()


def observe(sensor_data, detected_fault):

    deviation = detected_fault.get("deviation") or {}

    # Detector not scoring yet (no RPM seen) - nothing to learn from
    if not deviation:
        return

    t = _seconds(sensor_data.get("timestamp"))
    values = np.array([deviation.get(key, np.nan) for key in RESIDUAL_SENSORS], dtype=float)

    with _lock:

        state = _engines.setdefault(sensor_data.get("engine_id") or "default", _EngineState())

        slopes = state.slopes.update(t, values)
        state.features = rul_feature_row(values, slopes)
        state.time = t

        if detected_fault.get("status") == "ANOMALY":
            gap = bundle["streak_gap_seconds"] if bundle else 30
            if state.last_flag is None or t - state.last_flag > gap:
                state.streak_start = t
            state.last_flag = t


def _fault_code(fault_type):

    fault_type = bundle["fault_aliases"].get(fault_type, fault_type)
    categories = bundle["fault_categories"]
    return float(categories.index(fault_type)) if fault_type in categories else np.nan


def estimate_rul_seconds(sensor_data, current_fault_type):

    # Returns None when there is no model yet or not enough history,
    # otherwise:
    #   {"seconds": 42.0, "low": 30.0, "high": 55.0,
    #    "already_critical": False, "fault_type": "OVERHEATING"}
    if bundle is None:
        return None

    with _lock:

        state = _engines.get(sensor_data.get("engine_id") or "default")

        if state is None or state.features is None:
            return None

        seconds_flagged = 0.0 if state.streak_start is None else state.time - state.streak_start
        row = np.concatenate([state.features, [seconds_flagged, _fault_code(current_fault_type)]])[None, :]

    cap = bundle["max_seconds"]
    point = float(np.clip(bundle["point"].predict(row)[0], 0, cap))
    low = float(np.clip(bundle["low"].predict(row)[0], 0, cap))
    high = float(np.clip(bundle["high"].predict(row)[0], 0, cap))

    return {
        "seconds": round(point, 1),
        "low": round(min(low, point), 1),
        "high": round(max(high, point), 1),
        # Under ~5 s: treat as "at critical now"
        "already_critical": point < 5.0,
        "fault_type": current_fault_type,
    }
