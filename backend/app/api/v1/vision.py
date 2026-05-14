from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.services.llm import vision_completion

router = APIRouter(prefix="/vision", tags=["Gorsel kanit"])

MAX_IMAGE_BYTES = 12 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    prompt: str = Form(
        "Gorselde hukuki olay incelemesi acisindan dikkat ceken delil, hasar, iz, konum veya tutarsizlik ihtimallerini belirt."
    ),
) -> dict[str, str]:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Yalnizca JPG, PNG veya WebP gorsel kabul edilir.")
    raw = await file.read()
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Gorsel en fazla 12 MB olabilir.")
    try:
        answer = await vision_completion(
            image_bytes=raw,
            prompt=(
                f"{prompt}\n\n"
                "Cevabi Turkce ver. Gorulebilen bulgulari, olasi hukuki onemi ve belirsizlikleri ayri maddeler halinde yaz. "
                "Kesin olcum yapamiyorsan bunu acikca belirt. "
                "Gorsel hukuki inceleme icin yeterince net degilse, kullaniciyi daha net bir aci, daha yuksek cozunurluk "
                "veya olay yeri inceleme raporundaki orijinal fotografi yuklemeye yonlendir."
            ),
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return {"cevap": answer}
