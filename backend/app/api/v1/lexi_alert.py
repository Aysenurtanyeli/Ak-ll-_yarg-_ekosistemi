from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AlertNotification
from app.schemas import NotificationOut
from app.services.regu_watch import process_feeds_sync
from app.sync_db import sync_session

router = APIRouter(prefix="/lexi-alert", tags=["Mevzuat uyarıları"])


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(
    case_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[AlertNotification]:
    q = select(AlertNotification).order_by(AlertNotification.created_at.desc())
    if case_id:
        q = q.where(AlertNotification.case_id == case_id)
    res = await db.execute(q)
    return list(res.scalars().all())


@router.post("/run-watch")
async def run_watch_now() -> dict:
    """Zamanlanmış görev dışında, izlemeyi elle çalıştırır."""
    session = sync_session()
    try:
        n = process_feeds_sync(session)
        return {"olusturulan_uyarilar": n}
    finally:
        session.close()


@router.post("/notifications/{notif_id}/read")
async def mark_read(notif_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    n = await db.get(AlertNotification, notif_id)
    if not n:
        raise HTTPException(status_code=404, detail="Bildirim yok")
    n.read = True
    await db.commit()
    return {"tamam": True}
