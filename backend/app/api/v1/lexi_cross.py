from fastapi import APIRouter, HTTPException

from app.schemas import CrossExamRequest, CrossExamResponse
from app.services.lexi_cross import cross_exam_rag

router = APIRouter(prefix="/lexi-cross", tags=["Çapraz inceleme"])


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
