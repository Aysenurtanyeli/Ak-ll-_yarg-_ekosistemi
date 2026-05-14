import asyncio
from datetime import date
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal, get_db
from app.models import CaseFile, Document
from app.schemas import DocumentIngestRequest, PdfExtractResponse, PdfIngestResponse
from app.services.document_ingest import upsert_document_vectors
from app.services.pdf_extract import extract_text_from_pdf

router = APIRouter(prefix="/documents", tags=["Belgeler"])

MAX_PDF_BYTES = 25 * 1024 * 1024


async def _index_document_in_background(
    *,
    case_id: UUID,
    document_id: UUID,
    text: str,
    dokuman_turu: str,
    kisi_adi: str,
    tarih_iso: str | None,
) -> None:
    async with SessionLocal() as session:
        try:
            await upsert_document_vectors(
                session,
                case_id=case_id,
                document_id=document_id,
                text=text,
                dokuman_turu=dokuman_turu,
                kisi_adi=kisi_adi,
                tarih_iso=tarih_iso,
            )
        except Exception:
            return


async def _extract_update_and_index_in_background(
    *,
    case_id: UUID,
    document_id: UUID,
    pdf_bytes: bytes,
    dokuman_turu: str,
    kisi_adi: str,
    tarih_iso: str | None,
) -> None:
    try:
        extracted = await asyncio.to_thread(extract_text_from_pdf, pdf_bytes)
    except Exception:
        return

    text = (extracted.text or "").strip()
    if not text:
        return

    async with SessionLocal() as session:
        doc = await session.get(Document, document_id)
        if not doc:
            return
        doc.raw_text = text
        await session.commit()

    await _index_document_in_background(
        case_id=case_id,
        document_id=document_id,
        text=text,
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih_iso=tarih_iso,
    )


def _parse_tarih(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()[:10]
    try:
        date.fromisoformat(s)
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail="Tarih alani yil-ay-gun biciminde olmalidir (or. 2024-03-15).",
        ) from e
    return s


@router.post("/ingest")
async def ingest_document(body: DocumentIngestRequest, db: AsyncSession = Depends(get_db)) -> dict:
    case = await db.get(CaseFile, body.case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadi")

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
    """PDF yukleyin; metin cikarilir, vektor veritabanina yazilmaz."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnizca .pdf dosyasi kabul edilir.")
    raw = await file.read()
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF en fazla 25 MB olabilir.")
    result = await asyncio.to_thread(extract_text_from_pdf, raw)
    return PdfExtractResponse(
        metin=result.text,
        ocr_kullanildi=result.used_ocr,
        uyari=result.warning,
    )


@router.post("/pdf/ingest", response_model=PdfIngestResponse)
async def pdf_ingest(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    case_id: str | None = Form(None),
    file: UploadFile = File(...),
    dokuman_turu: str = Form("Genel"),
    kisi_adi: str = Form(""),
    tarih: str | None = Form(None),
) -> PdfIngestResponse:
    """PDF hemen dosyaya alinir; vektor indeksleme arka planda devam eder."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Yalnizca .pdf dosyasi kabul edilir.")
    raw = await file.read()
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF en fazla 25 MB olabilir.")

    safe_name = file.filename or "belge.pdf"
    case_id_raw = (case_id or "").strip()
    resolved_case_id: UUID | None = None
    if case_id_raw:
        try:
            resolved_case_id = UUID(case_id_raw)
        except ValueError as e:
            raise HTTPException(status_code=400, detail="Dosya kimligi gecerli bir UUID olmalidir.") from e

    if resolved_case_id is None:
        case = CaseFile(title=safe_name, hukuki_ozet="")
        db.add(case)
        await db.flush()
        resolved_case_id = case.id

    case = await db.get(CaseFile, resolved_case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Dosya bulunamadi")

    tarih_str = _parse_tarih(tarih)
    doc = Document(
        id=uuid4(),
        case_id=resolved_case_id,
        filename=safe_name,
        raw_text="Belge metni arka planda hazirlaniyor.",
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih_iso=tarih_str,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    background_tasks.add_task(
        _extract_update_and_index_in_background,
        case_id=resolved_case_id,
        document_id=doc.id,
        pdf_bytes=raw,
        dokuman_turu=dokuman_turu,
        kisi_adi=kisi_adi,
        tarih_iso=tarih_str,
    )
    return PdfIngestResponse(
        case_id=resolved_case_id,
        belge_kimligi=str(doc.id),
        indekslenen_parcalar=0,
        ocr_kullanildi=False,
        uyari="Belge dosyaya alindi; metin okuma ve analiz indeksi arka planda hazirlaniyor.",
        indeksleme_durumu="arka_planda",
    )
