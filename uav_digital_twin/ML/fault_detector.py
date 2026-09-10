import joblib
import numpy as np


# ============================================================
# LOAD MODEL
# ============================================================

model = joblib.load("ML/models/isolation_forest.pkl")


# ============================================================
# FAULT DETECTOR
# ============================================================

def detect_fault(sensor_data):

    rpm = sensor_data["rpm"]
    cht = sensor_data["cht"]
    egt = sensor_data["egt"]
    oil_pressure = sensor_data["oil_pressure"]
    oil_temperature = sensor_data["oil_temperature"]
    fuel_flow = sensor_data["fuel_flow"]
    vibration = sensor_data["vibration"]
    battery_voltage = sensor_data["battery_voltage"]
    alternator_current = sensor_data["alternator_current"]
    injection_timing = sensor_data["injection_timing"]


    # --------------------------------------------------------
    # ML INPUT
    # --------------------------------------------------------

    reading = np.array([[
        rpm,
        cht,
        egt,
        oil_pressure,
        oil_temperature,
        fuel_flow,
        vibration,
        battery_voltage,
        alternator_current,
        injection_timing
    ]])


    # --------------------------------------------------------
    # ISOLATION FOREST
    # --------------------------------------------------------

    prediction = model.predict(reading)[0]

    anomaly_score = model.decision_function(reading)[0]


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
        rpm < 1500
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
                "anomaly_score": float(anomaly_score)
            }

        # ML anomaly bol raha hai but known fault nahi mila
        else:

            return {
                "status": "ANOMALY",
                "fault_type": "UNKNOWN_ANOMALY",
                "severity": "MEDIUM",
                "anomaly_score": float(anomaly_score)
            }


    # ========================================================
    # FAULT FOUND
    # ========================================================

    return {
        "status": "ANOMALY",
        "fault_type": fault_type,
        "severity": severity,
        "anomaly_score": float(anomaly_score)
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