import zlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func

from database import SessionLocal
from models import EngineSensorData, FaultEvent, EngineWearState, EngineWearHistory

from ML.fault_detector_v2 import detect_fault

# RUL feature (additive)
from ML import rul_estimator
from ML.rul_estimator import estimate_rul_seconds
from ML.rul_years import TREND_FLIGHTS, estimate_rul_years
from ML.generate_fleet_dataset import simulate_flight


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
    # STEP 0b: Short-term RUL
    # --------------------------------------------------------
    # observe() har reading par chalta hai (60 s trend window ko
    # anomaly se pehle ki readings bhi chahiye). Model sirf
    # ANOMALY par chalta hai.
    # --------------------------------------------------------

    rul_estimator.observe(data.model_dump(), detected_fault)

    rul = None

    if detected_fault["status"] == "ANOMALY":
        rul = estimate_rul_seconds(data.model_dump(), detected_fault["fault_type"])


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
    # rul fault ke andar bhi (frontend ka lib/readings.js sirf msg.fault rakhta hai)
    live_message["fault"] = {**detected_fault, "rul": rul}
    live_message["estimated_rul_seconds"] = rul["seconds"] if rul else None

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
            "sensors": detected_fault["sensors"],
            "estimated_rul_seconds": rul["seconds"] if rul else None,
            "rul": rul
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
                ),

                estimated_rul_seconds=rul["seconds"] if rul else None
            )

            db.add(fault_event)
            db.commit()
            db.refresh(fault_event)


            return {

                "message": "Sensor data stored and anomaly detected",

                "sensor_data_id": sensor_data.id,

                "fault_event_id": fault_event.id,

                "fault": detected_fault,

                "rul": rul
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
                "description": fault.description,
                "estimated_rul_seconds": fault.estimated_rul_seconds
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

# ============================================================
# FAULT EPISODES
# ============================================================
# Detector ek fault ke dauraan har second ek FaultEvent likhta
# hai, aur shuru mein UNKNOWN_ANOMALY bolta hai jab tak koi rule
# fault ka naam na bata de. Report ke liye un events ko episodes
# mein jodte hain: same engine, beech mein 30 s se kam gap
# (ML/train_rul_model.py ka STREAK_GAP_SECONDS bhi 30 s hai).
# ============================================================

EPISODE_GAP_SECONDS = 30

SEVERITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


def _fault_episodes(events):

    # events: FaultEvent rows ordered by engine_id, detected_at
    episodes = []

    for event in events:

        current = episodes[-1] if episodes else None

        if (
            current is None
            or current["engine_id"] != event.engine_id
            or (event.detected_at - current["_end"]).total_seconds() > EPISODE_GAP_SECONDS
        ):
            current = {
                "engine_id": event.engine_id,
                "_start": event.detected_at,
                "_end": event.detected_at,
                "_types": {},
                "_first_named": None,
                "severity": event.severity,
                "events": 0,
                "latest_rul_seconds": None,
            }
            episodes.append(current)

        current["_end"] = event.detected_at
        current["events"] += 1
        current["_types"][event.fault_type] = current["_types"].get(event.fault_type, 0) + 1
        current["latest_rul_seconds"] = event.estimated_rul_seconds

        if SEVERITY_RANK.get(event.severity, 0) > SEVERITY_RANK.get(current["severity"], 0):
            current["severity"] = event.severity

        if event.fault_type != "UNKNOWN_ANOMALY" and current["_first_named"] is None:
            current["_first_named"] = event.detected_at

    result = []

    for episode in episodes:

        named = {k: v for k, v in episode["_types"].items() if k != "UNKNOWN_ANOMALY"}
        start, end, first_named = episode["_start"], episode["_end"], episode["_first_named"]

        result.append({
            "engine_id": episode["engine_id"],
            # Named fault if a rule ever named it, else UNKNOWN_ANOMALY
            "fault_type": max(named, key=named.get) if named else "UNKNOWN_ANOMALY",
            "fault_types": list(episode["_types"]),
            "severity": episode["severity"],
            "start": start,
            "end": end,
            "duration_seconds": (end - start).total_seconds(),
            "events": episode["events"],
            # Seconds the detector flagged it before any rule could name it
            "early_warning_seconds": (
                (first_named - start).total_seconds() if first_named else None
            ),
            "latest_rul_seconds": episode["latest_rul_seconds"],
        })

    return result


@app.get("/fault-summary")
def get_fault_summary(
    engine_id: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    episodes: bool = False,
):

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Base query
        # ----------------------------------------------------

        counts = db.query(
            FaultEvent.fault_type,
            func.count(FaultEvent.id),
            func.min(FaultEvent.detected_at),
            func.max(FaultEvent.detected_at)
        )

        # ----------------------------------------------------
        # Optional filters
        # ----------------------------------------------------

        if engine_id:
            counts = counts.filter(
                FaultEvent.engine_id == engine_id
            )

        if start:
            counts = counts.filter(
                FaultEvent.detected_at >= start
            )

        if end:
            counts = counts.filter(
                FaultEvent.detected_at <= end
            )

        rows = (
            counts
            .group_by(FaultEvent.fault_type)
            .all()
        )

        # ----------------------------------------------------
        # Severity values for the filtered fault events
        # ----------------------------------------------------

        pairs = db.query(
            FaultEvent.fault_type,
            FaultEvent.severity
        ).distinct()

        if engine_id:
            pairs = pairs.filter(
                FaultEvent.engine_id == engine_id
            )

        if start:
            pairs = pairs.filter(
                FaultEvent.detected_at >= start
            )

        if end:
            pairs = pairs.filter(
                FaultEvent.detected_at <= end
            )

        severities = {}

        for fault_type, severity in pairs.all():
            severities.setdefault(
                fault_type,
                []
            ).append(severity)

        # ----------------------------------------------------
        # Build mission-specific fault summary
        # ----------------------------------------------------

        faults = []

        for (
            fault_type,
            count,
            first_seen,
            last_seen
        ) in rows:

            # Find the latest event for this fault type
            latest_query = (
                db.query(FaultEvent)
                .filter(
                    FaultEvent.fault_type == fault_type
                )
            )

            if engine_id:
                latest_query = latest_query.filter(
                    FaultEvent.engine_id == engine_id
                )

            if start:
                latest_query = latest_query.filter(
                    FaultEvent.detected_at >= start
                )

            if end:
                latest_query = latest_query.filter(
                    FaultEvent.detected_at <= end
                )

            latest_event = (
                latest_query
                .order_by(FaultEvent.detected_at.desc())
                .first()
            )

            faults.append(
                {
                    "fault_type": fault_type,
                    "count": count,
                    "first_seen": first_seen,
                    "last_seen": last_seen,
                    "severities": severities.get(
                        fault_type,
                        []
                    ),
                    "latest_rul_seconds": (
                        latest_event.estimated_rul_seconds
                        if latest_event
                        else None
                    ),
                }
            )

        # ----------------------------------------------------
        # Most frequently detected fault first
        # ----------------------------------------------------

        faults.sort(
            key=lambda fault: fault["count"],
            reverse=True
        )

        response = {
            "total_faults": sum(
                fault["count"]
                for fault in faults
            ),
            "fault_types": len(faults),
            "faults": faults,
        }

        # ----------------------------------------------------
        # Optional: fault events grouped into episodes
        # ----------------------------------------------------

        if episodes:

            events = db.query(FaultEvent)

            if engine_id:
                events = events.filter(FaultEvent.engine_id == engine_id)

            if start:
                events = events.filter(FaultEvent.detected_at >= start)

            if end:
                events = events.filter(FaultEvent.detected_at <= end)

            response["episodes"] = _fault_episodes(
                events.order_by(FaultEvent.engine_id, FaultEvent.detected_at).all()
            )

        return response

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
def get_sensor_history(
    limit: Optional[int] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None
):

    db = SessionLocal()

    try:

        # ----------------------------------------------------
        # Do modes:
        #
        # 1. start / end diye bina  -> purana behaviour:
        #    sabse nayi `limit` readings (default 50, max 500).
        #    Dashboard startup backfill isi ko use karta hai.
        #
        # 2. start / end ke saath   -> history replay window:
        #    us time range ki readings, puraani se nayi tak.
        #    Yahan limit bada hai (1 Hz par 1 ghanta = 3600).
        #
        # Naive datetime (bina timezone ke) ko UTC maan lete hain,
        # kyunki simulator UTC bhejta hai.
        # ----------------------------------------------------

        windowed = start is not None or end is not None

        if windowed:
            limit = 3600 if limit is None else limit
            limit = max(1, min(limit, 5000))
        else:
            limit = 50 if limit is None else limit
            limit = max(1, min(limit, 500))


        query = db.query(EngineSensorData)

        if start is not None:
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            query = query.filter(EngineSensorData.timestamp >= start)

        if end is not None:
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            query = query.filter(EngineSensorData.timestamp <= end)


        # ----------------------------------------------------
        # PostgreSQL se readings retrieve karo.
        # Window mode purani -> nayi (replay isi order mein
        # chalta hai), warna nayi -> purani (jaisa pehle tha).
        # ----------------------------------------------------

        if windowed:
            readings = (
                query
                .order_by(EngineSensorData.timestamp.asc())
                .limit(limit)
                .all()
            )
        else:
            readings = (
                query
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

            # Window ne limit ko chhu liya, matlab readings aur bhi hain.
            # Dashboard ise dikhata hai taaki aadha flight poora na lage.
            "truncated": windowed and len(result) >= limit,

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
# GET DATA RANGE
# ============================================================
# GET /data-range
#
# History replay ke date picker ke liye. Batata hai ki database
# mein data kab se kab tak hai, aur kis din kitni readings hain,
# taaki user khaali date select karke confuse na ho.
#
# Response:
#
# {
#   "first": "2026-09-18T09:12:04+00:00",
#   "last":  "2026-09-23T17:45:31+00:00",
#   "total_readings": 48210,
#   "days": [ {"date": "2026-09-23", "readings": 8400,
#              "first": "...", "last": "..."} ]
# }
#
# days newest-first aate hain, zyada se zyada 60 din.
# ============================================================

@app.get("/data-range")
def get_data_range(engine_id: Optional[str] = None):

    db = SessionLocal()

    try:

        query = db.query(EngineSensorData)

        if engine_id:
            query = query.filter(EngineSensorData.engine_id == engine_id)


        # ----------------------------------------------------
        # Overall span
        # ----------------------------------------------------

        first, last, total = (
            query
            .with_entities(
                func.min(EngineSensorData.timestamp),
                func.max(EngineSensorData.timestamp),
                func.count(EngineSensorData.id)
            )
            .one()
        )

        if total == 0:
            return {
                "first": None,
                "last": None,
                "total_readings": 0,
                "days": []
            }


        # ----------------------------------------------------
        # Per-day counts
        # ----------------------------------------------------

        day = func.date_trunc("day", EngineSensorData.timestamp).label("day")

        rows = (
            query
            .with_entities(
                day,
                func.count(EngineSensorData.id),
                func.min(EngineSensorData.timestamp),
                func.max(EngineSensorData.timestamp)
            )
            .group_by(day)
            .order_by(day.desc())
            .limit(60)
            .all()
        )

        days = [
            {
                "date": row[0].date().isoformat(),
                "readings": row[1],
                "first": row[2],
                "last": row[3]
            }
            for row in rows
        ]


        return {

            "first": first,

            "last": last,

            "total_readings": total,

            "days": days
        }


    except Exception as e:

        return {

            "message": "Failed to retrieve data range",

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


# ============================================================
# RUL FEATURE - ENDPOINTS
# ============================================================
# Short-term RUL (seconds to critical, per active fault):
#   computed in receive_sensor_data() above -> WebSocket + FaultEvent
#
# Long-term RUL (years, Palmgren-Miner cumulative wear):
#   POST /engine-wear/{engine_id}     {"wear": 0.0-1.0}  set wear by hand
#   POST /simulate-flight/{engine_id} ?flights=1         simulate flights, add their damage
#   GET  /rul-years/{engine_id}                          years of life left
#
# Wear sirf in POST endpoints se badalta hai - server restart ya
# sensor readings se kabhi nahi - taaki demo repeatable rahe.
# ============================================================

class EngineWearRequest(BaseModel):

    wear: float = Field(ge=0.0, le=1.0)


def _flight_seed(engine_id, flight_index):

    # Same engine + same flight number -> same simulated flight (reproducible demos)
    return (zlib.crc32(engine_id.encode()) % 1_000_000) * 100_000 + flight_index


def _wear_history(db, engine_id):

    rows = (
        db.query(EngineWearHistory)
        .filter(EngineWearHistory.engine_id == engine_id)
        .order_by(EngineWearHistory.flight_num.desc())
        .limit(TREND_FLIGHTS)
        .all()
    )

    return [
        {
            "flight_num": row.flight_num,
            "damage_this_flight": row.damage_this_flight,
            "fault_count_this_flight": row.fault_count_this_flight,
            "mean_cht": row.mean_cht,
            "mean_vibration": row.mean_vibration,
            "max_vibration": row.max_vibration,
        }
        for row in reversed(rows)
    ]


def _rul_years_payload(db, engine_id):

    state = db.get(EngineWearState, engine_id)
    wear = state.cumulative_wear if state else 0.0
    history = _wear_history(db, engine_id)

    return {
        "engine_id": engine_id,
        "cumulative_wear": round(wear, 4),
        "wear_recorded": state is not None,
        "flights_logged": state.flights_logged if state else 0,
        "last_updated": state.last_updated if state else None,
        "recent_flights": len(history),
        "recent_damage_per_flight": (
            round(sum(h["damage_this_flight"] for h in history[-10:]) / len(history[-10:]), 5)
            if history else None
        ),
        "rul": estimate_rul_years(wear, history)
    }


@app.post("/engine-wear/{engine_id}")
def set_engine_wear(engine_id: str, body: EngineWearRequest):

    db = SessionLocal()

    try:

        now = datetime.now(timezone.utc)
        state = db.get(EngineWearState, engine_id)

        if state is None:
            state = EngineWearState(engine_id=engine_id, cumulative_wear=0.0, flights_logged=0, last_updated=now)
            db.add(state)

        # Hand-set wear: purani flight history is wear se match nahi karti, isliye clear.
        # flights_logged bhi 0, taaki "set wear -> simulate" har baar same result de.
        db.query(EngineWearHistory).filter(EngineWearHistory.engine_id == engine_id).delete()

        state.cumulative_wear = body.wear
        state.flights_logged = 0
        state.last_updated = now

        db.commit()

        return {"message": "Engine wear set", **_rul_years_payload(db, engine_id)}

    except Exception as e:

        db.rollback()
        return {"message": "Failed to set engine wear", "error": str(e)}

    finally:

        db.close()


@app.post("/simulate-flight/{engine_id}")
def simulate_engine_flight(engine_id: str, flights: int = 1):

    flights = max(1, min(flights, 200))

    db = SessionLocal()

    try:

        now = datetime.now(timezone.utc)
        state = db.get(EngineWearState, engine_id)

        if state is None:
            state = EngineWearState(engine_id=engine_id, cumulative_wear=0.0, flights_logged=0, last_updated=now)
            db.add(state)

        summaries = []

        for _ in range(flights):

            if state.cumulative_wear >= 1.0:
                break

            flight = simulate_flight(state.cumulative_wear, _flight_seed(engine_id, state.flights_logged))

            before = state.cumulative_wear
            state.cumulative_wear = before + flight["damage_this_flight"]
            state.flights_logged += 1

            db.add(EngineWearHistory(
                engine_id=engine_id,
                flight_num=state.flights_logged,
                wear_before=before,
                wear_after=state.cumulative_wear,
                damage_this_flight=flight["damage_this_flight"],
                flight_hours=flight["flight_hours"],
                mean_cht=flight["mean_cht"],
                mean_vibration=flight["mean_vibration"],
                max_vibration=flight["max_vibration"],
                hours_above_cht_limit=flight["hours_above_cht_limit"],
                fault_count_this_flight=flight["fault_count_this_flight"],
                fault_type=flight["fault_type"] or None,
                recorded_at=now
            ))

            summaries.append({"flight_num": state.flights_logged, **flight})

        state.last_updated = now
        db.commit()

        return {
            "message": f"Simulated {len(summaries)} flight(s)" + (
                "" if len(summaries) == flights else " - engine reached end of life"
            ),
            "flights": summaries[-10:],
            **_rul_years_payload(db, engine_id)
        }

    except Exception as e:

        db.rollback()
        return {"message": "Failed to simulate flight", "error": str(e)}

    finally:

        db.close()


@app.get("/rul-years/{engine_id}")
def get_rul_years(engine_id: str):

    db = SessionLocal()

    try:
        return _rul_years_payload(db, engine_id)

    except Exception as e:
        return {"message": "Failed to estimate engine life", "error": str(e)}

    finally:
        db.close()
