from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CaseFile, Document
from app.schemas import BelgeListItem, CaseCreate, CaseOut, CaseUpdate
from app.services.document_ingest import upsert_case_summary_vectors

router = APIRouter(prefix="/cases", tags=["Dava dosyaları"])


@router.post("", response_model=CaseOut)
async def create_case(body: CaseCreate, db: AsyncSession = Depends(get_db)) -> CaseFile:
    c = CaseFile(title=body.title, hukuki_ozet=body.hukuki_ozet)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    if (body.hukuki_ozet or "").strip():
        await upsert_case_summary_vectors(db, case_id=c.id)
        await db.commit()
    return c


@router.get("", response_model=list[CaseOut])
async def list_cases(db: AsyncSession = Depends(get_db)) -> list[CaseFile]:
    res = await db.execute(select(CaseFile).order_by(CaseFile.created_at.desc()))
    return list(res.scalars().all())


@router.get("/{case_id}/belgeler", response_model=list[BelgeListItem])
async def list_case_documents(case_id: UUID, db: AsyncSession = Depends(get_db)) -> list[BelgeListItem]:
    c = await db.get(CaseFile, case_id)
    if not c:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    res = await db.execute(
        select(Document).where(Document.case_id == case_id).order_by(Document.created_at.desc())
    )
    docs = list(res.scalars().all())
    return [
        BelgeListItem(
            id=d.id,
            dosya_adi=d.filename,
            dokuman_turu=d.dokuman_turu,
            kisi_adi=d.kisi_adi,
            tarih_iso=d.tarih_iso,
        )
        for d in docs
    ]


@router.get("/{case_id}", response_model=CaseOut)
async def get_case(case_id: UUID, db: AsyncSession = Depends(get_db)) -> CaseFile:
    c = await db.get(CaseFile, case_id)
    if not c:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    return c


@router.patch("/{case_id}", response_model=CaseOut)
async def update_case(
    case_id: UUID, body: CaseUpdate, db: AsyncSession = Depends(get_db)
) -> CaseFile:
    c = await db.get(CaseFile, case_id)
    if not c:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    if body.title is not None:
        c.title = body.title
    if body.hukuki_ozet is not None:
        c.hukuki_ozet = body.hukuki_ozet
    await db.commit()
    await db.refresh(c)
    if body.hukuki_ozet is not None:
        await upsert_case_summary_vectors(db, case_id=c.id)
        await db.commit()
    return c
