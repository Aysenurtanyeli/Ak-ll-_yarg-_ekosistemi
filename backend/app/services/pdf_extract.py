"""PDF'ten metin çıkarma: önce doğrudan metin, gerekirse sayfa görüntüsü üzerinden karakter tanıma."""

from __future__ import annotations

from typing import Any

from dataclasses import dataclass


@dataclass
class PdfExtractResult:
    text: str
    used_ocr: bool = False
    warning: str | None = None


def _ocr_pages_fitz(doc: Any) -> str:
    try:
        from PIL import Image
        import pytesseract
    except ImportError:
        return ""

    parts: list[str] = []
    for i in range(len(doc)):
        page = doc[i]
        try:
            pix = page.get_pixmap(dpi=200, alpha=False)
            mode = "RGB" if pix.n < 4 else "RGBA"
            img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
            if mode == "RGBA":
                img = img.convert("RGB")
            raw = pytesseract.image_to_string(img, lang="tur+eng")
            if raw.strip():
                parts.append(raw)
        except Exception:
            continue
    return "\n\n".join(parts).strip()


def extract_text_from_pdf(data: bytes, *, ocr_if_sparse: bool = True) -> PdfExtractResult:
    import fitz

    if not data or len(data) < 8:
        return PdfExtractResult(text="", warning="Boş veya geçersiz dosya.")

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return PdfExtractResult(text="", warning="PDF açılamadı veya geçerli formatta değil.")
    try:
        direct_parts: list[str] = []
        for i in range(len(doc)):
            direct_parts.append(doc[i].get_text("text") or "")
        text = "\n\n".join(direct_parts).strip()
        used_ocr = False
        warning = None

        if ocr_if_sparse and len(text) < 80:
            ocr_text = _ocr_pages_fitz(doc)
            if len(ocr_text) > len(text):
                text = ocr_text
                used_ocr = True

        if len(text.strip()) < 15:
            warning = (
                "Çıkarılan metin çok kısa. PDF yalnızca görüntü içeriyorsa "
                "Tesseract ve ilgili Python kitaplıklarının kurulu olduğundan emin olun."
            )
        return PdfExtractResult(text=text, used_ocr=used_ocr, warning=warning)
    finally:
        doc.close()
