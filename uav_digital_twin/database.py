import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import Base


load_dotenv()


# SQLite database file
DATABASE_URL = os.getenv( "DATABASE_URL" , "sqlite:///./uav_digital_twin.db")


# SQLite engine
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args
)

# Database session
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)


# Tables create karo agar pehle se nahi hain
Base.metadata.create_all(bind=engine)