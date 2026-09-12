from datetime import datetime
from typing import Optional

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import func

from database import SessionLocal
from models import EngineSensorData, FaultEvent

from ML.fault_detector_v2 import detect_fault


app = FastAPI(
    title="UAV Digital Twin Backend",
    description="Backend API for MALE UAV Aero Piston Engine Digital Twin",
    version="1.0.0"
)


# ============================================================
# LIVE TELEMETRY WEBSOCKET
# ============================================================
# Dashboard (React) is WebSocket se connect hota hai:
#
# ws://127.0.0.1:8000/ws/telemetry
#
# Jaise hi simulator POST /sensor-data bhejta hai,
# wahi reading turant saare connected dashboards ko
# broadcast ho jaati hai. Dashboard ko poll nahi karna padta.
# ============================================================

class TelemetryBroadcaster:

    def __init__(self):
        self.connections = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.connections.discard(websocket)

    async def broadcast(self, message: dict):
        for websocket in list(self.connections):
            try:
                await websocket.send_json(message)
            except Exception:
                # Band ho chuka dashboard list se hata do
                self.disconnect(websocket)


broadcaster = TelemetryBroadcaster()


@app.websocket("/ws/telemetry")
async def telemetry_stream(websocket: WebSocket):

    await broadcaster.connect(websocket)

    try:
        # Connection open rakho jab tak dashboard khud disconnect na kare
        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass

    finally:
        broadcaster.disconnect(websocket)


# ============================================================
# SENSOR DATA INPUT MODEL
# ============================================================
# Ye define karta hai ki simulator/backend ko kaunsa
# sensor data receive hoga.
#
# Sabhi sensor values Optional hain because prototype mein
# kabhi-kabhi koi sensor reading missing bhi ho sakti hai.
# ============================================================

class SensorDataRequest(BaseModel):

    engine_id: str
    timestamp: datetime

    rpm: Optional[float] = None
    cht: Optional[float] = None
    egt: Optional[float] = None
    oil_pressure: Optional[float] = None
    oil_temperature: Optional[float] = None
    fuel_flow: Optional[float] = None
    vibration: Optional[float] = None
    battery_voltage: Optional[float] = None
    alternator_current: Optional[float] = None
    injection_timing: Optional[float] = None


# ============================================================
# HOME ROUTE
# ============================================================

@app.get("/")
def home():

    return {
        "message": "UAV Digital Twin Backend is running!"
    }


# ============================================================
# SENSOR DATA API
# ============================================================
@app.post("/sensor-data")
def receive_sensor_data(data: SensorDataRequest):

    # --------------------------------------------------------
    # STEP 0: ML fault detector
    # --------------------------------------------------------
    # Isolation Forest + fault rules (ML/fault_detector.py).
    # Yahi result DB aur live dashboard dono ke liye use hota hai.
    # --------------------------------------------------------

    detected_fault = detect_fault(data.model_dump())


    # --------------------------------------------------------
    # STEP 1: Live dashboards par broadcast
    # --------------------------------------------------------
    # Reading (aur anomaly mili toh alert bhi) turant saare
    # dashboards ko bhejo. DB write se pehle, taaki DB slow ho
    # tab bhi dashboard live chalta rahe.
    #
    # Note: ye function sync (def) hai aur threadpool mein
    # chalta hai, isliye async broadcast ko
    # anyio.from_thread.run se call kar rahe hain.
    # --------------------------------------------------------

    live_message = data.model_dump(mode="json")
    live_message["type"] = "reading"
    live_message["fault"] = detected_fault

    anyio.from_thread.run(broadcaster.broadcast, live_message)

    if detected_fault["status"] == "ANOMALY":

        # Dashboard ka alert panel isi message se alert banata hai
        anomaly_message = {
            "type": "anomaly",
            "engine_id": data.engine_id,
            "timestamp": live_message["timestamp"],
            "fault_type": detected_fault["fault_type"],
            "severity": detected_fault["severity"],
            "anomaly_score": detected_fault["anomaly_score"],
            "model_prediction": detected_fault["model_prediction"],
            "sensors": detected_fault["sensors"]
        }

        anyio.from_thread.run(broadcaster.broadcast, anomaly_message)

    db = SessionLocal()

    try:

        # ====================================================
        # STEP 2: Sensor data database mein save karo
        # ====================================================

        sensor_data = EngineSensorData(

            engine_id=data.engine_id,
            timestamp=data.timestamp,

            rpm=data.rpm,
            cht=data.cht,
            egt=data.egt,
            oil_pressure=data.oil_pressure,
            oil_temperature=data.oil_temperature,
            fuel_flow=data.fuel_flow,
            vibration=data.vibration,
            battery_voltage=data.battery_voltage,
            alternator_current=data.alternator_current,
            injection_timing=data.injection_timing
        )

        db.add(sensor_data)
        db.commit()
        db.refresh(sensor_data)


        # ====================================================
        # STEP 3: Agar anomaly detect hui
        # ====================================================

        if detected_fault["status"] == "ANOMALY":

            fault_event = FaultEvent(

                engine_id=data.engine_id,

                fault_type=detected_fault["fault_type"],

                severity=detected_fault["severity"],

                detected_at=data.timestamp,

                confidence=abs(
                    detected_fault["anomaly_score"]
                ),

                description=(
                    f"ML detected {detected_fault['fault_type']}"
                )
            )

            db.add(fault_event)
            db.commit()
            db.refresh(fault_event)


            return {

                "message": "Sensor data stored and anomaly detected",

                "sensor_data_id": sensor_data.id,

                "fault_event_id": fault_event.id,

                "fault": detected_fault
            }


        # ====================================================
        # STEP 4: Normal reading
        # ====================================================

        return {

            "message": "Sensor data stored successfully",

            "sensor_data_id": sensor_data.id,

            "fault": detected_fault
        }


    except Exception as e:

        db.rollback()

        return {

            "message": "Failed to process sensor data",

            "error": str(e)
        }


    finally:

        db.close()

