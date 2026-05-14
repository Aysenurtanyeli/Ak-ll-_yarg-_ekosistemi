from datetime import date
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DocumentIngestRequest(BaseModel):
    case_id: UUID
    filename: str
    text: str
    dokuman_turu: str = "Genel"
    kisi_adi: str = ""
    tarih: date | None = None


class PdfExtractResponse(BaseModel):
    metin: str
    ocr_kullanildi: bool = False
    uyari: str | None = None


class PdfIngestResponse(BaseModel):
    case_id: UUID
    belge_kimligi: str
    indekslenen_parcalar: int
    ocr_kullanildi: bool = False
    uyari: str | None = None
    indeksleme_durumu: str = "tamamlandi"


class TimelineEvent(BaseModel):
    tarih: str
    olay: str
    kaynak: str = ""
    metadata_tarih: str | None = None


class LexiChronResponse(BaseModel):
    events: list[TimelineEvent]


class CrossExamRequest(BaseModel):
    case_id: UUID
    sorgu: str
    metadata_filters: list[dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "Üst veri ile vektör veri tabanı süzmesi. Örnek: "
            "[{'kisi_adi': 'Tanık A', 'dokuman_turu': 'İfade'}, {'dokuman_turu': 'Olay Yeri Raporu'}]"
        ),
    )
    top_k: int = 8


class CrossExamResponse(BaseModel):
    cevap: str
    kaynak_ozetleri: list[str] = Field(default_factory=list)


class CaseCreate(BaseModel):
    title: str
    hukuki_ozet: str = ""


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    hukuki_ozet: str


class BelgeListItem(BaseModel):
    """Dava dosyasına eklenmiş belgeler — arayüzde etiket ve liste için."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dosya_adi: str
    dokuman_turu: str
    kisi_adi: str
    tarih_iso: str | None = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    case_id: UUID
    title: str
    message: str
    source_url: str
    similarity: float
    read: bool


class DecisionSimulationRequest(BaseModel):
    case_id: UUID
    baslik: str = "Yargitay yeni tazminat hesaplama karari"
    konu: str = "tazminat hesaplamasi"
    hukuki_gerekce: str = "kusur, zarar, bilirkisi raporu ve tazminat hesabi"
    source_url: str = "simule://leksialert/yeni-karar"


class CaseUpdate(BaseModel):
    title: str | None = None
    hukuki_ozet: str | None = None


class WebhookIngestPayload(BaseModel):
    """Sürekli entegrasyon veya harici hizmetten tetiklenebilen hafif yük yapısı: yeni belge veya özet güncellemesi."""

    event_type: str = "document.ingested"
    case_id: UUID | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
