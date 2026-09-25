import csv
import math
from collections import deque

import numpy as np


# ============================================================
# ENGINE FEATURES (MODEL v2)
# ============================================================
#
# Model v2:
#
# 1. RPM -> expected sensor value
# 2. Sensor residuals
# 3. Physics residual: EGT -> expected CHT
# 4. 30 second rolling average
# 5. Isolation Forest
# 6. Residual-limit detector
#
# IMPORTANT:
# Training aur live detection dono isi file ke
# feature functions use karte hain.
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
    "injection_timing",
]


# RPM se expected values predict hone wale sensors
RESIDUAL_SENSORS = [
    key for key in SENSOR_KEYS
    if key != "rpm"
]


# RPM exponential averages
RPM_TIME_CONSTANTS = (
    10,
    60,
    300,
)


WINDOW_SECONDS = 30
FULL_WINDOW_READINGS = 30


# Itne standard deviations se zyada deviation
# dashboard alert mein sensor ko show karega
SENSOR_Z_TO_REPORT = 3.0


NUMERIC_COLUMNS = {
    "sim_time",
    "noise_scale",
    "fault_severity",
    *SENSOR_KEYS,
}


# ============================================================
# STREAMING STATE
# ============================================================


class RpmContext:
    """
    RPM plus exponential averages.

    Ye wahi inputs banata hai jo training ke time
    rpm_feature_matrix() banata hai.
    """

    def __init__(self):

        self.last_time = None
        self.last_rpm = None
        self.averages = None


    def update(self, t, rpm):

        # RPM missing ho to last known RPM use karo
        if rpm is None:
            rpm = self.last_rpm


        if rpm is None:
            return None


        # First reading
        if self.averages is None:

            self.averages = [
                rpm
                for _ in RPM_TIME_CONSTANTS
            ]


        else:

            # Agar last_time available nahi hai,
            # to dt = 0 use karenge.
            if self.last_time is None:
                dt = 0.0
            else:
                dt = min(
                    max(
                        t - self.last_time,
                        0.0
                    ),
                    30.0
                )


            self.averages = [

                average
                + (
                    rpm - average
                )
                * (
                    1
                    - math.exp(
                        -dt / tau
                    )
                )

                for average, tau
                in zip(
                    self.averages,
                    RPM_TIME_CONSTANTS
                )
            ]


        self.last_time = t
        self.last_rpm = rpm


        return [
            rpm,
            *self.averages
        ]


# ============================================================
# ROLLING RESIDUALS
# ============================================================


class RollingResiduals:
    """
    30 second rolling mean of residuals.

    Missing values are ignored.

    IMPORTANT:
    Feature count dynamically initialize hota hai.

    Model v2 ke current feature vector mein:

        9 RPM-based residuals
        +
        1 physics residual
        =
        10 features

    Isliye yahan 9 ko hard-code nahi karna hai.
    """

    def __init__(self):

        self.items = deque()

        # Feature count first update() par determine hoga.
        self.total = None
        self.count = None


    def update(self, t, residuals):

        # ----------------------------------------------------
        # Ensure numpy array
        # ----------------------------------------------------

        residuals = np.asarray(
            residuals,
            dtype=float
        )


        # ----------------------------------------------------
        # Dynamic initialization
        # ----------------------------------------------------

        if self.total is None:

            n = len(
                residuals
            )

            self.total = np.zeros(
                n,
                dtype=float
            )

            self.count = np.zeros(
                n,
                dtype=float
            )


        # ----------------------------------------------------
        # Feature dimension safety check
        # ----------------------------------------------------

        if len(residuals) != len(self.total):

            raise ValueError(
                "RollingResiduals feature dimension mismatch: "
                f"expected {len(self.total)}, "
                f"got {len(residuals)}"
            )


        # ----------------------------------------------------
        # Missing values are ignored
        # ----------------------------------------------------

        valid = ~np.isnan(
            residuals
        )


        values = np.where(
            valid,
            residuals,
            0.0
        )


        # ----------------------------------------------------
        # Add current reading
        # ----------------------------------------------------

        self.items.append(
            (
                t,
                values,
                valid
            )
        )


        self.total += values
        self.count += valid


        # ----------------------------------------------------
        # Remove readings older than 30 seconds
        # ----------------------------------------------------

        while (
            self.items
            and self.items[0][0]
            <= t - WINDOW_SECONDS
        ):

            (
                _,
                old_values,
                old_valid
            ) = self.items.popleft()


            self.total -= old_values
            self.count -= old_valid


        # ----------------------------------------------------
        # Rolling mean
        # ----------------------------------------------------

        mean = (
            self.total
            / np.maximum(
                self.count,
                1
            )
        )


        # ----------------------------------------------------
        # Incomplete window down-weighting
        # ----------------------------------------------------

        return (
            mean
            * np.sqrt(
                np.minimum(
                    self.count,
                    FULL_WINDOW_READINGS
                )
                / FULL_WINDOW_READINGS
            )
        )


