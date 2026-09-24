from typing import Optional
from datetime import datetime

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, Float, Integer, Text


# ============================================================
# BASE CLASS
# ============================================================

# Database ke saare models isi Base class se inherit karenge.
class Base(DeclarativeBase):
    pass


# ============================================================
# TABLE 1: ENGINE SENSOR DATA
# ============================================================

class EngineSensorData(Base):

    __tablename__ = "engine_sensor_data"


    # --------------------------------------------------------
    # Primary Key
    # --------------------------------------------------------

    id: Mapped[int] = mapped_column(
        primary_key=True
    )


    # --------------------------------------------------------
    # Engine Information
    # --------------------------------------------------------

    engine_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )


    # --------------------------------------------------------
    # Timestamp
    # --------------------------------------------------------

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )


    # --------------------------------------------------------
    # Sensor Readings
    # --------------------------------------------------------

    rpm: Mapped[Optional[float]] = mapped_column(Float)

    cht: Mapped[Optional[float]] = mapped_column(Float)

    egt: Mapped[Optional[float]] = mapped_column(Float)

    oil_pressure: Mapped[Optional[float]] = mapped_column(Float)

    oil_temperature: Mapped[Optional[float]] = mapped_column(Float)

    fuel_flow: Mapped[Optional[float]] = mapped_column(Float)

    vibration: Mapped[Optional[float]] = mapped_column(Float)

    battery_voltage: Mapped[Optional[float]] = mapped_column(Float)

    alternator_current: Mapped[Optional[float]] = mapped_column(Float)

    injection_timing: Mapped[Optional[float]] = mapped_column(Float)


# ============================================================
# TABLE 2: FAULT EVENTS
# ============================================================

class FaultEvent(Base):

    __tablename__ = "fault_events"


    # --------------------------------------------------------
    # Primary Key
    # --------------------------------------------------------

    id: Mapped[int] = mapped_column(
        primary_key=True
    )


    # --------------------------------------------------------
    # Engine Information
    # --------------------------------------------------------

    # Kis engine mein fault detect hua?
    engine_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )


    # --------------------------------------------------------
    # Fault Type
    # --------------------------------------------------------

    # Example:
    # OVERHEATING
    # MISFIRE
    # LOW_OIL_PRESSURE
    # HIGH_VIBRATION
    # FUEL_ANOMALY
    # ELECTRICAL_FAULT

    fault_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False
    )


    # --------------------------------------------------------
    # Severity
    # --------------------------------------------------------

    # Example:
    # LOW
    # MEDIUM
    # HIGH
    # CRITICAL

    severity: Mapped[str] = mapped_column(
        String(20),
        nullable=False
    )


    # --------------------------------------------------------
    # Detection Time
    # --------------------------------------------------------

    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )


    # --------------------------------------------------------
    # Detection Confidence
    # --------------------------------------------------------

    # Detection system kitna confident hai.
    # Example: 0.95 = 95% confidence

    confidence: Mapped[Optional[float]] = mapped_column(
        Float
    )


    # --------------------------------------------------------
    # Fault Description
    # --------------------------------------------------------

    # Fault ka short explanation
    description: Mapped[Optional[str]] = mapped_column(
        Text
    )


    # --------------------------------------------------------
    # Short-term RUL (ML/rul_estimator.py)
    # --------------------------------------------------------

    # Seconds until this fault was estimated to reach ACTIVE /
    # critical, at the moment it was detected. NULL = no estimate
    # (older rows, or RUL model not trained).
    estimated_rul_seconds: Mapped[Optional[float]] = mapped_column(
        Float,
        nullable=True
    )


# ============================================================
# TABLE 3: ENGINE WEAR STATE (long-term RUL)
# ============================================================
# Palmgren-Miner cumulative damage per engine: 0 = new, 1.0 = end
# of life. Changes ONLY through POST /engine-wear/{engine_id} or
# POST /simulate-flight/{engine_id} - never on restart and never on
# sensor readings - so demos are reproducible.

class EngineWearState(Base):

    __tablename__ = "engine_wear_state"

    engine_id: Mapped[str] = mapped_column(
        String(50),
        primary_key=True
    )

    cumulative_wear: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0
    )

    # Flights simulated on this engine (seeds the next simulated flight)
    flights_logged: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0
    )

    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )


# ============================================================
# TABLE 4: ENGINE WEAR HISTORY (one row per simulated flight)
# ============================================================
# The "trend" for GET /rul-years: damage per flight, faults, CHT and
# vibration of the last flights. POST /engine-wear clears it (a hand-
# set wear has no matching flight history).

class EngineWearHistory(Base):

    __tablename__ = "engine_wear_history"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    engine_id: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True
    )

    flight_num: Mapped[int] = mapped_column(Integer, nullable=False)

    wear_before: Mapped[float] = mapped_column(Float, nullable=False)
    wear_after: Mapped[float] = mapped_column(Float, nullable=False)
    damage_this_flight: Mapped[float] = mapped_column(Float, nullable=False)

    flight_hours: Mapped[Optional[float]] = mapped_column(Float)
    mean_cht: Mapped[Optional[float]] = mapped_column(Float)
    mean_vibration: Mapped[Optional[float]] = mapped_column(Float)
    max_vibration: Mapped[Optional[float]] = mapped_column(Float)
    hours_above_cht_limit: Mapped[Optional[float]] = mapped_column(Float)
    fault_count_this_flight: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fault_type: Mapped[Optional[str]] = mapped_column(String(50))

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False
    )
