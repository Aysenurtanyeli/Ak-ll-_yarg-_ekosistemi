from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


def sync_session() -> Session:
    s = get_settings()
    url = s.database_url.replace("+asyncpg", "")
    eng = create_engine(url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=eng, autoflush=False, autocommit=False)
    return SessionLocal()
