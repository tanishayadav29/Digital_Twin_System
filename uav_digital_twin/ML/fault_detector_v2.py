
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
#
# v1 rules:
#   - Fault ka naam identify karte hain
#
# v2 model:
#   - RPM based residuals
#   - 30 second rolling residuals
#   - EGT -> CHT physics residual
#   - Isolation Forest
#   - Residual limit
#
# Total model features:
#
#   9 sensor residual features
#   + 1 physics residual feature
#   = 10 features
#
#
# IMPORTANT:
# Live detector ka feature pipeline training ke
# feature pipeline ke same hona chahiye.
#
# Training:
#
#   RPM
#    ↓
#   9 sensor residuals
#    +
#   EGT -> CHT physics residual
#    ↓
#   10 residuals
#    ↓
#   30 sec rolling mean
#    ↓
#   z-standardization
#    ↓
#   Isolation Forest
#
# Live:
#
#   EXACTLY SAME PIPELINE
#
# ============================================================


MODEL_PATH = (
    Path(__file__).resolve().parent
    / "models"
    / "engine_model_v2.pkl"
)


bundle = joblib.load(
    MODEL_PATH
)


# ============================================================
# MODEL COMPATIBILITY CHECK
# ============================================================


EXPECTED_FEATURE_COUNT = (
    len(RESIDUAL_SENSORS)
    + 1
)


# ------------------------------------------------------------
# Check RPM context configuration
# ------------------------------------------------------------

if tuple(
    bundle["rpm_time_constants"]
) != RPM_TIME_CONSTANTS:

    raise RuntimeError(
        "RPM time constants mismatch between "
        "engine_features.py and engine_model_v2.pkl. "
        "Run ML/train_model_v2.py again."
    )


# ------------------------------------------------------------
# Check rolling window
# ------------------------------------------------------------

if (
    bundle["window_seconds"]
    != WINDOW_SECONDS
):

    raise RuntimeError(
        "Rolling window mismatch between "
        "engine_features.py and engine_model_v2.pkl. "
        "Run ML/train_model_v2.py again."
    )


# ------------------------------------------------------------
# Check Isolation Forest feature count
# ------------------------------------------------------------

if (
    bundle[
        "isolation_forest"
    ].n_features_in_
    != EXPECTED_FEATURE_COUNT
):

    raise RuntimeError(
        "engine_features.py/model feature count mismatch. "
        f"Expected {EXPECTED_FEATURE_COUNT} features, "
        f"but Isolation Forest expects "
        f"{bundle['isolation_forest'].n_features_in_}. "
        "Run ML/train_model_v2.py again."
    )


# ------------------------------------------------------------
# Check z_std feature count
# ------------------------------------------------------------

if len(
    bundle["z_std"]
) != EXPECTED_FEATURE_COUNT:

    raise RuntimeError(
        "z_std feature count mismatch. "
        f"Expected {EXPECTED_FEATURE_COUNT}, "
        f"got {len(bundle['z_std'])}. "
        "Run ML/train_model_v2.py again."
    )


# ------------------------------------------------------------
# Check physics model
# ------------------------------------------------------------
#
# train_model_v2.py stores:
#
# bundle["physics_regressors"]["cht_from_egt"]
#
# bundle["physics_residual_scale"]["cht_from_egt"]
#
# ------------------------------------------------------------

if (
    "physics_regressors" not in bundle
    or "cht_from_egt"
    not in bundle["physics_regressors"]
):

    raise RuntimeError(
        "Physics regressor 'cht_from_egt' "
        "not found in engine_model_v2.pkl. "
        "Run ML/train_model_v2.py again."
    )


if (
    "physics_residual_scale" not in bundle
    or "cht_from_egt"
    not in bundle[
        "physics_residual_scale"
    ]
):

    raise RuntimeError(
        "Physics residual scale "
        "'cht_from_egt' not found in "
        "engine_model_v2.pkl. "
        "Run ML/train_model_v2.py again."
    )


# ============================================================
# LIVE ENGINE STATE
# ============================================================


_engines = {}

_lock = threading.Lock()


def reset():

    """
    Forget every engine's history.

    Useful for:
    - tests
    - restarting simulation
    - resetting live engine state
    """

    with _lock:
        _engines.clear()


# ============================================================
# TIMESTAMP HELPER
# ============================================================


def _seconds(timestamp):

    if timestamp is None:
        return time.time()


    if isinstance(
        timestamp,
        datetime
    ):

        return timestamp.timestamp()


    if isinstance(
        timestamp,
        str
    ):

        return datetime.fromisoformat(
            timestamp.replace(
                "Z",
                "+00:00"
            )
        ).timestamp()


    return float(timestamp)


# ============================================================
# PHYSICS RESIDUAL
# ============================================================


