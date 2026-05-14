import json
import re
from datetime import date

from app.schemas import TimelineEvent
from app.services.llm import chat_completion


def _normalize_date(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return value
    m = re.fullmatch(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", value)
    if not m:
        return value
    day, month, year = [int(x) for x in m.groups()]
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return value


def _clean_excerpt(text: str, limit: int = 520) -> str:
    cleaned = " ".join(text.split())
    return cleaned[:limit].strip()


def _event_title_from_context(context: str) -> str:
    cleaned = _clean_excerpt(context, 360)
    m = re.search(r"Olay\s*Ozeti\s*:\s*(.+)", cleaned, flags=re.IGNORECASE)
    if not m:
        m = re.search(r"Olay\s*Özeti\s*:\s*(.+)", cleaned, flags=re.IGNORECASE)
    if m:
        summary = re.split(r"(?<=[.!?])\s+| Teknik Bulgular\s*:", m.group(1), maxsplit=1)[0]
        return summary[:180].strip() or "Belgede tarihli olay tespit edildi"

    parts = re.split(r"(?<=[.!?])\s+", cleaned)
    for part in parts:
        if re.search(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})\b", part):
            return part[:180].strip()
    return "Belgede tarihli olay tespit edildi"


def extract_timeline_locally(case_text_samples: str) -> list[TimelineEvent]:
    """LLM kullanilamadiginda metindeki acik tarihleri basit bir yerel yontemle cikarir."""
    pattern = re.compile(r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})\b")
    events: list[TimelineEvent] = []
    seen: set[tuple[str, str]] = set()
    for match in pattern.finditer(case_text_samples):
        tarih = _normalize_date(match.group(0))
        line_start = case_text_samples.rfind("\n", 0, match.start()) + 1
        start = max(line_start, match.start() - 120)
        end = min(len(case_text_samples), match.end() + 260)
        excerpt = _clean_excerpt(case_text_samples[start:end])
        olay = _event_title_from_context(excerpt)
        key = (tarih, olay)
        if key in seen:
            continue
        seen.add(key)
        events.append(TimelineEvent(tarih=tarih, olay=olay, kaynak=excerpt))
    return events[:40]


async def extract_timeline_with_llm(case_text_samples: str) -> list[TimelineEvent]:
    """Yapay dil modeli ile belge metinlerinden tarih–olay çiftleri çıkarır."""
    system = (
        "Sen Türk hukuk belgelerinden olay ve tarih çıkaran bir yardımcısın. "
        "Yanıtı yalnızca geçerli JSON olarak ver: {\"events\":[{\"tarih\":\"YYYY-MM-DD veya bilinmiyor\", "
        "\"olay\":\"kısa açıklama\", \"kaynak\":\"ilgili kısa alıntı\"}]}."
    )
    user = f"Aşağıdaki metinlerden mümkün olduğunca çok tarih-olay çıkar:\n\n{case_text_samples[:12000]}"
    raw = await chat_completion(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    events = []
    for e in data.get("events", []):
        events.append(
            TimelineEvent(
                tarih=str(e.get("tarih", "")),
                olay=str(e.get("olay", "")),
                kaynak=str(e.get("kaynak", "")),
            )
        )
    return events


def merge_with_metadata(
    llm_events: list[TimelineEvent],
    metadata_rows: list[dict[str, str]],
) -> list[TimelineEvent]:
    """Parça üst verisindeki tarihler ile dil modeli olaylarını birleştirir ve sıralar."""
    merged: list[TimelineEvent] = list(llm_events)
    for row in metadata_rows:
        t = row.get("tarih") or ""
        if not t:
            continue
        merged.append(
            TimelineEvent(
                tarih=t,
                olay=f"[Üst veri] {row.get('dokuman_turu', '')} — {row.get('kisi_adi', '')}".strip(),
                kaynak=row.get("text_excerpt", ""),
                metadata_tarih=t,
            )
        )

    def sort_key(ev: TimelineEvent) -> tuple[int, str]:
        try:
            d = date.fromisoformat(ev.tarih[:10])
            return (d.toordinal(), ev.olay)
        except Exception:
            return (999999999, ev.olay)

    merged.sort(key=sort_key)
    return merged
