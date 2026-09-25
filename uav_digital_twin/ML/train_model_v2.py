import argparse
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor, IsolationForest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ML.engine_features import (
    RESIDUAL_SENSORS,
    RPM_TIME_CONSTANTS,
    WINDOW_SECONDS,
    features_for,
    load_dataset,
    make_features,
    raw_scores,
    residual_matrix,
    rolling_matrix,
    rpm_feature_matrix,
    physics_residual_matrix,
)


# ============================================================
# TRAIN MODEL v2 + PHYSICS RESIDUAL
# ============================================================
#
# STEP 1
#   RPM -> expected sensor value
#
# STEP 2
#   EGT -> expected CHT
#   This is the physics-informed relationship.
#
# STEP 3
#   Build residual features + 30 sec rolling mean
#
# STEP 4
#   Isolation Forest
#
# STEP 5
#   Thresholds using healthy validation data
#
# Output:
#
#   ML/models/engine_model_v2.pkl
#
# ============================================================


ML_DIR = Path(__file__).resolve().parent


# ============================================================
# UNITS
# ============================================================

UNITS = {
    "cht": "degC",
    "egt": "degC",
    "oil_pressure": "psi",
    "oil_temperature": "degC",
    "fuel_flow": "L/h",
    "vibration": "g",
    "battery_voltage": "V",
    "alternator_current": "A",
    "injection_timing": "deg",
}


# ============================================================
# WARM-UP
# ============================================================

def warmed_up(data):

    """
    Rows at least one complete 30-second window
    after their run started.
    """

    start = {}

    out = np.zeros(
        len(data["sim_time"]),
        dtype=bool
    )

    for i, run in enumerate(
        data["run_id"]
    ):

        start.setdefault(
            run,
            data["sim_time"][i]
        )

        out[i] = (
            data["sim_time"][i]
            - start[run]
            >= WINDOW_SECONDS
        )

    return out


# ============================================================
# TRAIN PHYSICS MODEL
# ============================================================

def train_physics_model(
    train,
    bundle
):

    """
    Learn:

        EGT -> expected CHT

    using healthy training data only.

    Returns:

        physics_regressors
        physics_residual_scale
    """

    print(
        "\nSTEP 1B  Physics relationship: "
        "EGT -> expected CHT"
    )

    egt = train["egt"]
    cht = train["cht"]

    usable = (
        ~np.isnan(egt)
        & ~np.isnan(cht)
    )

    X = egt[usable].reshape(-1, 1)
    y = cht[usable]

    # Gradient boosting keeps the relationship flexible
    # rather than forcing a straight line.
    regressor = HistGradientBoostingRegressor(
        max_iter=200,
        random_state=0
    )

    regressor.fit(
        X,
        y
    )

    predicted = regressor.predict(X)

    residual = y - predicted

    # Robust spread using MAD
    scale = (
        1.4826
        * np.median(
            np.abs(
                residual
                - np.median(residual)
            )
        )
    )

    # Safety fallback in case spread becomes zero
    scale = max(
        float(scale),
        1e-6
    )

    explained = (
        1
        - residual.var()
        / y.var()
    )

    print(
        f"   EGT -> CHT"
        f" | residual spread +/- {scale:.3f} degC"
        f" | EGT explains {explained:5.1%} "
        f"of CHT variation"
    )

    return (
        {
            "cht_from_egt": regressor
        },
        {
            "cht_from_egt": scale
        }
    )


# ============================================================
# MAIN
# ============================================================

