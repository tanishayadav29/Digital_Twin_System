import math
import numpy as np


# ============================================================
# PHYSICS-INFORMED HEALTHY BASELINE
# ============================================================

def expected_values(rpm, ambient=0.0, cooling=0.0, oil_temperature=90.0):
    """
    Expected healthy sensor behaviour based on the
    simulator's healthy engine relationships.
    """

    r = (rpm - 2800.0) / 100.0

    expected_cht = (
        185.0
        + 5.0 * r
        + cooling
        + 0.8 * ambient
    )

    expected_egt = (
        720.0
        + 12.0 * r
        + 2.0 * ambient
    )

    expected_oil_pressure = (
        45.0
        + 1.2 * r
        - 0.25 * (oil_temperature - 90.0)
    )

    expected_oil_temperature = (
        90.0
        + 1.5 * r
        + 0.5 * ambient
    )

    expected_fuel_flow = (
        12.0
        + 0.9 * r
    )

    expected_vibration = (
        0.30
        + 0.025 * r
    )

    expected_injection_timing = (
        12.0
        + 0.15 * r
    )

    return {
        "cht": expected_cht,
        "egt": expected_egt,
        "oil_pressure": expected_oil_pressure,
        "oil_temperature": expected_oil_temperature,
        "fuel_flow": expected_fuel_flow,
        "vibration": expected_vibration,
        "injection_timing": expected_injection_timing
    }


# ============================================================
# PHYSICS RESIDUAL
# ============================================================

def calculate_residual(actual, expected):
    """
    Residual = actual sensor value - expected healthy value
    """

    if actual is None or expected is None:
        return np.nan

    return actual - expected


# ============================================================
# THERMAL CONSISTENCY
# ============================================================

def thermal_residual(cht, egt, ambient=0.0, cooling=0.0):
    """
    Compare measured CHT with CHT expected from EGT.
    """

    if cht is None or egt is None:
        return np.nan

    # Based on the simulator's healthy EGT relationship:
    # EGT = 720 + 12*r + 2*ambient
    #
    # Therefore:
    r_from_egt = (egt - 720.0 - 2.0 * ambient) / 12.0

    expected_cht = (
        185.0
        + 5.0 * r_from_egt
        + cooling
        + 0.8 * ambient
    )

    return cht - expected_cht


# ============================================================
# VIBRATION RMS
# ============================================================

def vibration_rms(samples):
    """
    RMS vibration over a recent time window.
    """

    valid_samples = [
        x for x in samples
        if x is not None
    ]

    if len(valid_samples) == 0:
        return np.nan

    values = np.array(valid_samples, dtype=float)

    return float(
        np.sqrt(np.mean(values ** 2))
    )


# ============================================================
# PHYSICS FEATURE VECTOR
# ============================================================

def physics_features(
    reading,
    ambient=0.0,
    cooling=0.0,
    vibration_history=None
):

    rpm = reading["rpm"]

    expected = expected_values(
        rpm=rpm,
        ambient=ambient,
        cooling=cooling,
        oil_temperature=reading["oil_temperature"]
        if reading["oil_temperature"] is not None
        else 90.0
    )

    features = {}

    # Sensor residuals
    for sensor in expected:

        features[f"{sensor}_residual"] = calculate_residual(
            reading[sensor],
            expected[sensor]
        )

    # CHT-EGT thermal consistency
    features["thermal_residual"] = thermal_residual(
        reading["cht"],
        reading["egt"],
        ambient,
        cooling
    )

    # Vibration RMS
    if vibration_history is not None:
        features["vibration_rms"] = vibration_rms(
            vibration_history
        )

    return features