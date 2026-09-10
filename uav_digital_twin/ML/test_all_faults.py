from fault_detector import detect_fault


faults = {

    "NORMAL": {
        "rpm": 2800,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 0.30,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    },

    "OVERHEATING": {
        "rpm": 2800,
        "cht": 225,
        "egt": 850,
        "oil_pressure": 45,
        "oil_temperature": 115,
        "fuel_flow": 12,
        "vibration": 0.30,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    },

    "MISFIRE": {
        "rpm": 2300,
        "cht": 185,
        "egt": 600,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 1.0,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    },

    "LUBRICATION_ISSUE": {
        "rpm": 2800,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 20,
        "oil_temperature": 105,
        "fuel_flow": 12,
        "vibration": 0.45,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    },

    "ABNORMAL_VIBRATION": {
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
    },

    "INJECTOR_ABNORMALITY": {
        "rpm": 2500,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 17,
        "vibration": 0.30,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 15
    },

    "COMBUSTION_INSTABILITY": {
        "rpm": 2500,
        "cht": 185,
        "egt": 620,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 0.70,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    },

    "ELECTRICAL_FAULT": {
        "rpm": 2800,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 0.30,
        "battery_voltage": 21.5,
        "alternator_current": 3,
        "injection_timing": 12
    },

    "SENSOR_DRIFT_FAILURE": {
        "rpm": 4500,
        "cht": 185,
        "egt": 720,
        "oil_pressure": 45,
        "oil_temperature": 90,
        "fuel_flow": 12,
        "vibration": 0.30,
        "battery_voltage": 24.5,
        "alternator_current": 8,
        "injection_timing": 12
    }
}


print("\n====================")

for actual_fault, sensor_data in faults.items():

    result = detect_fault(sensor_data)

    detected_fault = result["fault_type"]

    if detected_fault is None:
        detected_fault = "NORMAL"

    print(
        f"{actual_fault:25s} -> {detected_fault}"
    )