from datetime import date
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CaseFile, Document
from app.schemas import DocumentIngestRequest, PdfExtractResponse, PdfIngestResponse
from app.services.document_ingest import upsert_document_vectors
from app.services.pdf_extract import extract_text_from_pdf

router = APIRouter(prefix="/documents", tags=["Belgeler"])

MAX_PDF_BYTES = 25 * 1024 * 1024


def _parse_tarih(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail="Tarih alanı yıl-ay-gün biçiminde olmalıdır (ör. 2024-03-15).",
        ) from e
    return s


@router.post("/ingest")
async def ingest_document(body: DocumentIngestRequest, db: AsyncSession = Depends(get_db)) -> dict:
    case = await db.get(CaseFile, body.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    tarih_str = body.tarih.isoformat() if body.tarih else None
    doc = Document(
        id=uuid4(),
        case_id=body.case_id,
        filename=body.filename,
        raw_text=body.text,
        dokuman_turu=body.dokuman_turu,
        kisi_adi=body.kisi_adi,
        tarih_iso=tarih_str,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    n = await upsert_document_vectors(
        db,
        case_id=body.case_id,
        document_id=doc.id,
        text=body.text,
        dokuman_turu=body.dokuman_turu,
        kisi_adi=body.kisi_adi,
        tarih_iso=tarih_str,
    )
    return {"belge_kimligi": str(doc.id), "indekslenen_parcalar": n}


@router.post("/pdf/extract", response_model=PdfExtractResponse)
async def pdf_extract_text(file: UploadFile = File(...)) -> PdfExtractResponse:
    """PDF yükleyin; metin çıkarılır (gerekirse görüntüden metin tanıma). Vektör veri tabanına yazılmaz."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnızca .pdf dosyası kabul edilir.")
    raw = await file.read()
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF en fazla 25 MB olabilir.")
    result = extract_text_from_pdf(raw)
    return PdfExtractResponse(
        metin=result.text,
        ocr_kullanildi=result.used_ocr,
        uyari=result.warning,
    )


@router.post("/pdf/ingest", response_model=PdfIngestResponse)
async def pdf_ingest(
    db: AsyncSession = Depends(get_db),
    case_id: UUID = Form(...),
    file: UploadFile = File(...),
    dokuman_turu: str = Form("Genel"),
    kisi_adi: str = Form(""),
    tarih: str | None = Form(None),
) -> PdfIngestResponse:
    """PDF yükleyin; metin çıkarılır, ilişkisel veri tabanına kaydedilir ve vektör veri tabanına indekslenir."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnızca .pdf dosyası kabul edilir.")
    raw = await file.read()
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF en fazla 25 MB olabilir.")

    case = await db.get(CaseFile, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    extracted = extract_text_from_pdf(raw)
    if not (extracted.text or "").strip():
        raise HTTPException(
            status_code=422,
            detail=extracted.warning or "PDF içinden metin çıkarılamadı.",
        )

    tarih_str = _parse_tarih(tarih)
    safe_name = file.filename or "belge.pdf"

    doc = Document(
        id=uuid4(),
        case_id=case_id,
        filename=safe_name,
        raw_text=extracted.text,
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih_iso=tarih_str,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    n = await upsert_document_vectors(
        db,
        case_id=case_id,
        document_id=doc.id,
        text=extracted.text,
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih_iso=tarih_str,
    )
    return PdfIngestResponse(
        belge_kimligi=str(doc.id),
        indekslenen_parcalar=n,
        ocr_kullanildi=extracted.used_ocr,
        uyari=extracted.warning,
    )