# ============================================================
# GET RECENT FAULT EVENTS
# ============================================================
# Dashboard is endpoint ko call karke recent detected faults
# dekh sakta hai.
#
# Example:
# GET /fault-events
#
# Backend PostgreSQL se latest fault events nikalega.
# ============================================================

@app.get("/fault-events")
def get_fault_events():

    db = SessionLocal()

    try:

        # Latest 20 detected faults
        faults = (
            db.query(FaultEvent)
            .order_by(FaultEvent.id.desc())
            .limit(20)
            .all()
        )

        result = []

        for fault in faults:

            result.append({
                "id": fault.id,
                "engine_id": fault.engine_id,
                "fault_type": fault.fault_type,
                "severity": fault.severity,
                "detected_at": fault.detected_at,
                "confidence": fault.confidence,
                "description": fault.description
            })

        return {
            "total_faults": len(result),
            "fault_events": result
        }

    except Exception as e:

        return {
            "message": "Failed to retrieve fault events",
            "error": str(e)
        }

    finally:

        db.close()

# ============================================================
# GET FAULT SUMMARY
# ============================================================
# GET /fault-summary
#
# Har fault type ka summary: kitni baar aaya, pehli aur aakhri
# baar kab, aur kaun kaun si severity ke saath.
#
# Dashboard ka "Maintenance advisory" tab isse decide karta hai
# ki kaun sa advisory sabse upar dikhana hai (baar-baar aane
# wala fault = zyada zaroori).
# ============================================================

@app.get("/fault-summary")
def get_fault_summary(engine_id: Optional[str] = None):

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Count + pehla / aakhri occurrence, fault type ke hisaab se
        # ----------------------------------------------------

        counts = db.query(
            FaultEvent.fault_type,
            func.count(FaultEvent.id),
            func.min(FaultEvent.detected_at),
            func.max(FaultEvent.detected_at)
        )

        if engine_id:
            counts = counts.filter(FaultEvent.engine_id == engine_id)

        rows = counts.group_by(FaultEvent.fault_type).all()


        # ----------------------------------------------------
        # Ek fault type alag-alag severity ke saath aa sakta hai
        # ----------------------------------------------------

        pairs = db.query(FaultEvent.fault_type, FaultEvent.severity).distinct()

        if engine_id:
            pairs = pairs.filter(FaultEvent.engine_id == engine_id)

        severities = {}

        for fault_type, severity in pairs.all():
            severities.setdefault(fault_type, []).append(severity)


        faults = [
            {
                "fault_type": fault_type,
                "count": count,
                "first_seen": first_seen,
                "last_seen": last_seen,
                "severities": severities.get(fault_type, [])
            }
            for fault_type, count, first_seen, last_seen in rows
        ]

        faults.sort(key=lambda fault: fault["count"], reverse=True)

        return {
            "total_faults": sum(fault["count"] for fault in faults),
            "fault_types": len(faults),
            "faults": faults
        }

    except Exception as e:

        return {
            "message": "Failed to summarise fault events",
            "error": str(e)
        }

    finally:

        db.close()

