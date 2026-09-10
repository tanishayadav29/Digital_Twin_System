import numpy as np
import joblib


# ============================================================
# LOAD TRAINED MODEL
# ============================================================

model = joblib.load("ML/models/isolation_forest.pkl")


# ============================================================
# NORMAL SENSOR READING
# ============================================================

normal_reading = np.array([[
    2800,    # RPM
    185,     # CHT
    720,     # EGT
    45,      # Oil Pressure
    90,      # Oil Temperature
    12,      # Fuel Flow
    0.30,    # Vibration
    24.5,    # Battery Voltage
    8,       # Alternator Current
    12       # Injection Timing
]])


# ============================================================
# OVERHEATING READING
# ============================================================

overheating_reading = np.array([[
    2800,    # RPM
    225,     # CHT
    850,     # EGT
    45,      # Oil Pressure
    115,     # Oil Temperature
    12,      # Fuel Flow
    0.30,    # Vibration
    24.5,    # Battery Voltage
    8,       # Alternator Current
    12       # Injection Timing
]])


# ============================================================
# PREDICTION
# ============================================================

normal_prediction = model.predict(normal_reading)
overheating_prediction = model.predict(overheating_reading)


# ============================================================
# RESULT
# ============================================================

print("Normal reading prediction:", normal_prediction[0])
print("Overheating reading prediction:", overheating_prediction[0])


if normal_prediction[0] == 1:
    print("Normal reading → NORMAL")
else:
    print("Normal reading → ANOMALY")


if overheating_prediction[0] == -1:
    print("Overheating reading → ANOMALY")
else:
    print("Overheating reading → NORMAL")