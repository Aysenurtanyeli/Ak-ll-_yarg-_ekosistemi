from uuid import UUID

from app.services.embeddings import embed_texts
from app.services.llm import chat_completion
from app.services.vector_store import store


def _build_vector_filter(case_id: str, meta: dict) -> dict:
    parts: list[dict] = [{"case_id": {"$eq": case_id}}]
    for k, v in meta.items():
        if v is None or v == "":
            continue
        parts.append({k: {"$eq": v}})
    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


async def cross_exam_rag(
    *,
    case_id: UUID,
    sorgu: str,
    metadata_filters: list[dict],
    top_k: int,
    visual_findings: list[str] | None = None,
) -> tuple[str, list[str]]:
    cid = str(case_id)
    qvec = (await embed_texts([sorgu]))[0]

    retrieved_blocks: list[str] = []
    for filt in metadata_filters:
        fl = _build_vector_filter(cid, filt)
        hits = store.query(qvec, top_k=max(2, top_k // max(len(metadata_filters), 1)), filter_dict=fl)
        for h in hits:
            meta = h.get("metadata") or {}
            excerpt = str(meta.get("text_excerpt", ""))
            if excerpt:
                source = str(meta.get("source_ref") or "Kaynak konumu belirtilmedi")
                doc_type = str(meta.get("dokuman_turu") or "Belge")
                person = str(meta.get("kisi_adi") or "").strip()
                label = f"{source} | {doc_type}{f' | {person}' if person else ''}"
                retrieved_blocks.append(f"[KAYNAK: {label}]\n{excerpt}")

    if not metadata_filters:
        hits = store.query(qvec, top_k=top_k, filter_dict={"case_id": {"$eq": cid}})
        for h in hits:
            meta = h.get("metadata") or {}
            excerpt = str(meta.get("text_excerpt", ""))
            if excerpt:
                source = str(meta.get("source_ref") or "Kaynak konumu belirtilmedi")
                doc_type = str(meta.get("dokuman_turu") or "Belge")
                person = str(meta.get("kisi_adi") or "").strip()
                label = f"{source} | {doc_type}{f' | {person}' if person else ''}"
                retrieved_blocks.append(f"[KAYNAK: {label}]\n{excerpt}")

    context = "\n\n---\n\n".join(retrieved_blocks[:24])
    visual_context = "\n\n".join(
        f"[GORSEL KANIT {index + 1}]\n{finding}"
        for index, finding in enumerate(visual_findings or [])
        if finding.strip()
    )
    visual_instruction = (
        "Metin belgelerindeki iddiaları, yüklenen görsellerdeki fiziksel bulgularla kıyasla "
        "ve çelişki varsa raporla. Görsel bulgu yoksa bunu ayrı bir eksiklik olarak belirt. "
        if visual_context
        else ""
    )
    prompt = (
        "Asagidaki hukuki metin parcalarini ve kullanici sorusunu dikkatlice oku. "
        "Her parcanin basinda [KAYNAK: Sayfa X, Paragraf Y | ...] etiketi vardir. "
        "Yalnizca bu kaynaklara dayanarak konus; kaynakta olmayan bir iddiayi kesin ifade etme. "
        f"{visual_instruction}"
        "Cevabi su formatta ver:\n"
        "1. Kaynakli Analiz: Her madde sonunda mutlaka [Sayfa X, Paragraf Y] biciminde kaynak yaz.\n"
        "2. Hukuktan Turkceye: Bulgulari vatandasin anlayacagi sade dille acikla.\n"
        "3. Avukat Gorus Notu Icin Oz: Kisa, delile dayali bir ozet ver.\n"
        "Eger sayfa/paragraf yoksa [Kaynak konumu belirtilmedi] yaz. Belirsizse belirt.\n\n"
        f"Soru: {sorgu}\n\nMetinler:\n{context}\n\nGorsel bulgular:\n{visual_context or 'Gorsel kanit yuklenmedi.'}"
    )
    answer = await chat_completion(
        [
            {"role": "system", "content": "Sen dikkatli bir hukuk yardimcisisin; kesin hukum vermezsin."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.15,
    )
    return answer, retrieved_blocks
