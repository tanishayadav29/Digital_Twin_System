from sqlalchemy import inspect, text

from database import engine
from models import Base, EngineWearHistory, EngineWearState


# ============================================================
# ONE-TIME DB MIGRATION FOR THE RUL FEATURE
# ============================================================
# The project has no Alembic / create_all, so new columns and
# tables are not created automatically. Run this once:
#
#   python migrate_rul.py
#
# Safe to run again (only adds what is missing):
#   1. fault_events.estimated_rul_seconds  (nullable float)
#   2. engine_wear_state                   (new table)
#   3. engine_wear_history                 (new table)
# Existing tables and rows are not touched.
# ============================================================


def main():

    inspector = inspect(engine)
    tables = inspector.get_table_names()

    if "fault_events" in tables:
        columns = {c["name"] for c in inspector.get_columns("fault_events")}
        if "estimated_rul_seconds" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE fault_events ADD COLUMN estimated_rul_seconds DOUBLE PRECISION"))
            print("added fault_events.estimated_rul_seconds")
        else:
            print("fault_events.estimated_rul_seconds already there")
    else:
        print("fault_events table not found - create your base tables first")

    Base.metadata.create_all(engine, tables=[EngineWearState.__table__, EngineWearHistory.__table__])
    print("engine_wear_state / engine_wear_history ready")


if __name__ == "__main__":
    main()
