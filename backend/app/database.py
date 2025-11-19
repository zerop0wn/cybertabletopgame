"""Database setup using SQLModel."""
from sqlmodel import SQLModel, create_engine, Session
from typing import Generator
import os

# SQLite database path
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/pewpew.db")

engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})


def init_db():
    """Initialize database tables."""
    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """Dependency for getting database session."""
    with Session(engine) as session:
        yield session

