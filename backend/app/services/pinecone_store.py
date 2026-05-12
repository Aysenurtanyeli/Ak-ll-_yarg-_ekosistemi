"""Vektör veri tabanı: vektör yazma, süzgeçli sorgu ve dizin oluşturma."""

from __future__ import annotations

import uuid
from typing import Any

from pinecone import Pinecone, ServerlessSpec

from app.config import get_settings

# text-embedding-3-small boyutu
EMBEDDING_DIM = 1536


class PineconeStore:
    def __init__(self) -> None:
        self._index = None
        self._pc: Pinecone | None = None

    def _ensure(self) -> None:
        if self._index is not None:
            return
        s = get_settings()
        if not s.pinecone_api_key:
            raise RuntimeError("PINECONE_API_KEY ortam değişkeni tanımlı değil.")
        self._pc = Pinecone(api_key=s.pinecone_api_key)
        name = s.pinecone_index_name
        li = self._pc.list_indexes()
        existing = set(li.names()) if hasattr(li, "names") else {getattr(i, "name", str(i)) for i in li}
        if name not in existing:
            self._pc.create_index(
                name=name,
                dimension=EMBEDDING_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud=s.pinecone_cloud, region=s.pinecone_region),
            )
        self._index = self._pc.Index(name)

    def upsert_vectors(self, vectors: list[dict[str, Any]]) -> None:
        self._ensure()
        assert self._index is not None
        self._index.upsert(vectors=vectors)

    def delete_by_case(self, case_id: str) -> None:
        self._ensure()
        assert self._index is not None
        self._index.delete(filter={"case_id": {"$eq": case_id}})

    def delete_by_filter(self, filter_dict: dict[str, Any]) -> None:
        self._ensure()
        assert self._index is not None
        self._index.delete(filter=filter_dict)

    def query(
        self,
        vector: list[float],
        *,
        top_k: int = 10,
        filter_dict: dict[str, Any] | None = None,
        include_metadata: bool = True,
    ) -> list[dict[str, Any]]:
        self._ensure()
        assert self._index is not None
        res = self._index.query(
            vector=vector,
            top_k=top_k,
            filter=filter_dict,
            include_metadata=include_metadata,
        )
        out: list[dict[str, Any]] = []
        for m in res.matches or []:
            out.append(
                {
                    "id": m.id,
                    "score": float(m.score or 0),
                    "metadata": dict(m.metadata or {}),
                }
            )
        return out


def vector_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


store = PineconeStore()
