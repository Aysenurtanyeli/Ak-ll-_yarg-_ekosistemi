from openai import AsyncOpenAI

from app.config import get_settings


async def embed_texts(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key or None)
    resp = await client.embeddings.create(model=settings.embedding_model, input=texts)
    return [d.embedding for d in resp.data]
