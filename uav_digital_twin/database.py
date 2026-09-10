import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


# .env file load karo
load_dotenv()

# Database URL read karo
DATABASE_URL = os.getenv("DATABASE_URL")


# PostgreSQL ke saath SQLAlchemy engine
engine = create_engine(DATABASE_URL)


# Database Session create karne ka setup
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False
)