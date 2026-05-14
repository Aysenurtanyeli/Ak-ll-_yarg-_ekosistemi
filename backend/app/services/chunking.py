"""Hukuki metinleri rastgele değil anlamlı parçalara böler."""

from __future__ import annotations

import re
from datetime import date
from typing import Any


SECTION_PATTERNS = [
    re.compile(r"(?=\n\s*(?:TANIK|Tanık|tanık)\s*[:\-]?\s*.+)", re.MULTILINE),
    re.compile(r"(?=\n\s*(?:DEL[İI]L|Delil|delil)\s*[:\-]?\s*.+)", re.MULTILINE),
    re.compile(r"(?=\n\s*(?:İFADE|İfade|ifade)\s*[:\-]?\s*.+)", re.MULTILINE),
    re.compile(r"(?=\n\s*(?:RAPOR|Rapor|rapor)\s*[:\-]?\s*.+)", re.MULTILINE),
    re.compile(r"(?=\n\s*(?:B[ÖO]L[ÜU]M|Bölüm|bölüm)\s*\d*\s*[:\-]?\s*.+)", re.MULTILINE),
    re.compile(r"(?=\n#{1,3}\s*.+)", re.MULTILINE),
]

PAGE_MARKER_RE = re.compile(r"\[\[SAYFA:(\d+)(?:;PARAGRAF:(\d+))?\]\]")


def _split_by_sections(text: str) -> list[str]:
    if not text:
        return []

    if PAGE_MARKER_RE.search(text):
        page_chunks: list[str] = []
        matches = list(PAGE_MARKER_RE.finditer(text))
        for idx, match in enumerate(matches):
            page_no = match.group(1)
            start = match.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
            page_text = text[start:end]
            paras = [p.strip() for p in re.split(r"\n{2,}", page_text) if p.strip()]
            for para_index, para in enumerate(paras, start=1):
                page_chunks.append(f"[[SAYFA:{page_no};PARAGRAF:{para_index}]]\n{para}")
        return page_chunks

    parts: list[str] = [text]
    for pat in SECTION_PATTERNS:
        new_parts: list[str] = []
        for p in parts:
            splits = pat.split(p)
            new_parts.extend(s for s in splits if s.strip())
        parts = new_parts if new_parts else parts

    if len(parts) == 1 and len(parts[0]) > 4000:
        return _split_by_paragraphs(parts[0])
    return [p.strip() for p in parts if p.strip()]


def _split_by_paragraphs(text: str, max_chars: int = 2200, overlap: int = 200) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for para in paras:
        if len(buf) + len(para) + 2 <= max_chars:
            buf = f"{buf}\n\n{para}".strip() if buf else para
        else:
            if buf:
                chunks.append(buf)
            if len(para) <= max_chars:
                buf = para
            else:
                for i in range(0, len(para), max_chars - overlap):
                    chunks.append(para[i : i + max_chars])
                buf = ""
    if buf:
        chunks.append(buf)
    return chunks


def _source_ref_for_section(section: str) -> tuple[str, int | None, int | None]:
    page_match = PAGE_MARKER_RE.search(section)
    page_no = int(page_match.group(1)) if page_match else None
    marked_para_no = int(page_match.group(2)) if page_match and page_match.group(2) else None
    clean = PAGE_MARKER_RE.sub("", section).strip()
    paras = [p.strip() for p in re.split(r"\n{2,}", clean) if p.strip()]
    para_no = marked_para_no or (1 if paras else None)
    if page_no and para_no:
        return f"Sayfa {page_no}, Paragraf {para_no}", page_no, para_no
    if page_no:
        return f"Sayfa {page_no}", page_no, None
    return "Kaynak konumu belirtilmedi", None, None


def chunk_legal_document(
    text: str,
    *,
    dokuman_turu: str,
    kisi_adi: str,
    tarih: date | None,
    case_id: str,
    document_id: str,
) -> list[dict[str, Any]]:
    """Her parça vektör veri tabanı üst verisiyle uyumlu bir sözlük olarak döner."""
    sections = _split_by_sections(text)
    out: list[dict[str, Any]] = []
    for idx, sec in enumerate(sections):
        source_ref, page_no, paragraph_no = _source_ref_for_section(sec)
        sec = PAGE_MARKER_RE.sub("", sec).strip()
        inferred_kisi = kisi_adi
        m = re.search(r"(?:TANIK|Tanık|tanık)\s*[:\-]?\s*([^\n]+)", sec[:800])
        if m:
            inferred_kisi = m.group(1).strip()[:200] or inferred_kisi

        inferred_type = dokuman_turu
        low = sec[:400].lower()
        if "adli tıp" in low or "adlitip" in low.replace(" ", ""):
            inferred_type = "Adli Tıp Raporu"
        elif "olay yeri" in low:
            inferred_type = "Olay Yeri Raporu"
        elif "tapu" in low:
            inferred_type = "Tapu Kaydı"
        elif "ifade" in low:
            inferred_type = "İfade"

        tarih_str = tarih.isoformat() if tarih else ""

        out.append(
            {
                "text": sec,
                "metadata": {
                    "case_id": case_id,
                    "document_id": document_id,
                    "chunk_index": idx,
                    "dokuman_turu": inferred_type,
                    "kisi_adi": inferred_kisi or "",
                    "tarih": tarih_str,
                    "source_ref": source_ref,
                    "page_no": page_no or "",
                    "paragraph_no": paragraph_no or "",
                },
            }
        )
    return out


def chunks_for_hukuki_ozet(case_id: str, ozet_metni: str) -> list[dict[str, Any]]:
    """Hukuki özet parçaları — mevzuat izleme karşılaştırması için."""
    parts = _split_by_paragraphs(ozet_metni, max_chars=1800, overlap=150)
    return [
        {
            "text": p,
            "metadata": {
                "case_id": case_id,
                "document_id": "",
                "chunk_index": i,
                "dokuman_turu": "hukuki_ozet",
                "kisi_adi": "",
                "tarih": "",
            },
        }
        for i, p in enumerate(parts)
    ]
