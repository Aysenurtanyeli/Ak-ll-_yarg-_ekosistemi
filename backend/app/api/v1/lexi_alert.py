from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AlertNotification, CaseFile, Document
from app.schemas import DecisionSimulationRequest, NotificationOut
from app.services.regu_watch import process_feeds_sync
from app.sync_db import sync_session

router = APIRouter(prefix="/lexi-alert", tags=["Mevzuat uyarıları"])


def _score_decision_against_text(decision: str, text: str) -> float:
    decision_words = {w for w in decision.lower().split() if len(w) > 4}
    text_words = {w for w in text.lower().split() if len(w) > 4}
    if not decision_words:
        return 0.0
    return len(decision_words & text_words) / max(len(decision_words), 1)


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


@router.post("/simulate-decision", response_model=NotificationOut | None)
async def simulate_decision_alert(
    body: DecisionSimulationRequest,
    db: AsyncSession = Depends(get_db),
) -> AlertNotification | None:
    case = await db.get(CaseFile, body.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadÄ±")

    res = await db.execute(select(Document).where(Document.case_id == body.case_id))
    docs = list(res.scalars().all())
    decision_blob = f"{body.baslik} {body.konu} {body.hukuki_gerekce}"
    best_doc = None
    best_score = 0.0
    for doc in docs:
        score = _score_decision_against_text(
            decision_blob,
            f"{doc.filename} {doc.dokuman_turu} {doc.raw_text[:5000]}",
        )
        if score > best_score:
            best_doc = doc
            best_score = score

    if not best_doc and docs:
        best_doc = docs[0]
        best_score = 0.18
    if not best_doc:
        return None

    topic = body.konu.strip() or "hukuki değerlendirme"
    notification = AlertNotification(
        case_id=body.case_id,
        title="Yeni Karar Uyarısı!",
        message=(
            f"Bu karar, {case.title} dosyanızdaki {topic} alanını etkileyebilir. "
            f"Özellikle {best_doc.filename} belgesindeki konu ve hukuki gerekçe ile benzerlik tespit edildi."
        ),
        source_url=body.source_url,
        similarity=max(best_score, 0.18),
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    return notification


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