# ============================================================
# NORMAL RPM RESIDUAL FEATURES
# ============================================================


def make_features(bundle, means):

    """
    Rolling residuals ko standardize karta hai.

    Current Model v2:

        9 sensor residuals
        +
        1 physics residual

        = 10 features
    """

    z_std = np.asarray(
        bundle["z_std"],
        dtype=float
    )


    z_std = np.where(
        z_std <= 1e-12,
        1.0,
        z_std
    )


    return means / z_std


# ============================================================
# PHYSICS RESIDUAL
# ============================================================


def physics_residual_matrix(
    bundle,
    data
):

    """
    Physics relationship:

        EGT -> expected CHT

    residual =
        actual CHT - expected CHT

    normalized by healthy residual spread.

    train_model_v2.py stores:

        bundle["physics_regressors"]["cht_from_egt"]

    and:

        bundle["physics_residual_scale"]["cht_from_egt"]
    """

    n = len(
        data["sim_time"]
    )


    output = np.full(
        (n, 1),
        np.nan
    )


    egt = data["egt"]
    cht = data["cht"]


    usable = (
        ~np.isnan(egt)
        & ~np.isnan(cht)
    )


    if not usable.any():
        return output


    # --------------------------------------------------------
    # EGT -> expected CHT
    # --------------------------------------------------------

    expected_cht = (
        bundle[
            "physics_regressors"
        ][
            "cht_from_egt"
        ]
        .predict(
            egt[usable].reshape(
                -1,
                1
            )
        )
    )


    # --------------------------------------------------------
    # Physics residual
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


    output[
        usable,
        0
    ] = (
        cht[usable]
        - expected_cht
    ) / scale


    return output


# ============================================================
# COMBINED RESIDUAL MATRIX
# ============================================================


def combined_residual_matrix(
    bundle,
    data,
    rpm_features
):

    """
    Combines:

        9 RPM-based residuals
        +
        1 physics residual

    Total = 10 features
    """

    rpm_residuals = residual_matrix(
        bundle,
        data,
        rpm_features
    )


    physics_residuals = (
        physics_residual_matrix(
            bundle,
            data
        )
    )


    return np.concatenate(
        [
            rpm_residuals,
            physics_residuals
        ],
        axis=1
    )


# ============================================================
# SCORES
# ============================================================


def raw_scores(
    bundle,
    features
):

    """
    Returns:

        limit
        isolation forest score
    """

    # First 9 features are sensor residuals.
    #
    # Physics feature is included in the
    # Isolation Forest.
    #
    # Residual-limit alert is based only
    # on the 9 sensor deviations.

    sensor_features = features[
        :,
        :len(RESIDUAL_SENSORS)
    ]


    limit = np.abs(
        sensor_features
    ).max(
        axis=1
    )


    forest = (
        bundle[
            "isolation_forest"
        ]
        .decision_function(
            features
        )
    )


    return (
        limit,
        forest
    )


# ============================================================
# SCORE FEATURES
# ============================================================


def score_features(
    bundle,
    features
):

    limit, forest = raw_scores(
        bundle,
        features
    )


    # --------------------------------------------------------
    # Residual-limit margin
    # --------------------------------------------------------

    limit_threshold = float(
        bundle[
            "limit_threshold"
        ]
    )


    limit_margin = (
        limit_threshold
        - limit
    ) / max(
        limit_threshold,
        1e-12
    )


    # --------------------------------------------------------
    # Isolation Forest margin
    # --------------------------------------------------------

    forest_threshold = float(
        bundle[
            "forest_threshold"
        ]
    )


    forest_spread = float(
        bundle[
            "forest_spread"
        ]
    )


    forest_spread = max(
        forest_spread,
        1e-12
    )


    forest_margin = (
        forest
        - forest_threshold
    ) / forest_spread


    return {

        "limit_flag":
            limit_margin < 0,

        "forest_flag":
            forest_margin < 0,

        # Negative = anomaly
        "anomaly_score":
            np.minimum(
                limit_margin,
                forest_margin
            )
    }


# ============================================================
# RANK SENSORS
# ============================================================


