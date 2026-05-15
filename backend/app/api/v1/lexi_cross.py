import asyncio
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from app.schemas import CrossCrewRequest, CrossCrewResponse, CrossExamRequest, CrossExamResponse
from app.services.crew_service import run_legal_crew
from app.services.langchain_service import langchain_query
from app.services.lexi_cross import cross_exam_rag
from app.services.llm import vision_completion

router = APIRouter(prefix="/lexi-cross", tags=["Capraz inceleme"])

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/crew", response_model=CrossCrewResponse)
async def crew_analiz(body: CrossCrewRequest) -> CrossCrewResponse:
    try:
        filter_dict = {"case_id": {"$eq": str(body.case_id)}} if body.case_id else None
        langchain_baglam = await asyncio.to_thread(
            langchain_query,
            body.sorgu,
            body.top_k,
            filter_dict,
        )
        crew_cevap = await asyncio.to_thread(
            run_legal_crew,
            belgeler=langchain_baglam,
            sorgu=body.sorgu,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return CrossCrewResponse(cevap=crew_cevap, langchain_baglam=langchain_baglam)


@router.post("", response_model=CrossExamResponse)
async def lexi_cross(body: CrossExamRequest) -> CrossExamResponse:
    try:
        cevap, ozetler = await cross_exam_rag(
            case_id=body.case_id,
            sorgu=body.sorgu,
            metadata_filters=body.metadata_filters,
            top_k=body.top_k,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return CrossExamResponse(cevap=cevap, kaynak_ozetleri=ozetler)


@router.post("/with-images", response_model=CrossExamResponse)
async def lexi_cross_with_images(
    body_json: str = Form(...),
    images: list[UploadFile] | None = File(None),
) -> CrossExamResponse:
    try:
        body = CrossExamRequest.model_validate(json.loads(body_json))
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(status_code=400, detail="Analiz istegi gecersiz.") from e

    visual_findings: list[str] = []
    for index, image in enumerate(images or [], start=1):
        if image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Yalnizca JPG, PNG veya WebP gorsel kabul edilir.")
        raw = await image.read()
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Gorsel en fazla 12 MB olabilir.")
        try:
            finding = await vision_completion(
                image_bytes=raw,
                prompt=(
                    "Bu fotografi hukuki olay ve delil incelemesi acisindan incele. "
                    "Fiziksel bulgulari, hasar/iz/yol durumu/konum isaretlerini ve belirsizlikleri Turkce maddeler halinde yaz. "
                    "Metin belgeleriyle karsilastirmaya yarayacak somut gozlemleri one cikar; goruntuye dayanmayan iddiayi kesinlestirme."
                ),
            )
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        visual_findings.append(f"Foto {index} ({image.filename or 'isimsiz'}):\n{finding}")

    try:
        cevap, ozetler = await cross_exam_rag(
            case_id=body.case_id,
            sorgu=body.sorgu,
            metadata_filters=body.metadata_filters,
            top_k=body.top_k,
            visual_findings=visual_findings,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return CrossExamResponse(cevap=cevap, kaynak_ozetleri=ozetler)
