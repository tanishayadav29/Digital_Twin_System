import numpy as np
from sklearn.ensemble import IsolationForest
import joblib
import os


# ============================================================
# 1. GENERATE NORMAL ENGINE DATA
# ============================================================

np.random.seed(42)

number_of_samples = 1000

normal_data = np.column_stack([

    np.random.normal(2800, 50, number_of_samples),     # RPM
    np.random.normal(185, 2, number_of_samples),       # CHT
    np.random.normal(720, 10, number_of_samples),      # EGT
    np.random.normal(45, 2, number_of_samples),        # Oil Pressure
    np.random.normal(90, 2, number_of_samples),        # Oil Temperature
    np.random.normal(12, 0.5, number_of_samples),      # Fuel Flow
    np.random.normal(0.30, 0.05, number_of_samples),   # Vibration
    np.random.normal(24.5, 0.3, number_of_samples),    # Battery Voltage
    np.random.normal(8, 0.5, number_of_samples),       # Alternator Current
    np.random.normal(12, 0.5, number_of_samples)       # Injection Timing

])


# ============================================================
# 2. CREATE ISOLATION FOREST
# ============================================================

model = IsolationForest(
    n_estimators=100,
    contamination=0.05,
    random_state=42
)


# ============================================================
# 3. TRAIN MODEL
# ============================================================

model.fit(normal_data)


print("Isolation Forest training completed!")
print("Training samples:", number_of_samples)


# ============================================================
# 4. SAVE MODEL
# ============================================================

os.makedirs("ML/models", exist_ok=True)

model_path = "ML/models/isolation_forest.pkl"

joblib.dump(model, model_path)

print("Model saved successfully!")
print("Path:", model_path)