# ============================================================
# GET LATEST SENSOR DATA
# ============================================================
# GET /latest-sensor-data
#
# Dashboard ko engine ki latest sensor reading provide karega.
#
# Flow:
#
# PostgreSQL
#     ↓
# Latest sensor row
#     ↓
# FastAPI
#     ↓
# Dashboard
# ============================================================

@app.get("/latest-sensor-data")
def get_latest_sensor_data():

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Latest reading retrieve karo
        # ORDER BY id DESC means newest row first
        # LIMIT 1 means sirf latest reading
        # ----------------------------------------------------

        latest = (
            db.query(EngineSensorData)
            .order_by(EngineSensorData.id.desc())
            .first()
        )

        # Agar database mein koi reading nahi hai
        if latest is None:

            return {
                "message": "No sensor data available"
            }

        # ----------------------------------------------------
        # Latest sensor data dashboard ko return karo
        # ----------------------------------------------------

        return {

            "id": latest.id,

            "engine_id": latest.engine_id,

            "timestamp": latest.timestamp,

            "sensors": {

                "rpm": latest.rpm,

                "cht": latest.cht,

                "egt": latest.egt,

                "oil_pressure": latest.oil_pressure,

                "oil_temperature": latest.oil_temperature,

                "fuel_flow": latest.fuel_flow,

                "vibration": latest.vibration,

                "battery_voltage": latest.battery_voltage,

                "alternator_current": latest.alternator_current,

                "injection_timing": latest.injection_timing
            }
        }

    except Exception as e:

        return {

            "message": "Failed to retrieve latest sensor data",

            "error": str(e)
        }

    finally:

        db.close()

# ============================================================
# GET SENSOR HISTORY
# ============================================================
# GET /sensor-history
#
# Ye endpoint PostgreSQL se recent sensor readings retrieve
# karega.
#
# Dashboard later in readings ko use karke:
# - RPM graph
# - CHT graph
# - EGT graph
# - Oil pressure graph
# - Vibration graph
# etc. bana sakta hai.
#
# Default: latest 50 readings
# ============================================================

@app.get("/sensor-history")
def get_sensor_history(limit: int = 50):

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Safety:
        # User bahut bada limit na bhej sake.
        # Maximum 500 readings allow kar rahe hain.
        # ----------------------------------------------------

        if limit < 1:
            limit = 1

        if limit > 500:
            limit = 500


        # ----------------------------------------------------
        # PostgreSQL se latest readings retrieve karo
        # ----------------------------------------------------

        readings = (
            db.query(EngineSensorData)
            .order_by(EngineSensorData.id.desc())
            .limit(limit)
            .all()
        )


        result = []

        # ----------------------------------------------------
        # Har database row ko JSON-friendly format mein convert
        # karo.
        # ----------------------------------------------------

        for reading in readings:

            result.append({

                "id": reading.id,

                "engine_id": reading.engine_id,

                "timestamp": reading.timestamp,

                "rpm": reading.rpm,

                "cht": reading.cht,

                "egt": reading.egt,

                "oil_pressure": reading.oil_pressure,

                "oil_temperature": reading.oil_temperature,

                "fuel_flow": reading.fuel_flow,

                "vibration": reading.vibration,

                "battery_voltage": reading.battery_voltage,

                "alternator_current": reading.alternator_current,

                "injection_timing": reading.injection_timing
            })


        return {

            "total_readings": len(result),

            "readings": result
        }


    except Exception as e:

        return {

            "message": "Failed to retrieve sensor history",

            "error": str(e)
        }


    finally:

        db.close()

# ============================================================
# GET ENGINE HEALTH STATUS
# ============================================================
# GET /engine-health
#
# Ye endpoint latest sensor reading ko analyse karke
# overall engine health batayega.
#
# Possible states:
#
# NORMAL   -> Engine operating normally
# WARNING  -> Kuch abnormal parameters hain
# CRITICAL -> Serious fault condition detected
#
# Ye abhi rule-based health assessment hai.
# Later ML model ka anomaly score bhi yahan integrate
# kiya ja sakta hai.
# ============================================================

