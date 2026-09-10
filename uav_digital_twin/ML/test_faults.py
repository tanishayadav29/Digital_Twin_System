import numpy as np
import joblib


# ============================================================
# LOAD MODEL
# ============================================================

model = joblib.load("ML/models/isolation_forest.pkl")


# ============================================================
# SENSOR FEATURE ORDER
# ============================================================

# RPM
# CHT
# EGT
# Oil Pressure
# Oil Temperature
# Fuel Flow
# Vibration
# Battery Voltage
# Alternator Current
# Injection Timing


# ============================================================
# TEST FAULTS
# ============================================================

faults = {

    "NORMAL": [
        2800, 185, 720, 45, 90,
        12, 0.30, 24.5, 8, 12
    ],

    "OVERHEATING": [
        2800, 225, 850, 45, 115,
        12, 0.30, 24.5, 8, 12
    ],

    "MISFIRE": [
        2300, 185, 600, 45, 90,
        12, 1.00, 24.5, 8, 12
    ],

    "LOW_OIL_PRESSURE": [
        2800, 185, 720, 20, 105,
        12, 0.45, 24.5, 8, 12
    ],

    "HIGH_VIBRATION": [
        2700, 185, 720, 45, 90,
        12, 1.20, 24.5, 8, 12
    ],

    "FUEL_ANOMALY": [
        2450, 185, 650, 45, 90,
        17, 0.30, 24.5, 8, 12
    ],

    "ELECTRICAL_FAULT": [
        2800, 185, 720, 45, 90,
        12, 0.30, 21.5, 3, 12
    ]
}


# ============================================================
# RUN PREDICTIONS
# ============================================================

for fault_name, sensor_values in faults.items():

    reading = np.array([sensor_values])

    prediction = model.predict(reading)[0]

    if prediction == 1:
        result = "NORMAL"
    else:
        result = "ANOMALY"

    print(
        f"{fault_name:20s} -> {result}"
    )