def _physics_residual(
    sensor_data
):

    """
    Calculates the physics-informed residual:

        actual CHT
            -
        expected CHT from EGT

    normalized by healthy residual spread.

    Returns:
        float
        or np.nan if EGT/CHT unavailable.
    """

    egt = sensor_data.get(
        "egt"
    )

    cht = sensor_data.get(
        "cht"
    )


    if (
        egt is None
        or cht is None
    ):

        return np.nan


    try:

        egt = float(egt)
        cht = float(cht)

    except (
        TypeError,
        ValueError
    ):

        return np.nan


    # --------------------------------------------------------
    # Expected CHT from EGT
    # --------------------------------------------------------

    expected_cht = (
        bundle[
            "physics_regressors"
        ][
            "cht_from_egt"
        ]
        .predict(
            np.array(
                [[egt]],
                dtype=float
            )
        )[0]
    )


    # --------------------------------------------------------
    # Healthy residual scale
    # --------------------------------------------------------

    scale = float(
        bundle[
            "physics_residual_scale"
        ][
            "cht_from_egt"
        ]
    )


    scale = max(
        scale,
        1e-6
    )


    # --------------------------------------------------------
    # Normalized physics residual
    # --------------------------------------------------------

    return (
        cht
        - expected_cht
    ) / scale


# ============================================================
# RPM SENSOR RESIDUALS
# ============================================================


def _sensor_residuals(
    sensor_data,
    context
):

    """
    Calculates the 9 RPM-based sensor residuals.

    Returns:
        numpy array of shape (9,)
    """

    residuals = np.full(
        len(
            RESIDUAL_SENSORS
        ),
        np.nan,
        dtype=float
    )


    if context is None:
        return residuals


    # sklearn expects shape:
    #
    # (1, number_of_rpm_features)
    #
    x = np.array(
        [context],
        dtype=float
    )


    for j, key in enumerate(
        RESIDUAL_SENSORS
    ):

        value = sensor_data.get(
            key
        )


        if value is None:
            continue


        try:

            value = float(
                value
            )

        except (
            TypeError,
            ValueError
        ):

            continue


        expected = (
            bundle[
                "regressors"
            ][key]
            .predict(x)[0]
        )


        scale = float(
            bundle[
                "residual_scale"
            ][key]
        )


        scale = max(
            scale,
            1e-6
        )


        residuals[j] = (
            value
            - expected
        ) / scale


    return residuals


# ============================================================
# LIVE MODEL SCORING
# ============================================================


def score_reading(
    sensor_data
):

    """
    Scores one live engine reading.

    The live pipeline exactly follows the
    Model v2 training pipeline:

        RPM context
             ↓
        9 sensor residuals
             +
        1 physics residual
             ↓
        10 residual features
             ↓
        30 sec rolling mean
             ↓
        z-standardization
             ↓
        Isolation Forest + residual limit
    """

    # --------------------------------------------------------
    # Timestamp
    # --------------------------------------------------------

    t = _seconds(
        sensor_data.get(
            "timestamp"
        )
    )


    # --------------------------------------------------------
    # Engine ID
    # --------------------------------------------------------

    engine_id = (
        sensor_data.get(
            "engine_id"
        )
        or "default"
    )


    # --------------------------------------------------------
    # RPM
    # --------------------------------------------------------

    rpm = sensor_data.get(
        "rpm"
    )


    with _lock:

        # ----------------------------------------------------
        # Get / create state for this engine
        # ----------------------------------------------------

        rpm_context, rolling = (
            _engines.setdefault(
                engine_id,
                (
                    RpmContext(),
                    RollingResiduals()
                )
            )
        )


        # ====================================================
        # 1. RPM CONTEXT
        # ====================================================

        context = rpm_context.update(
            t,
            rpm
        )


        # ====================================================
        # 2. NINE SENSOR RESIDUALS
        # ====================================================

        sensor_residuals = (
            _sensor_residuals(
                sensor_data,
                context
            )
        )


        # ====================================================
        # 3. PHYSICS RESIDUAL
        # ====================================================

        physics_residual = (
            _physics_residual(
                sensor_data
            )
        )


        # ====================================================
        # 4. COMBINE 9 + 1 = 10
        # ====================================================

        combined_residuals = (
            np.concatenate(
                [
                    sensor_residuals,
                    np.array(
                        [
                            physics_residual
                        ],
                        dtype=float
                    )
                ]
            )
        )


        # ====================================================
        # 5. 30 SECOND ROLLING MEAN
        # ====================================================

        means = rolling.update(
            t,
            combined_residuals
        )


    # --------------------------------------------------------
    # RPM unavailable
    # --------------------------------------------------------

    if context is None:
        return None


    # ========================================================
    # 6. STANDARDIZE ALL 10 FEATURES
    # ========================================================

    features = make_features(
        bundle,
        means[None, :]
    )


    # ========================================================
    # 7. SAFETY CHECK
    # ========================================================

    if features.shape[1] != EXPECTED_FEATURE_COUNT:

        raise RuntimeError(
            "Live feature dimension mismatch: "
            f"expected {EXPECTED_FEATURE_COUNT}, "
            f"got {features.shape[1]}"
        )


    # ========================================================
    # 8. SCORE
    # ========================================================

    scores = score_features(
        bundle,
        features
    )


    # ========================================================
    # 9. WHICH DETECTOR FLAGGED?
    # ========================================================

    flagged_by = []


    if scores[
        "forest_flag"
    ][0]:

        flagged_by.append(
            "isolation_forest"
        )


    if scores[
        "limit_flag"
    ][0]:

        flagged_by.append(
            "residual_limit"
        )


    # ========================================================
    # 10. SENSOR RANKING
    # ========================================================
    #
    # ranked_sensors() intentionally receives
    # ONLY the first 9 sensor residual features.
    #
    # Physics residual is not a physical sensor.
    #
    # ========================================================

    ranked = ranked_sensors(
        features[0]
    )


    # ========================================================
    # 11. SENSOR DEVIATIONS
    # ========================================================

    deviation = {

        key: round(
            float(
                features[0][j]
            ),
            2
        )

        for j, key
        in enumerate(
            RESIDUAL_SENSORS
        )
    }


    # ========================================================
    # 12. FINAL MODEL RESULT
    # ========================================================

    return {

        "anomaly":
            bool(flagged_by),


        "anomaly_score":
            float(
                scores[
                    "anomaly_score"
                ][0]
            ),


        "flagged_by":
            flagged_by,


        "sensors":
            ranked,


        "deviation":
            deviation,


        "physics_residual":
            round(
                float(
                    features[0][-1]
                ),
                2
            )
    }


