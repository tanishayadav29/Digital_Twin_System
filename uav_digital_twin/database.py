import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base


# SQLite database file
DATABASE_URL = "sqlite:///./uav_digital_twin.db"


# SQLite engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)


# Database session
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)


# Tables create karo agar pehle se nahi hain
Base.metadata.create_all(bind=engine)