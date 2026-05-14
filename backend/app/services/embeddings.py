import httpx

from app.config import get_settings


async def _embed_with_ollama(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    url = f"{settings.ollama_base_url.rstrip('/')}/api/embed"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                url,
                json={"model": settings.embedding_model, "input": texts},
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500]
        raise RuntimeError(
            f"Ollama embedding modeli calisamadi. Modeli indirin: ollama pull {settings.embedding_model}. Detay: {detail}"
        ) from e
    except httpx.RequestError as e:
        raise RuntimeError(
            "Ollama servisine ulasilamadi. Once Ollama'yi acin ve modeli indirin: "
            f"ollama pull {settings.embedding_model}"
        ) from e

    data = resp.json()
    embeddings = data.get("embeddings")
    if isinstance(embeddings, list) and len(embeddings) == len(texts):
        return embeddings

    # Eski Ollama surumleri yalnizca tekli /api/embeddings endpointini destekleyebilir.
    vectors: list[list[float]] = []
    fallback_url = f"{settings.ollama_base_url.rstrip('/')}/api/embeddings"
    async with httpx.AsyncClient(timeout=120.0) as client:
        for text in texts:
            resp = await client.post(
                fallback_url,
                json={"model": settings.embedding_model, "prompt": text},
            )
            resp.raise_for_status()
            vector = resp.json().get("embedding")
            if not isinstance(vector, list):
                raise RuntimeError("Ollama embedding cevabi beklenen formatta degil.")
            vectors.append(vector)
    return vectors


async def embed_texts(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    provider = settings.embedding_provider.lower().strip()
    if provider == "ollama":
        return await _embed_with_ollama(texts)
    raise RuntimeError(f"Desteklenmeyen embedding provider: {settings.embedding_provider}")
