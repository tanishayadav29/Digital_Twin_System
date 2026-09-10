from typing import Optional
from datetime import datetime

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, DateTime, Float, Text


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