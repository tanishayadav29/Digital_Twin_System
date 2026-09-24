from collections import deque

import numpy as np

from ML.engine_features import RESIDUAL_SENSORS


# ============================================================
# RUL FEATURES (short-term RUL, seconds)
# ============================================================
# The detector (engine_features.py -> RollingResiduals) tells us
# WHERE a sensor is: its 30 s average residual, in standard
# deviations. For RUL we also need HOW FAST it is moving.
#
#   deviation  = 30 s rolling mean residual (the detector's own
#                "deviation" output, unchanged)
#   slope      = least-squares slope of that deviation over the
#                last 60 s, in standard deviations per second
#
# A fault that is still far from critical but climbing fast gets a
# short RUL; one that is high but flat gets a longer one.
#
# The slope is taken over the detector's deviation values (not the
# raw per-reading residuals) on purpose: detect_fault() already
# returns them for every reading, so live inference needs nothing
# from inside the detector, and training uses the exact same numbers.
#
# Same pattern as RollingResiduals: one deque per engine, running
# totals, missing values skipped, and a shrink factor while the
# window is still filling so a few readings cannot fake a steep slope.
# Training (batch) and live inference (one reading at a time) both
# use this class, so the features match exactly.
# ============================================================

SLOPE_WINDOW_SECONDS = 60
FULL_SLOPE_READINGS = 60            # readings in a full window at 1 Hz

# The live detector rounds deviation to 2 decimals (fault_detector_v2.py);
# training rounds too so both sides see identical inputs.
DEVIATION_DECIMALS = 2

RUL_FEATURE_NAMES = (
    [f"dev_{key}" for key in RESIDUAL_SENSORS]
    + [f"slope_{key}" for key in RESIDUAL_SENSORS]
)


class RollingResidualSlopes:

    """60 s least-squares slope of each deviation (missing values skipped)."""

    def __init__(self):

        n = len(RESIDUAL_SENSORS)
        self.items = deque()
        self.t0 = None              # times are stored relative to this (keeps sums small)
        self.count = np.zeros(n)
        self.sum_t = np.zeros(n)
        self.sum_tt = np.zeros(n)
        self.sum_y = np.zeros(n)
        self.sum_ty = np.zeros(n)

    def _add(self, t, values, valid, sign):

        tv = np.where(valid, t, 0.0)
        self.count += sign * valid
        self.sum_t += sign * tv
        self.sum_tt += sign * tv * tv
        self.sum_y += sign * values
        self.sum_ty += sign * tv * values

    def update(self, t, deviations):

        if self.t0 is None:
            self.t0 = t

        rel = t - self.t0
        valid = ~np.isnan(deviations)
        values = np.where(valid, deviations, 0.0)

        self.items.append((rel, values, valid))
        self._add(rel, values, valid, +1)

        while self.items[0][0] <= rel - SLOPE_WINDOW_SECONDS:
            old_rel, old_values, old_valid = self.items.popleft()
            self._add(old_rel, old_values, old_valid, -1)

        n = self.count
        denominator = n * self.sum_tt - self.sum_t ** 2
        with np.errstate(divide="ignore", invalid="ignore"):
            slope = (n * self.sum_ty - self.sum_t * self.sum_y) / denominator
        slope = np.where((n >= 3) & (denominator > 1e-9), slope, 0.0)

        # Window not full yet: shrink, same idea as RollingResiduals
        return slope * np.sqrt(np.minimum(n, FULL_SLOPE_READINGS) / FULL_SLOPE_READINGS)


def rul_feature_row(deviation, slopes):

    # deviation: dict from detect_fault() or array in RESIDUAL_SENSORS order
    if isinstance(deviation, dict):
        deviation = np.array([deviation.get(key, np.nan) for key in RESIDUAL_SENSORS], dtype=float)

    return np.concatenate([deviation, slopes])


# ============================================================
# BATCH HELPER (training)
# ============================================================

def slope_matrix(data, deviations):

    # (n, 9) deviations -> (n, 9) slopes, state restarts per run_id
    slopes = np.zeros_like(deviations)
    rolling, run = None, None

    for i in range(len(deviations)):

        if data["run_id"][i] != run:
            rolling, run = RollingResidualSlopes(), data["run_id"][i]

        slopes[i] = rolling.update(data["sim_time"][i], deviations[i])

    return slopes
