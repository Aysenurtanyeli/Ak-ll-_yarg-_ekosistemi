from uuid import UUID

from openai import AsyncOpenAI

from app.config import get_settings
from app.services.embeddings import embed_texts
from app.services.pinecone_store import store


def _build_pinecone_filter(case_id: str, meta: dict) -> dict:
    """Parça üst verisini vektör veri tabanı süzgecine dönüştürür."""
    parts: list[dict] = [{"case_id": {"$eq": case_id}}]
    for k, v in meta.items():
        if v is None or v == "":
            continue
        parts.append({k: {"$eq": v}})
    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


async def cross_exam_rag(
    *,
    case_id: UUID,
    sorgu: str,
    metadata_filters: list[dict],
    top_k: int,
) -> tuple[str, list[str]]:
    """Üst veri süzgeçli anlamsal arama ile metin kümeleri arasında tutarsızlık değerlendirmesi."""
    settings = get_settings()
    cid = str(case_id)
    qvec = (await embed_texts([sorgu]))[0]

    retrieved_blocks: list[str] = []
    for filt in metadata_filters:
        fl = _build_pinecone_filter(cid, filt)
        hits = store.query(qvec, top_k=max(2, top_k // max(len(metadata_filters), 1)), filter_dict=fl)
        for h in hits:
            meta = h.get("metadata") or {}
            # Üst veride metin özeti tutulur
            excerpt = str(meta.get("text_excerpt", ""))
            if excerpt:
                retrieved_blocks.append(excerpt)

    if not metadata_filters:
        hits = store.query(qvec, top_k=top_k, filter_dict={"case_id": {"$eq": cid}})
        for h in hits:
            excerpt = str((h.get("metadata") or {}).get("text_excerpt", ""))
            if excerpt:
                retrieved_blocks.append(excerpt)

    context = "\n\n---\n\n".join(retrieved_blocks[:24])
    client = AsyncOpenAI(api_key=settings.openai_api_key or None)
    prompt = (
        "Aşağıdaki hukuki metin parçalarını ve kullanıcı sorusunu dikkatlice oku. "
        "Mantıksal veya olgusal tutarsızlık, zaman çelişkisi veya delil–ifade uyumsuzluğu var mı? "
        "Türkçe, maddeler halinde ve ihtiyatlı bir dille yanıtla. Belirsizse belirt.\n\n"
        f"Soru: {sorgu}\n\nMetinler:\n{context}"
    )
    resp = await client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": "Sen dikkatli bir hukuk yardımcısısın; kesin hüküm vermezsin."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.15,
    )
    answer = resp.choices[0].message.content or ""
    return answer, retrieved_blocks