def main():

    parser = argparse.ArgumentParser(
        description=(
            "Train anomaly model v2 "
            "with physics-informed residual"
        )
    )

    parser.add_argument(
        "--data-dir",
        type=Path,
        default=ML_DIR / "data"
    )

    parser.add_argument(
        "--out",
        type=Path,
        default=(
            ML_DIR
            / "models"
            / "engine_model_v2.pkl"
        )
    )

    parser.add_argument(
        "--false-flags-per-hour",
        type=float,
        default=0.5,
        help=(
            "How many healthy readings per hour "
            "may be flagged on validation data"
        )
    )

    args = parser.parse_args()

    started = time.time()


    # ========================================================
    # LOAD DATA
    # ========================================================

    train = load_dataset(
        args.data_dir
        / "train_normal.csv"
    )

    val = load_dataset(
        args.data_dir
        / "val_normal.csv"
    )

    train_hours = (
        len(train["sim_time"])
        / 3600
    )

    val_hours = (
        len(val["sim_time"])
        / 3600
    )

    print(
        f"Training data:   "
        f"{train_hours:.1f} h healthy "
        f"({len(train['sim_time'])} readings)"
    )

    print(
        f"Validation data: "
        f"{val_hours:.1f} h healthy "
        f"({len(val['sim_time'])} readings)"
    )


    # ========================================================
    # INITIAL MODEL BUNDLE
    # ========================================================

    bundle = {

        "version": 2,

        "sensors": RESIDUAL_SENSORS,

        "rpm_time_constants":
            RPM_TIME_CONSTANTS,

        "window_seconds":
            WINDOW_SECONDS,

        "regressors": {},

        "residual_scale": {},

        # NEW physics models
        "physics_regressors": {},

        "physics_residual_scale": {},
    }


    # ========================================================
    # STEP 1
    # RPM -> EXPECTED SENSOR VALUES
    # ========================================================

    rpm_features = rpm_feature_matrix(
        train
    )

    usable = (
        ~np.isnan(rpm_features)
        .any(axis=1)
    )

    print(
        "\nSTEP 1  Expected sensor value "
        "from RPM"
    )


    for key in RESIDUAL_SENSORS:

        mask = (
            usable
            & ~np.isnan(train[key])
        )

        regressor = (
            HistGradientBoostingRegressor(
                max_iter=200,
                random_state=0
            )
        )

        regressor.fit(
            rpm_features[mask],
            train[key][mask]
        )

        residual = (
            train[key][mask]
            - regressor.predict(
                rpm_features[mask]
            )
        )

        # Robust standard deviation
        scale = (
            1.4826
            * np.median(
                np.abs(
                    residual
                    - np.median(residual)
                )
            )
        )

        scale = max(
            float(scale),
            1e-6
        )

        bundle[
            "regressors"
        ][key] = regressor

        bundle[
            "residual_scale"
        ][key] = scale

        explained = (
            1
            - residual.var()
            / train[key][mask].var()
        )

        print(
            f"   {key:19s} "
            f"+/- {scale:.3f} "
            f"{UNITS[key]:4s} "
            f"(RPM explains "
            f"{explained:5.1%})"
        )


    # ========================================================
    # STEP 1B
    # PHYSICS: EGT -> CHT
    # ========================================================

    (
        physics_regressors,
        physics_scales
    ) = train_physics_model(
        train,
        bundle
    )

    bundle[
        "physics_regressors"
    ] = physics_regressors

    bundle[
        "physics_residual_scale"
    ] = physics_scales


    # ========================================================
    # STEP 2
    # BUILD ALL RESIDUAL FEATURES
    # ========================================================

    rpm_residuals = residual_matrix(
        bundle,
        train,
        rpm_features
    )

    physics_residuals = (
        physics_residual_matrix(
            bundle,
            train
        )
    )

    # 9 existing + 1 physics = 10
    residuals = np.concatenate(
        [
            rpm_residuals,
            physics_residuals
        ],
        axis=1
    )

    means = rolling_matrix(
        train,
        residuals
    )

    warm = warmed_up(
        train
    )


    # ========================================================
    # STEP 3
    # STANDARDIZATION
    # ========================================================

    bundle["z_std"] = (
        means[warm].std(
            axis=0
        )
    )

    # Avoid division by zero
    bundle["z_std"] = np.maximum(
        bundle["z_std"],
        1e-6
    )

    features = make_features(
        bundle,
        means
    )

    print(
        "\nSTEP 2  Feature construction"
    )

    print(
        f"   Existing residual features : "
        f"{len(RESIDUAL_SENSORS)}"
    )

    print(
        f"   Physics residual features  : "
        f"{len(bundle['physics_regressors'])}"
    )

    print(
        f"   Total features             : "
        f"{features.shape[1]}"
    )


    # ========================================================
    # STEP 3
    # ISOLATION FOREST
    # ========================================================

    forest = IsolationForest(
        n_estimators=200,
        max_samples=512,
        random_state=42
    )

    forest.fit(
        features[warm]
    )

    bundle[
        "isolation_forest"
    ] = forest

    forest_scores = (
        forest.decision_function(
            features[warm]
        )
    )

    bundle[
        "forest_spread"
    ] = float(
        forest_scores.std()
    )

    bundle[
        "forest_spread"
    ] = max(
        bundle["forest_spread"],
        1e-6
    )

    print(
        f"\nSTEP 3  Isolation Forest trained "
        f"on {warm.sum()} feature rows "
        f"({features.shape[1]} features)"
    )


    # ========================================================
    # STEP 4
    # VALIDATION THRESHOLDS
    # ========================================================

    val_features = features_for(
        bundle,
        val
    )

    limit, forest_score = raw_scores(
        bundle,
        val_features
    )

    # Split false-alarm budget equally
    fraction = (
        args.false_flags_per_hour
        / 2
        / 3600
    )

    bundle[
        "limit_threshold"
    ] = float(
        np.quantile(
            limit,
            1 - fraction,
            method="higher"
        )
    )

    bundle[
        "forest_threshold"
    ] = float(
        np.quantile(
            forest_score,
            fraction,
            method="lower"
        )
    )

    bundle[
        "false_flags_per_hour_target"
    ] = args.false_flags_per_hour


    limit_flags = (
        limit
        > bundle["limit_threshold"]
    )

    forest_flags = (
        forest_score
        < bundle["forest_threshold"]
    )

    either_flags = (
        limit_flags
        | forest_flags
    )


    print(
        "\nSTEP 4  Thresholds "
        "(healthy validation data)"
    )

    print(
        f"   residual limit   : "
        f"{bundle['limit_threshold']:.2f}"
        f" -> {limit_flags.sum()} flagged readings"
    )

    print(
        f"   isolation forest : "
        f"{bundle['forest_threshold']:+.4f}"
        f" -> {forest_flags.sum()} flagged readings"
    )

    print(
        f"   either           : "
        f"{either_flags.sum() / val_hours:.2f} "
        f"flagged readings / hour"
        f" (target "
        f"{args.false_flags_per_hour:g})"
    )


    # ========================================================
    # TRAINING INFORMATION
    # ========================================================

    bundle["trained_on"] = {

        "train_readings":
            int(
                len(train["sim_time"])
            ),

        "val_readings":
            int(
                len(val["sim_time"])
            ),

        "feature_count":
            int(
                features.shape[1]
            ),

        "physics_features":
            [
                "cht_from_egt"
            ],

        "sklearn_version":
            sklearn.__version__
    }


    # ========================================================
    # SAVE MODEL
    # ========================================================

    args.out.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    joblib.dump(
        bundle,
        args.out,
        compress=3
    )

    print(
        f"\nSaved {args.out} "
        f"({args.out.stat().st_size / 1e6:.1f} MB) "
        f"in {time.time() - started:.0f}s"
    )


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()