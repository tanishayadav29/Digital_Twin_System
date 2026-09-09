import time
import random
from datetime import datetime, timezone

import requests


# ============================================================
# FASTAPI ENDPOINT
# ============================================================

# Sensor telemetry isi API endpoint par bheji jayegi
API_URL = "http://127.0.0.1:8000/sensor-data"


# ============================================================
# NORMAL ENGINE VALUES
# ============================================================

# Ye engine ke normal operating values hain.
# Real sensor ki tarah hum inke around thoda random variation rakhenge.

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


# Reading number track karne ke liye
counter = 0


# ============================================================
# CONTINUOUS SENSOR SIMULATION
# ============================================================

while True:

    # Har loop mein reading number increase hoga
    counter += 1


    # ========================================================
    # 1. GENERATE NORMAL SENSOR VALUES
    # ========================================================

    # Sensors perfectly constant nahi hote.
    # Isliye normal values ke around small random variation add kiya hai.

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
    # 2. FAULT INJECTION
    # ========================================================

    # Default condition NORMAL hai.
    #
    # Hum intentionally har reading ko faulty nahi banayenge.
    # Real engine mein majority time engine normal hota hai.
    #
    # Approximate probability:
    #
    # NORMAL       = 95%
    # OVERHEATING  = 3%
    # MISFIRE      = 2%

    fault = "NORMAL"


    # 1 se 100 ke beech random number
    fault_chance = random.randint(1, 100)


    # --------------------------------------------------------
    # OVERHEATING
    # --------------------------------------------------------

    # Sirf 1, 2, 3 aane par overheating inject hogi
    # Therefore approximately 3% probability.

    if fault_chance <= 3:

        fault = "OVERHEATING"


        # Overheating mein CHT increase hoga
        cht += 35


        # Exhaust Gas Temperature bhi increase hoga
        egt += 120


        # Oil temperature bhi increase hoga
        oil_temperature += 20


    # --------------------------------------------------------
    # MISFIRE
    # --------------------------------------------------------

    # 4 ya 5 aane par misfire inject hoga
    # Therefore approximately 2% probability.

    elif fault_chance <= 5:

        fault = "MISFIRE"


        # Misfire ki wajah se RPM unstable/drop ho sakta hai
        rpm -= random.uniform(300, 600)


        # Engine vibration significantly increase hogi
        vibration += random.uniform(0.5, 1.0)


        # Misfire mein EGT abnormal/drop ho sakta hai
        egt -= random.uniform(80, 150)


    # ========================================================
    # 3. CREATE TELEMETRY PAYLOAD
    # ========================================================

    # Ye wahi data hai jo ek real engine ke sensors
    # backend ko send karenge.

    data = {

        "engine_id": "ENGINE_001",

        # UTC timestamp use kar rahe hain
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
    # 4. SEND TELEMETRY TO FASTAPI
    # ========================================================

    try:

        # POST request ke through FastAPI ko data bhejo
        response = requests.post(
            API_URL,
            json=data
        )


        # Terminal mein useful information print karo
        print(
            f"Reading: {counter:03d} | "
            f"Fault: {fault:11s} | "
            f"RPM: {rpm:7.1f} | "
            f"CHT: {cht:6.1f} | "
            f"EGT: {egt:6.1f} | "
            f"Vibration: {vibration:.2f} | "
            f"Status: {response.status_code}"
        )


    except Exception as e:

        # Agar FastAPI server band hai ya connection problem hai
        print("Error sending telemetry:", e)


    # ========================================================
    # 5. WAIT 1 SECOND
    # ========================================================

    # Har second ek new sensor reading generate hogi
    time.sleep(1)