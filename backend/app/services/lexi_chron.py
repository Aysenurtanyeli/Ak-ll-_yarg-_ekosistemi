import json
import re
from datetime import date
from uuid import UUID

from openai import AsyncOpenAI

from app.config import get_settings
from app.schemas import LexiChronResponse, TimelineEvent


async def extract_timeline_with_llm(case_text_samples: str) -> list[TimelineEvent]:
    """Yapay dil modeli ile belge metinlerinden tarih–olay çiftleri çıkarır."""
    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key or None)
    system = (
        "Sen Türk hukuk belgelerinden olay ve tarih çıkaran bir yardımcısın. "
        "Yanıtı yalnızca geçerli JSON olarak ver: {\"events\":[{\"tarih\":\"YYYY-MM-DD veya bilinmiyor\", "
        "\"olay\":\"kısa açıklama\", \"kaynak\":\"ilgili kısa alıntı\"}]}."
    )
    user = f"Aşağıdaki metinlerden mümkün olduğunca çok tarih-olay çıkar:\n\n{case_text_samples[:12000]}"
    resp = await client.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    raw = resp.choices[0].message.content or "{}"
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
