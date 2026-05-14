from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://lexiguard:lexiguard@localhost:5432/lexiguard"

    embedding_provider: str = "ollama"
    embedding_model: str = "nomic-embed-text"
    embedding_dimension: int = 768
    ollama_base_url: str = "http://127.0.0.1:11434"
    chat_provider: str = "ollama"
    chat_model: str = "gemma3:4b"
    vision_model: str = "gemma3:4b"

    vector_store_provider: str = "local"
    local_vector_store_path: str = str(PROJECT_DIR / "backend" / "data" / "vectors.json")

    pinecone_api_key: str = ""
    pinecone_index_name: str = "lexiguard"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"

    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/0"

    regu_rss_feeds: str = ""
    regu_similarity_threshold: float = 0.8

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
