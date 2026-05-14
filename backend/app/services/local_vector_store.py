from __future__ import annotations

import json
import math
import threading
import uuid
from pathlib import Path
from typing import Any

from app.config import PROJECT_DIR, get_settings


def _matches_filter(metadata: dict[str, Any], filter_dict: dict[str, Any] | None) -> bool:
    if not filter_dict:
        return True
    if "$and" in filter_dict:
        return all(_matches_filter(metadata, part) for part in filter_dict.get("$and", []))
    for key, condition in filter_dict.items():
        if isinstance(condition, dict) and "$eq" in condition:
            if metadata.get(key) != condition["$eq"]:
                return False
        elif metadata.get(key) != condition:
            return False
    return True


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class LocalVectorStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()

    @property
    def _path(self) -> Path:
        path = Path(get_settings().local_vector_store_path)
        return path if path.is_absolute() else PROJECT_DIR / path

    def _read(self) -> list[dict[str, Any]]:
        path = self._path
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        return data if isinstance(data, list) else []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        path = self._path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")

    def upsert_vectors(self, vectors: list[dict[str, Any]]) -> None:
        with self._lock:
            rows = self._read()
            by_id = {str(row.get("id")): row for row in rows}
            for vector in vectors:
                by_id[str(vector["id"])] = {
                    "id": str(vector["id"]),
                    "values": vector.get("values") or [],
                    "metadata": vector.get("metadata") or {},
                }
            self._write(list(by_id.values()))

    def delete_by_case(self, case_id: str) -> None:
        self.delete_by_filter({"case_id": {"$eq": case_id}})

    def delete_by_filter(self, filter_dict: dict[str, Any]) -> None:
        with self._lock:
            rows = self._read()
            self._write([row for row in rows if not _matches_filter(row.get("metadata") or {}, filter_dict)])

    def query(
        self,
        vector: list[float],
        *,
        top_k: int = 10,
        filter_dict: dict[str, Any] | None = None,
        include_metadata: bool = True,
    ) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._read()
        hits = []
        for row in rows:
            metadata = row.get("metadata") or {}
            if not _matches_filter(metadata, filter_dict):
                continue
            score = _cosine(vector, row.get("values") or [])
            hits.append(
                {
                    "id": row.get("id", ""),
                    "score": score,
                    "metadata": metadata if include_metadata else {},
                }
            )
        hits.sort(key=lambda item: item["score"], reverse=True)
        return hits[:top_k]


def vector_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


store = LocalVectorStore()
