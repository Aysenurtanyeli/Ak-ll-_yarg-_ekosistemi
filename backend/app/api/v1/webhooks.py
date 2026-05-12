from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Document
from app.schemas import WebhookIngestPayload
from app.services.document_ingest import upsert_case_summary_vectors, upsert_document_vectors

router = APIRouter(prefix="/webhooks", tags=["Dış tetikleyiciler"])


@router.post("/ingest")
async def ingest_webhook(body: WebhookIngestPayload, db: AsyncSession = Depends(get_db)) -> dict:
    """Dış sistemlerden tetiklenebilen hafif uç nokta (sürekli entegrasyon veya harici hizmet)."""
    if body.event_type == "case.reindex_summary":
        if not body.case_id:
            raise HTTPException(status_code=400, detail="Dosya kimliği (case_id) zorunludur.")
        n = await upsert_case_summary_vectors(db, case_id=body.case_id)
        await db.commit()
        return {"yeniden_indekslenen_parcalar": n}

    if body.event_type == "document.reindex" and body.case_id:
        doc_id_raw = body.payload.get("document_id")
        if not doc_id_raw:
            raise HTTPException(
                status_code=400,
                detail="İstek gövdesinde belge kimliği (document_id) zorunludur.",
            )
        try:
            doc_uuid = UUID(str(doc_id_raw))
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Geçersiz belge kimliği (document_id).") from e
        doc = await db.get(Document, doc_uuid)
        if not doc or doc.case_id != body.case_id:
            raise HTTPException(status_code=404, detail="Belge bulunamadı")
        n = await upsert_document_vectors(
            db,
            case_id=doc.case_id,
            document_id=doc.id,
            text=doc.raw_text,
            dokuman_turu=doc.dokuman_turu,
            kisi_adi=doc.kisi_adi,
            tarih_iso=doc.tarih_iso,
        )
        await db.commit()
        return {"indekslenen_parcalar": n}

    return {"tamam": True, "islem_yapildi": False}
