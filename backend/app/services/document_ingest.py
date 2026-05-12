"""Dosya yükleme: anlamlı parçalama, gömme ve vektör veri tabanına yazma."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CaseFile
from app.services.chunking import chunk_legal_document, chunks_for_hukuki_ozet
from app.services.embeddings import embed_texts
from app.services.pinecone_store import store, vector_id


def _excerpt(text: str, n: int = 3200) -> str:
    t = text.strip()
    return t if len(t) <= n else t[:n]


async def upsert_document_vectors(
    _session: AsyncSession,
    *,
    case_id: UUID,
    document_id: UUID,
    text: str,
    dokuman_turu: str,
    kisi_adi: str,
    tarih_iso: str | None,
) -> int:
    from datetime import date

    store.delete_by_filter(
        {
            "$and": [
                {"case_id": {"$eq": str(case_id)}},
                {"document_id": {"$eq": str(document_id)}},
            ]
        }
    )

    t_date = None
    if tarih_iso:
        try:
            t_date = date.fromisoformat(tarih_iso[:10])
        except ValueError:
            t_date = None

    chunks = chunk_legal_document(
        text,
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih=t_date,
        case_id=str(case_id),
        document_id=str(document_id),
    )
    if not chunks:
        return 0

    texts = [c["text"] for c in chunks]
    batch_size = 16
    total = 0
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        vecs = await embed_texts(batch)
        upserts = []
        for j, vec in enumerate(vecs):
            idx = i + j
            meta = dict(chunks[idx]["metadata"])
            meta["text_excerpt"] = _excerpt(chunks[idx]["text"])
            upserts.append(
                {
                    "id": vector_id("doc"),
                    "values": vec,
                    "metadata": meta,
                }
            )
            total += 1
        store.upsert_vectors(upserts)
    return total


async def upsert_case_summary_vectors(session: AsyncSession, *, case_id: UUID) -> int:
    res = await session.execute(select(CaseFile).where(CaseFile.id == case_id))
    case = res.scalar_one_or_none()
    if not case or not (case.hukuki_ozet or "").strip():
        return 0

    store.delete_by_filter(
        {
            "$and": [
                {"case_id": {"$eq": str(case_id)}},
                {"dokuman_turu": {"$eq": "hukuki_ozet"}},
            ]
        }
    )

    chunks = chunks_for_hukuki_ozet(str(case_id), case.hukuki_ozet)
    if not chunks:
        return 0

    texts = [c["text"] for c in chunks]
    total = 0
    batch_size = 16
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        vecs = await embed_texts(batch)
        upserts = []
        for j, vec in enumerate(vecs):
            idx = i + j
            meta = dict(chunks[idx]["metadata"])
            meta["text_excerpt"] = _excerpt(chunks[idx]["text"])
            upserts.append({"id": vector_id("ozet"), "values": vec, "metadata": meta})
            total += 1
        store.upsert_vectors(upserts)
    return total