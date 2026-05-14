from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CaseFile, Document
from app.schemas import LexiChronResponse, TimelineEvent
from app.services.lexi_chron import extract_timeline_locally, extract_timeline_with_llm, merge_with_metadata

router = APIRouter(prefix="/lexi-chron", tags=["Kronoloji"])


@router.get("/{case_id}", response_model=LexiChronResponse)
async def justice_timeline(case_id: UUID, db: AsyncSession = Depends(get_db)) -> LexiChronResponse:
    case = await db.get(CaseFile, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    res = await db.execute(select(Document).where(Document.case_id == case_id))
    docs = list(res.scalars().all())
    if not docs:
        return LexiChronResponse(events=[])

    combined = "\n\n".join(f"## {d.filename}\n{d.raw_text}" for d in docs)[:24000]
    try:
        llm_events = await extract_timeline_with_llm(combined)
    except Exception:
        llm_events = extract_timeline_locally(combined)
    if not llm_events:
        llm_events = extract_timeline_locally(combined)

    meta_rows: list[dict[str, str]] = []
    for d in docs:
        if d.tarih_iso:
            meta_rows.append(
                {
                    "tarih": d.tarih_iso,
                    "dokuman_turu": d.dokuman_turu,
                    "kisi_adi": d.kisi_adi,
                    "text_excerpt": (d.raw_text or "")[:500],
                }
            )

    merged = merge_with_metadata(llm_events, meta_rows)
    if not merged:
        merged = [
            TimelineEvent(
                tarih=d.created_at.date().isoformat() if d.created_at else "bilinmiyor",
                olay=f"Belge yuklendi: {d.filename}",
                kaynak=(d.raw_text or "")[:500],
                metadata_tarih=d.tarih_iso,
            )
            for d in docs
        ]
    return LexiChronResponse(events=merged)
