
import time
import random
from datetime import datetime, timezone

import requests


# ============================================================
# FASTAPI ENDPOINT
# ============================================================

# Sensor telemetry FastAPI ke through PostgreSQL mein jayegi
API_URL = API_URL = "http://127.0.0.1:8000/sensor-data-ml"


# ============================================================
# NORMAL ENGINE VALUES
# ============================================================

BASE_RPM = 2800
BASE_CHT = 185.0
BASE_EGT = 720.0
BASE_OIL_PRESSURE = 45.0
BASE_OIL_TEMPERATURE = 90.0
BASE_FUEL_FLOW = 12.0
BASE_VIBRATION = 0.30
BASE_BATTERY_VOLTAGE = 24.5
BASE_ALTERNATOR_CURRENT = 8.0
BASE_INJECTION_TIMING = 12.0


# Reading counter
counter = 0


# ============================================================
# CONTINUOUS ENGINE SIMULATION
# ============================================================

while True:

    counter += 1


    # ========================================================
    # 1. GENERATE NORMAL SENSOR VALUES
    # ========================================================

    # Real sensors ki readings perfectly constant nahi hoti.
    # Isliye normal values ke around small random variation hai.

    rpm = BASE_RPM + random.uniform(-50, 50)

    cht = BASE_CHT + random.uniform(-2, 2)

    egt = BASE_EGT + random.uniform(-10, 10)

    oil_pressure = BASE_OIL_PRESSURE + random.uniform(-2, 2)

    oil_temperature = BASE_OIL_TEMPERATURE + random.uniform(-2, 2)

    fuel_flow = BASE_FUEL_FLOW + random.uniform(-0.5, 0.5)

    vibration = BASE_VIBRATION + random.uniform(-0.05, 0.05)

    battery_voltage = BASE_BATTERY_VOLTAGE + random.uniform(-0.3, 0.3)

    alternator_current = BASE_ALTERNATOR_CURRENT + random.uniform(-0.5, 0.5)

    injection_timing = BASE_INJECTION_TIMING + random.uniform(-0.5, 0.5)


    # ========================================================
    # 2. CHOOSE ENGINE CONDITION
    # ========================================================

    # Approximate distribution:
    #
    # NORMAL              = 85%
    # OVERHEATING          = 4%
    # MISFIRE              = 3%
    # LOW OIL PRESSURE     = 3%
    # HIGH VIBRATION       = 2%
    # FUEL ANOMALY         = 2%
    # ELECTRICAL FAULT     = 1%
    #
    # Total = 100%

    fault_chance = random.randint(1, 100)

    fault = "NORMAL"


    # ========================================================
    # 3. OVERHEATING
    # ========================================================

    if fault_chance <= 4:

        fault = "OVERHEATING"

        # CHT increases significantly
        cht += random.uniform(30, 40)

        # EGT also increases
        egt += random.uniform(100, 140)

        # Oil temperature increases
        oil_temperature += random.uniform(15, 25)


    # ========================================================
    # 4. MISFIRE
    # ========================================================

    elif fault_chance <= 7:

        fault = "MISFIRE"

        # Misfire causes unstable / reduced RPM
        rpm -= random.uniform(300, 600)

        # Engine vibration increases
        vibration += random.uniform(0.5, 1.0)

        # EGT may drop because combustion is incomplete
        egt -= random.uniform(80, 150)


    # ========================================================
    # 5. LOW OIL PRESSURE
    # ========================================================

    elif fault_chance <= 10:

        fault = "LOW_OIL_PRESSURE"

        # Oil pressure drops significantly
        oil_pressure -= random.uniform(15, 25)

        # Poor lubrication can increase oil temperature
        oil_temperature += random.uniform(8, 15)

        # Slight vibration increase
        vibration += random.uniform(0.05, 0.20)


    # ========================================================
    # 6. HIGH VIBRATION
    # ========================================================

    elif fault_chance <= 12:

        fault = "HIGH_VIBRATION"

        # Abnormally high engine vibration
        vibration += random.uniform(0.7, 1.2)

        # RPM can become slightly unstable
        rpm += random.uniform(-150, 150)


    # ========================================================
    # 7. FUEL SYSTEM ANOMALY
    # ========================================================

    elif fault_chance <= 14:

        fault = "FUEL_ANOMALY"

        # Fuel flow becomes abnormal
        fuel_flow += random.uniform(3, 5)

        # RPM may decrease because combustion is affected
        rpm -= random.uniform(150, 350)

        # EGT changes because fuel-air mixture is abnormal
        egt += random.uniform(-70, 70)


    # ========================================================
    # 8. ELECTRICAL / ALTERNATOR FAULT
    # ========================================================

    elif fault_chance <= 15:

        fault = "ELECTRICAL_FAULT"

        # Battery voltage drops
        battery_voltage -= random.uniform(2, 4)

        # Alternator current decreases
        alternator_current -= random.uniform(3, 5)


    # ========================================================
    # 9. CREATE TELEMETRY DATA
    # ========================================================

    # Important:
    # "fault" sirf simulator ke terminal mein information hai.
    #
    # Hum fault label PostgreSQL ko nahi bhej rahe.
    # Database mein actual sensor values save hongi.
    #
    # Baad mein anomaly detection system in sensor values
    # ko analyse karke fault identify karega.

    data = {

        "engine_id": "ENGINE_001",

        "timestamp": datetime.now(timezone.utc).isoformat(),

        "rpm": rpm,

        "cht": cht,

        "egt": egt,

        "oil_pressure": oil_pressure,

        "oil_temperature": oil_temperature,

        "fuel_flow": fuel_flow,

        "vibration": vibration,

        "battery_voltage": battery_voltage,

        "alternator_current": alternator_current,

        "injection_timing": injection_timing
    }


    # ========================================================
    # 10. SEND DATA TO FASTAPI
    # ========================================================

    try:

        response = requests.post(
            API_URL,
            json=data
        )

        print("ML RESPONSE:", response.json())

        # Terminal mein condition + important readings show karo
        print(
            f"Reading: {counter:04d} | "
            f"Fault: {fault:20s} | "
            f"RPM: {rpm:7.1f} | "
            f"CHT: {cht:6.1f} | "
            f"EGT: {egt:6.1f} | "
            f"Oil P: {oil_pressure:5.1f} | "
            f"Vib: {vibration:.2f} | "
            f"Status: {response.status_code}"
        )


    except Exception as e:

        # Agar FastAPI unavailable hai
        print("Error sending telemetry:", e)


    # ========================================================
    # 11. WAIT FOR 1 SECOND
    # ========================================================

    # Har second ek new telemetry reading generate hogi
    time.sleep(1)

