import httpx
import base64

from app.config import get_settings


async def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
) -> str:
    settings = get_settings()
    provider = settings.chat_provider.lower().strip()
    if provider == "ollama":
        url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                resp = await client.post(
                    url,
                    json={
                        "model": settings.chat_model,
                        "messages": messages,
                        "stream": False,
                        "options": {"temperature": temperature},
                    },
                )
                resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            detail = e.response.text[:500]
            raise RuntimeError(
                f"Ollama chat modeli calisamadi. Modeli indirin: ollama pull {settings.chat_model}. Detay: {detail}"
            ) from e
        except httpx.RequestError as e:
            raise RuntimeError(
                "Ollama servisine ulasilamadi. Once Ollama'yi acin ve modeli indirin: "
                f"ollama pull {settings.chat_model}"
            ) from e

        message = (resp.json().get("message") or {}).get("content")
        return str(message or "")

    raise RuntimeError(
        f"Desteklenmeyen chat provider: {settings.chat_provider}. Bu proje sohbet modeli icin Ollama kullanir."
    )


async def vision_completion(
    *,
    image_bytes: bytes,
    prompt: str,
    temperature: float = 0.1,
) -> str:
    settings = get_settings()
    if settings.chat_provider.lower().strip() != "ollama":
        raise RuntimeError("Gorsel analiz icin Ollama kullanilmalidir.")

    url = f"{settings.ollama_base_url.rstrip('/')}/api/chat"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    messages = [
        {
            "role": "system",
            "content": (
                "Sen hukuki belge ve olay yeri gorsellerini ihtiyatli inceleyen bir yardimcisin. "
                "Goruntuye dayanmayan iddialari kesinlestirme."
            ),
        },
        {
            "role": "user",
            "content": prompt,
            "images": [encoded],
        },
    ]
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                url,
                json={
                    "model": settings.vision_model,
                    "messages": messages,
                    "stream": False,
                    "options": {"temperature": temperature},
                },
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500]
        raise RuntimeError(
            f"Ollama gorsel analiz modeli calisamadi. Modeli kontrol edin: ollama pull {settings.vision_model}. Detay: {detail}"
        ) from e
    except httpx.RequestError as e:
        raise RuntimeError(
            "Ollama servisine ulasilamadi. Once Ollama'yi acin ve gorsel destekli modeli indirin: "
            f"ollama pull {settings.vision_model}"
        ) from e

    message = (resp.json().get("message") or {}).get("content")
    return str(message or "")