# ============================================================
# FAULT DETECTION
# ============================================================


def detect_fault(
    sensor_data
):

    """
    Combines:

        v1 rule-based diagnosis
              +
        v2 ML anomaly detection

    Priority:

        1. Known rule fault
        2. Unknown ML anomaly
        3. Normal
    """

    # ========================================================
    # 1. V1 RULES
    # ========================================================

    rules = detector_v1.detect_fault(
        sensor_data
    )


    # ========================================================
    # 2. V2 MODEL
    # ========================================================

    model = score_reading(
        sensor_data
    )


    # ========================================================
    # 3. RULE FAULT
    # ========================================================

    rule_fault = (

        rules["fault_type"]

        if rules["fault_type"]
        not in (
            None,
            "UNKNOWN_ANOMALY"
        )

        else None
    )


    # ========================================================
    # 4. MODEL ANOMALY
    # ========================================================

    model_anomaly = (

        model is not None
        and model["anomaly"]
    )


    # ========================================================
    # 5. FINAL STATUS
    # ========================================================

    if rule_fault:

        status = "ANOMALY"

        fault_type = rule_fault

        severity = rules[
            "severity"
        ]


    elif model_anomaly:

        status = "ANOMALY"

        fault_type = (
            "UNKNOWN_ANOMALY"
        )

        severity = "MEDIUM"


    else:

        status = "NORMAL"

        fault_type = None

        severity = "NONE"


    # ========================================================
    # 6. SENSOR LIST
    # ========================================================

    sensors = []


    if status == "ANOMALY":

        missing = [

            key

            for key in SENSOR_KEYS

            if sensor_data.get(
                key
            ) is None
        ]


        ranked = (

            model["sensors"]

            if model

            else rules["sensors"]
        )


        sensors = (

            missing

            + [

                key

                for key in ranked

                if key not in missing

            ]
        )


    # ========================================================
    # 7. FLAG SOURCES
    # ========================================================

    flagged_by = []


    if rule_fault:

        flagged_by.append(
            "rules"
        )


    if model:

        flagged_by.extend(
            model["flagged_by"]
        )


    # ========================================================
    # 8. FINAL RESULT
    # ========================================================

    return {

        "status":
            status,


        "fault_type":
            fault_type,


        "severity":
            severity,


        # Negative = model sees anomaly
        "anomaly_score": (

            model[
                "anomaly_score"
            ]

            if model

            else 0.0
        ),


        "model_prediction": (

            "ANOMALY"

            if model_anomaly

            else "NORMAL"
        ),


        "sensors":
            sensors,


        "deviation": (

            model[
                "deviation"
            ]

            if model

            else {}
        ),


        "flagged_by":
            flagged_by,


        "physics_residual": (

            model.get(
                "physics_residual",
                0.0
            )

            if model

            else 0.0
        )
    }