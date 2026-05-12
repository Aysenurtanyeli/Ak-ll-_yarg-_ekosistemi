"""Mevzuat izleme: RSS kaynaklarını tarar; hukuki özet vektörleriyle anlamsal eşleşmede uyarı üretir."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

import feedparser
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AlertNotification, CaseFile, ProcessedFeedItem
from app.services.embeddings import embed_texts
from app.services.pinecone_store import store


def _item_guid(entry: dict[str, Any], feed_url: str) -> str:
    gid = (entry.get("id") or entry.get("link") or entry.get("title") or "") + feed_url
    return hashlib.sha256(gid.encode("utf-8", errors="ignore")).hexdigest()


def process_feeds_sync(session: Session) -> int:
    settings = get_settings()
    feeds = [u.strip() for u in (settings.regu_rss_feeds or "").split(",") if u.strip()]
    if not feeds:
        return 0

    threshold = float(settings.regu_similarity_threshold)
    alerts = 0

    for url in feeds:
        try:
            xml = httpx.get(
                url,
                timeout=60.0,
                follow_redirects=True,
                headers={"User-Agent": "LexiGuard-ReguWatch/1.0"},
            ).text
        except Exception:
            continue

        parsed = feedparser.parse(xml)
        for entry in parsed.entries or []:
            item_id = _item_guid(entry, url)
            found = session.execute(
                select(ProcessedFeedItem.id).where(
                    ProcessedFeedItem.feed_url == url,
                    ProcessedFeedItem.item_id == item_id,
                )
            ).first()
            if found:
                continue

            title = str(entry.get("title", "")).strip()
            summary = str(entry.get("summary", entry.get("description", ""))).strip()
            link = str(entry.get("link", "")).strip()
            blob = f"{title}\n\n{summary}".strip()
            if len(blob) < 20:
                session.add(
                    ProcessedFeedItem(
                        id=uuid.uuid4(),
                        feed_url=url,
                        item_id=item_id,
                        processed_at=datetime.now(timezone.utc),
                    )
                )
                session.commit()
                continue

            try:
                vec = asyncio.run(embed_texts([blob[:8000]]))[0]
            except Exception:
                continue

            hits = store.query(
                vec,
                top_k=25,
                filter_dict={"dokuman_turu": {"$eq": "hukuki_ozet"}},
            )
            for h in hits:
                score = float(h.get("score", 0))
                if score < threshold:
                    continue
                meta = h.get("metadata") or {}
                case_id_s = str(meta.get("case_id", ""))
                if not case_id_s:
                    continue
                try:
                    cid = uuid.UUID(case_id_s)
                except ValueError:
                    continue

                if not session.get(CaseFile, cid):
                    continue

                msg = (
                    f"Dikkat! Dosyanızdaki hukuki özetle yüksek benzerlik ({score:.0%}) gösteren "
                    f"yeni bir yayın tespit edildi: {title}"
                )
                session.add(
                    AlertNotification(
                        id=uuid.uuid4(),
                        case_id=cid,
                        title=f"Mevzuat izleme: {title[:200]}",
                        message=msg,
                        source_url=link or url,
                        similarity=score,
                    )
                )
                alerts += 1

            session.add(
                ProcessedFeedItem(
                    id=uuid.uuid4(),
                    feed_url=url,
                    item_id=item_id,
                    processed_at=datetime.now(timezone.utc),
                )
            )
            session.commit()

    return alerts