@app.get("/engine-health")
def get_engine_health():

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # STEP 1: Latest sensor reading retrieve karo
        # ----------------------------------------------------

        latest = (
            db.query(EngineSensorData)
            .order_by(EngineSensorData.id.desc())
            .first()
        )

        # Database empty hai
        if latest is None:

            return {
                "engine_id": None,
                "health_status": "NO_DATA",
                "message": "No sensor data available."
            }


        # ----------------------------------------------------
        # STEP 2: Health status initially NORMAL maan lo
        # ----------------------------------------------------

        health_status = "NORMAL"

        warnings = []
        critical_issues = []


        # ----------------------------------------------------
        # STEP 3: TEMPERATURE CHECK
        # ----------------------------------------------------

        if latest.cht is not None:

            if latest.cht > 220:

                critical_issues.append(
                    "Critical CHT temperature detected."
                )

            elif latest.cht > 205:

                warnings.append(
                    "High CHT temperature detected."
                )


        if latest.egt is not None:

            if latest.egt > 830:

                critical_issues.append(
                    "Critical EGT temperature detected."
                )

            elif latest.egt > 780:

                warnings.append(
                    "High EGT temperature detected."
                )


        # ----------------------------------------------------
        # STEP 4: OIL PRESSURE CHECK
        # ----------------------------------------------------

        if latest.oil_pressure is not None:

            if latest.oil_pressure < 25:

                critical_issues.append(
                    "Critically low oil pressure detected."
                )

            elif latest.oil_pressure < 30:

                warnings.append(
                    "Low oil pressure detected."
                )


        # ----------------------------------------------------
        # STEP 5: VIBRATION CHECK
        # ----------------------------------------------------

        if latest.vibration is not None:

            if latest.vibration > 1.0:

                critical_issues.append(
                    "Critically high engine vibration detected."
                )

            elif latest.vibration > 0.7:

                warnings.append(
                    "High engine vibration detected."
                )


        # ----------------------------------------------------
        # STEP 6: ELECTRICAL SYSTEM CHECK
        # ----------------------------------------------------

        if latest.battery_voltage is not None:

            if latest.battery_voltage < 21:

                critical_issues.append(
                    "Critically low battery voltage detected."
                )

            elif latest.battery_voltage < 22.5:

                warnings.append(
                    "Low battery voltage detected."
                )


        if latest.alternator_current is not None:

            if latest.alternator_current < 4:

                critical_issues.append(
                    "Critically low alternator current detected."
                )

            elif latest.alternator_current < 5:

                warnings.append(
                    "Low alternator current detected."
                )


        # ----------------------------------------------------
        # STEP 7: FUEL FLOW CHECK
        # ----------------------------------------------------

        if latest.fuel_flow is not None:

            if latest.fuel_flow > 17:

                critical_issues.append(
                    "Abnormally high fuel flow detected."
                )

            elif latest.fuel_flow > 15:

                warnings.append(
                    "High fuel flow detected."
                )


        # ----------------------------------------------------
        # STEP 8: FINAL HEALTH STATUS
        # ----------------------------------------------------
        #
        # Critical issue mila:
        #       CRITICAL
        #
        # Otherwise warning mila:
        #       WARNING
        #
        # Kuch bhi abnormal nahi:
        #       NORMAL
        # ----------------------------------------------------

        if len(critical_issues) > 0:

            health_status = "CRITICAL"

        elif len(warnings) > 0:

            health_status = "WARNING"


        # ----------------------------------------------------
        # STEP 9: RESPONSE
        # ----------------------------------------------------

        return {

            "engine_id": latest.engine_id,

            "timestamp": latest.timestamp,

            "health_status": health_status,

            "warnings": warnings,

            "critical_issues": critical_issues,

            "sensor_snapshot": {

                "rpm": latest.rpm,

                "cht": latest.cht,

                "egt": latest.egt,

                "oil_pressure": latest.oil_pressure,

                "oil_temperature": latest.oil_temperature,

                "fuel_flow": latest.fuel_flow,

                "vibration": latest.vibration,

                "battery_voltage": latest.battery_voltage,

                "alternator_current": latest.alternator_current,

                "injection_timing": latest.injection_timing
            }
        }


    except Exception as e:

        return {

            "message": "Failed to calculate engine health",

            "error": str(e)
        }


    finally:

        db.close()

@app.post("/sensor-data-ml")
def receive_sensor_data_ml(data: SensorDataRequest):

    result = detect_fault(data.model_dump())

    return {
        "engine_id": data.engine_id,
        "timestamp": data.timestamp,
        "fault_detection": result
    }

