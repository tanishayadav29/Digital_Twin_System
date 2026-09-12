from pathlib import Path

import joblib
import numpy as np


# ============================================================
# LOAD MODEL
# ============================================================
# Path is file ki location se banta hai, taaki model load ho
# chahe uvicorn uav_digital_twin/ se chale ya test script ML/ se.
# ============================================================

MODEL_PATH = Path(__file__).resolve().parent / "models" / "isolation_forest.pkl"

model = joblib.load(MODEL_PATH)


# ============================================================
# NORMAL ENGINE PROFILE
# ============================================================
# (mean, std) har sensor ka - train_model.py wale hi numbers,
# usi order mein jis order mein model train hua tha.
#
# Iska use:
# - missing sensor value ko normal value se fill karna
# - anomaly mein kaunse sensors normal se sabse zyada door
#   hain, wo dashboard ko batana
# ============================================================

NORMAL_PROFILE = {
    "rpm": (2800, 50),
    "cht": (185, 2),
    "egt": (720, 10),
    "oil_pressure": (45, 2),
    "oil_temperature": (90, 2),
    "fuel_flow": (12, 0.5),
    "vibration": (0.30, 0.05),
    "battery_voltage": (24.5, 0.3),
    "alternator_current": (8, 0.5),
    "injection_timing": (12, 0.5)
}

FEATURES = list(NORMAL_PROFILE)

# Normal mean se itne std door = deviating sensor
DEVIATION_THRESHOLD = 3.0


# ============================================================
# DEVIATING SENSORS
# ============================================================
# Isolation Forest sirf batata hai ki reading unusual hai,
# kaunsa sensor - ye nahi. Isliye har sensor ka z-score
# nikaal kar deviate hone wale sensors return karte hain
# (sabse zyada deviate wala pehle).
# ============================================================

def deviating_sensors(values, missing):

    z_scores = {
        key: abs(values[key] - mean) / std
        for key, (mean, std) in NORMAL_PROFILE.items()
    }

    deviating = sorted(
        (key for key in FEATURES if z_scores[key] >= DEVIATION_THRESHOLD),
        key=z_scores.get,
        reverse=True
    )

    # Koi single sensor bahut door nahi, lekin combination
    # unusual hai: sabse zyada deviate wala sensor dikhao
    if not deviating and not missing:
        deviating = [max(FEATURES, key=z_scores.get)]

    return missing + deviating


# ============================================================
# FAULT DETECTOR
# ============================================================

def detect_fault(sensor_data):

    # --------------------------------------------------------
    # SENSOR VALUES
    # --------------------------------------------------------
    # Sensor values Optional hain. Missing value ko normal
    # value se fill karo taaki model chal sake; missing sensor
    # khud SENSOR_DRIFT_FAILURE maana jayega.
    # --------------------------------------------------------

    missing = [
        key for key in FEATURES
        if sensor_data.get(key) is None
    ]

    values = {
        key: NORMAL_PROFILE[key][0] if key in missing else float(sensor_data[key])
        for key in FEATURES
    }

    rpm = values["rpm"]
    cht = values["cht"]
    egt = values["egt"]
    oil_pressure = values["oil_pressure"]
    oil_temperature = values["oil_temperature"]
    fuel_flow = values["fuel_flow"]
    vibration = values["vibration"]
    battery_voltage = values["battery_voltage"]
    alternator_current = values["alternator_current"]
    injection_timing = values["injection_timing"]


    # --------------------------------------------------------
    # ML INPUT
    # --------------------------------------------------------

    reading = np.array([[values[key] for key in FEATURES]])


    # --------------------------------------------------------
    # ISOLATION FOREST
    # --------------------------------------------------------

    prediction = model.predict(reading)[0]

    anomaly_score = model.decision_function(reading)[0]

    # Sirf model kya bol raha hai (rules se alag)
    model_prediction = "NORMAL" if prediction == 1 else "ANOMALY"


    # ========================================================
    # FAULT CONDITIONS
    # ========================================================

    # --------------------------------------------------------
    # 1. OVERHEATING
    # --------------------------------------------------------

    if (
        cht > 210
        or egt > 800
        or oil_temperature > 105
    ):

        fault_type = "OVERHEATING"
        severity = "HIGH"


    # --------------------------------------------------------
    # 2. LUBRICATION ISSUE
    # --------------------------------------------------------

    elif oil_pressure < 30:

        fault_type = "LUBRICATION_ISSUE"
        severity = "CRITICAL"


    # --------------------------------------------------------
    # 3. MISFIRE
    # --------------------------------------------------------

    elif (
        rpm < 2600
        and vibration > 0.75
        and egt < 680
    ):

        fault_type = "MISFIRE"
        severity = "HIGH"


    # --------------------------------------------------------
    # 4. ABNORMAL VIBRATION
    # --------------------------------------------------------

    elif vibration > 0.8:

        fault_type = "ABNORMAL_VIBRATION"
        severity = "HIGH"


    # --------------------------------------------------------
    # 5. INJECTOR ABNORMALITY
    # --------------------------------------------------------

    elif (
        fuel_flow > 15
        and abs(injection_timing - 12) > 1.5
    ):

        fault_type = "INJECTOR_ABNORMALITY"
        severity = "HIGH"


    # --------------------------------------------------------
    # 6. COMBUSTION INSTABILITY
    # --------------------------------------------------------

    elif (
        vibration > 0.6
        and (egt < 650 or egt > 780)
        and rpm < 2700
    ):

        fault_type = "COMBUSTION_INSTABILITY"
        severity = "HIGH"


    # --------------------------------------------------------
    # 7. ELECTRICAL FAULT
    # --------------------------------------------------------

    elif (
        battery_voltage < 22.5
        or alternator_current < 5
    ):

        fault_type = "ELECTRICAL_FAULT"
        severity = "MEDIUM"


    # --------------------------------------------------------
    # 8. SENSOR DRIFT / FAILURE
    # --------------------------------------------------------

    elif (
        missing
        or rpm < 1500
        or rpm > 4000
        or cht < 100
        or cht > 300
        or egt < 400
        or egt > 1000
        or oil_pressure < 5
        or oil_pressure > 100
        or battery_voltage < 18
        or battery_voltage > 30
    ):

        fault_type = "SENSOR_DRIFT_FAILURE"
        severity = "MEDIUM"


    # --------------------------------------------------------
    # NO FAULT CONDITIONS
    # --------------------------------------------------------

    else:

        # ML bhi normal bol raha hai
        if prediction == 1:

            return {
                "status": "NORMAL",
                "fault_type": None,
                "severity": "NONE",
                "anomaly_score": float(anomaly_score),
                "model_prediction": model_prediction,
                "sensors": []
            }

        # ML anomaly bol raha hai but known fault nahi mila
        fault_type = "UNKNOWN_ANOMALY"
        severity = "MEDIUM"


    # ========================================================
    # FAULT FOUND
    # ========================================================

    return {
        "status": "ANOMALY",
        "fault_type": fault_type,
        "severity": severity,
        "anomaly_score": float(anomaly_score),
        "model_prediction": model_prediction,
        "sensors": deviating_sensors(values, missing)
    }


# ============================================================
# TEST
# ============================================================

if __name__ == "__main__":

    test_data = {

        "rpm": 2800,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 1.2,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    }


    result = detect_fault(test_data)


    print("\nFAULT DETECTION RESULT")
    print("----------------------")

    for key, value in result.items():

        print(f"{key}: {value}")
