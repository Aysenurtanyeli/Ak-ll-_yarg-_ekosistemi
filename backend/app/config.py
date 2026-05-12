from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://lexiguard:lexiguard@localhost:5432/lexiguard"

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o"

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
