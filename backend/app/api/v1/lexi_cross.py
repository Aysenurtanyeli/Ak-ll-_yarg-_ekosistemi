from fastapi import APIRouter

from app.schemas import CrossExamRequest, CrossExamResponse
from app.services.lexi_cross import cross_exam_rag

router = APIRouter(prefix="/lexi-cross", tags=["Çapraz inceleme"])


@router.post("", response_model=CrossExamResponse)
async def lexi_cross(body: CrossExamRequest) -> CrossExamResponse:
    cevap, ozetler = await cross_exam_rag(
        case_id=body.case_id,
        sorgu=body.sorgu,
        metadata_filters=body.metadata_filters,
        top_k=body.top_k,
    )
    return CrossExamResponse(cevap=cevap, kaynak_ozetleri=ozetler)