def ranked_sensors(
    feature_row
):

    """
    Sensors sorted by absolute deviation
    from expected value.

    Physics residual ko sensor ranking mein
    include nahi kiya jata.
    """

    sensor_values = (
        feature_row[
            :len(
                RESIDUAL_SENSORS
            )
        ]
    )


    scores = dict(
        zip(
            RESIDUAL_SENSORS,
            np.abs(
                sensor_values
            )
        )
    )


    ranked = sorted(

        (
            key

            for key, value
            in scores.items()

            if value
            >= SENSOR_Z_TO_REPORT
        ),

        key=scores.get,

        reverse=True
    )


    # Agar koi sensor 3 sigma se bahar nahi hai,
    # then most abnormal sensor return karo.

    if ranked:
        return ranked


    return [
        max(
            scores,
            key=scores.get
        )
    ]


# ============================================================
# LOAD DATASET
# ============================================================


def load_dataset(path):

    """
    CSV ko dictionary of numpy arrays mein load karta hai.
    """

    with open(
        path,
        newline=""
    ) as file:

        reader = csv.DictReader(
            file
        )


        columns = {
            name: []
            for name
            in reader.fieldnames
        }


        for row in reader:

            for name, value in row.items():

                columns[name].append(
                    value
                )


    return {

        name: (

            np.array(
                [
                    float(v)
                    if v != ""
                    else np.nan

                    for v in values
                ]
            )

            if name
            in NUMERIC_COLUMNS

            else np.array(
                values,
                dtype=object
            )
        )

        for name, values
        in columns.items()
    }


# ============================================================
# RPM FEATURE MATRIX
# ============================================================


def rpm_feature_matrix(
    data
):

    """
    Batch version of RpmContext.

    Important:
    har run ke beginning par RPM context reset hota hai.
    """

    n = len(
        data["sim_time"]
    )


    out = np.full(
        (
            n,
            1 + len(
                RPM_TIME_CONSTANTS
            )
        ),
        np.nan
    )


    context = None
    run = None


    for i in range(n):

        current_run = (
            data["run_id"][i]
        )


        if current_run != run:

            context = RpmContext()
            run = current_run


        rpm = data["rpm"][i]


        row = context.update(

            data["sim_time"][i],

            (
                None
                if np.isnan(rpm)
                else float(rpm)
            )
        )


        if row is not None:

            out[i] = row


    return out


# ============================================================
# RESIDUAL MATRIX
# ============================================================


def residual_matrix(
    bundle,
    data,
    rpm_features
):

    """
    9 RPM-based sensor residuals.
    """

    n = len(
        rpm_features
    )


    usable = ~np.isnan(
        rpm_features
    ).any(
        axis=1
    )


    residuals = np.full(
        (
            n,
            len(
                RESIDUAL_SENSORS
            )
        ),
        np.nan
    )


    for j, key in enumerate(
        RESIDUAL_SENSORS
    ):

        expected = np.full(
            n,
            np.nan
        )


        expected[usable] = (
            bundle[
                "regressors"
            ][key]
            .predict(
                rpm_features[usable]
            )
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


        residuals[
            :,
            j
        ] = (
            data[key]
            - expected
        ) / scale


    return residuals


# ============================================================
# ROLLING MATRIX
# ============================================================


def rolling_matrix(
    data,
    residuals
):

    """
    Batch version of RollingResiduals.

    Automatically supports:

        9 residuals

    and:

        10 residuals
        (9 sensor + 1 physics)
    """

    means = np.zeros_like(
        residuals,
        dtype=float
    )


    rolling = None
    run = None


    for i in range(
        len(residuals)
    ):

        current_run = (
            data["run_id"][i]
        )


        if current_run != run:

            rolling = RollingResiduals()
            run = current_run


        means[i] = rolling.update(
            data["sim_time"][i],
            residuals[i]
        )


    return means


# ============================================================
# FEATURES FOR COMPLETE DATASET
# ============================================================


def features_for(
    bundle,
    data
):

    """
    Complete feature pipeline.

    1. RPM features
    2. Sensor residuals
    3. Physics residual
    4. 30 sec rolling mean
    5. Standardization

    Final feature count:

        9 sensor residuals
        +
        1 physics residual

        = 10
    """

    rpm_features = (
        rpm_feature_matrix(
            data
        )
    )


    residuals = (
        combined_residual_matrix(
            bundle,
            data,
            rpm_features
        )
    )


    means = rolling_matrix(
        data,
        residuals
    )


    # --------------------------------------------------------
    # Model training stores z_std for ALL 10 features.
    # --------------------------------------------------------

    return make_features(
        bundle,
        means
    )