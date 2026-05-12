import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chrono } from "react-chrono";
import { PdfDropZone } from "./components/PdfDropZone";

type TimelineEvent = {
  tarih: string;
  olay: string;
  kaynak: string;
  metadata_tarih?: string | null;
};

type PdfIngestResponse = {
  belge_kimligi: string;
  indekslenen_parcalar: number;
  ocr_kullanildi: boolean;
  uyari: string | null;
};

type BelgeRow = {
  id: string;
  dosya_adi: string;
  dokuman_turu: string;
  kisi_adi: string;
  tarih_iso: string | null;
};

const api = axios.create({ baseURL: "/api/v1" });

function etiketAnahtar(d: Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">) {
  return JSON.stringify([d.dokuman_turu, d.kisi_adi, d.tarih_iso ?? ""]);
}

function etiketEtiketGoster(d: Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">) {
  const k = (d.kisi_adi || "").trim() || "Kişi belirtilmedi";
  const t = (d.tarih_iso || "").trim();
  const tarihGoster = t ? t.slice(0, 10) : "Tarih yok";
  return `${d.dokuman_turu} · ${k} · ${tarihGoster}`;
}

function etikettenFiltre(anahtar: string): Record<string, string> {
  const a = JSON.parse(anahtar) as [string, string, string];
  const [dokuman_turu, kisi_adi, tarih] = a;
  const o: Record<string, string> = { dokuman_turu };
  if ((kisi_adi || "").trim()) o.kisi_adi = kisi_adi;
  if ((tarih || "").trim()) o.tarih = tarih;
  return o;
}

export default function App() {
  const [caseId, setCaseId] = useState("");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [chronDocType, setChronDocType] = useState("Genel");
  const [chronKisi, setChronKisi] = useState("");
  const [chronTarih, setChronTarih] = useState("");
  const [chronPdfBusy, setChronPdfBusy] = useState(false);
  const [chronPdfMsg, setChronPdfMsg] = useState<string | null>(null);

  const [cxCaseId, setCxCaseId] = useState("");
  const [cxQuery, setCxQuery] = useState(
    "Bu dosyadaki ifadeler ile teknik raporlar arasında çelişki var mı? Varsa maddeler halinde özetle."
  );
  const [cxAnswer, setCxAnswer] = useState("");
  const [cxLoading, setCxLoading] = useState(false);
  const [cxBelgeTur, setCxBelgeTur] = useState("Genel");
  const [cxBelgeKisi, setCxBelgeKisi] = useState("");
  const [cxBelgeTarih, setCxBelgeTarih] = useState("");
  const [cxPdfBusy, setCxPdfBusy] = useState(false);
  const [cxPdfMsg, setCxPdfMsg] = useState<string | null>(null);
  const [belgeler, setBelgeler] = useState<BelgeRow[]>([]);
  const [secilenEtiketler, setSecilenEtiketler] = useState<Set<string>>(() => new Set());

  const benzersizEtiketler = useMemo(() => {
    const m = new Map<string, Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">>();
    for (const b of belgeler) {
      const k = etiketAnahtar(b);
      if (!m.has(k)) m.set(k, { dokuman_turu: b.dokuman_turu, kisi_adi: b.kisi_adi, tarih_iso: b.tarih_iso });
    }
    return Array.from(m.entries());
  }, [belgeler]);

  const chronoItems = useMemo(
    () =>
      events.map((e) => ({
        title: e.tarih || "Tarih yok",
        cardTitle: e.olay,
        cardDetailedText: e.kaynak || e.metadata_tarih || "",
      })),
    [events]
  );

  const belgeleriYukle = useCallback(async (dosyaKimligi: string) => {
    try {
      const { data } = await api.get<BelgeRow[]>(`/cases/${dosyaKimligi}/belgeler`);
      setBelgeler(Array.isArray(data) ? data : []);
    } catch {
      setBelgeler([]);
    }
  }, []);

  useEffect(() => {
    const id = cxCaseId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setBelgeler([]);
      setSecilenEtiketler(new Set());
      return;
    }
    const t = window.setTimeout(() => {
      void belgeleriYukle(id);
    }, 350);
    return () => window.clearTimeout(t);
  }, [cxCaseId, belgeleriYukle]);

  const ingestChronPdf = useCallback(
    async (file: File) => {
      if (!caseId.trim()) {
        window.alert("Önce üstteki dosya kimliği (UUID) alanını doldurun.");
        return;
      }
      setChronPdfBusy(true);
      setChronPdfMsg(null);
      try {
        const fd = new FormData();
        fd.append("case_id", caseId.trim());
        fd.append("file", file);
        fd.append("dokuman_turu", chronDocType);
        fd.append("kisi_adi", chronKisi);
        if (chronTarih.trim()) {
          fd.append("tarih", chronTarih.trim());
        }
        const { data } = await api.post<PdfIngestResponse>("/documents/pdf/ingest", fd);
        let msg = `Vektör veri tabanına indekslendi: ${data.indekslenen_parcalar} parça. Belge no: ${data.belge_kimligi}`;
        if (data.ocr_kullanildi) msg += " (görüntüden metin tanıma kullanıldı)";
        if (data.uyari) msg += ` — ${data.uyari}`;
        setChronPdfMsg(msg);
      } catch {
        setChronPdfMsg(
          "PDF yüklenemedi veya metin çıkarılamadı. Sunucu yapılandırması, anahtarları ve dosya kimliğini (UUID) kontrol edin."
        );
      } finally {
        setChronPdfBusy(false);
      }
    },
    [caseId, chronDocType, chronKisi, chronTarih]
  );

  const ingestCrossPdf = useCallback(
    async (file: File) => {
      if (!cxCaseId.trim()) {
        window.alert("Önce bu bölümdeki dosya kimliğini (UUID) girin.");
        return;
      }
      setCxPdfBusy(true);
      setCxPdfMsg(null);
      try {
        const fd = new FormData();
        fd.append("case_id", cxCaseId.trim());
        fd.append("file", file);
        fd.append("dokuman_turu", cxBelgeTur);
        fd.append("kisi_adi", cxBelgeKisi);
        if (cxBelgeTarih.trim()) {
          fd.append("tarih", cxBelgeTarih.trim());
        }
        const { data } = await api.post<PdfIngestResponse>("/documents/pdf/ingest", fd);
        let msg = `Eklendi: ${data.indekslenen_parcalar} parça indekslendi.`;
        if (data.ocr_kullanildi) msg += " Görüntüden metin tanıma kullanıldı.";
        if (data.uyari) msg += ` ${data.uyari}`;
        setCxPdfMsg(msg);
        await belgeleriYukle(cxCaseId.trim());
      } catch {
        setCxPdfMsg("Yükleme başarısız. Kimlik, ağ ve sunucu anahtarlarını kontrol edin.");
      } finally {
        setCxPdfBusy(false);
      }
    },
    [cxCaseId, cxBelgeTur, cxBelgeKisi, cxBelgeTarih, belgeleriYukle]
  );

  function etiketTikla(anahtar: string) {
    setSecilenEtiketler((prev) => {
      const next = new Set(prev);
      if (next.has(anahtar)) next.delete(anahtar);
      else next.add(anahtar);
      return next;
    });
  }

  async function loadTimeline() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.get<{ events: TimelineEvent[] }>(`/lexi-chron/${caseId.trim()}`);
      setEvents(data.events || []);
    } catch {
      setError("Zaman çizelgesi yüklenemedi. Dosya kimliğini ve sunucu erişimini kontrol edin.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  async function runCrossExam() {
    setCxAnswer("");
    setCxLoading(true);
    try {
      const metadata_filters =
        secilenEtiketler.size === 0 ? [] : Array.from(secilenEtiketler).map((k) => etikettenFiltre(k));
      const { data } = await api.post<{ cevap: string }>("/lexi-cross", {
        case_id: cxCaseId.trim(),
        sorgu: cxQuery,
        metadata_filters,
        top_k: 10,
      });
      setCxAnswer(data.cevap);
    } catch {
      setCxAnswer(
        "İstek tamamlanamadı. Ortam değişkenleri ile vektör veri tabanı ve dil modeli sağlayıcı anahtarlarını doğrulayın."
      );
    } finally {
      setCxLoading(false);
    }
  }

  return (
    <div className="app">
      <h1>LexiGuard</h1>
      <p>Akıllı Yargı Ekosistemi — LexiChron (zaman çizgisi) ve LexiCross (çapraz sorgu)</p>

      <div className="panel">
        <h2>LexiChron — Zaman çizelgesi</h2>
        <div className="row">
          <div>
            <label htmlFor="case">Dosya kimliği (UUID)</label>
            <input
              id="case"
              placeholder="ör. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <div>
            <label htmlFor="chronDoc">Belge türü (üst veri)</label>
            <input
              id="chronDoc"
              placeholder="İfade, Olay Yeri Raporu…"
              value={chronDocType}
              onChange={(e) => setChronDocType(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="chronKisi">Kişi adı (isteğe bağlı)</label>
            <input id="chronKisi" value={chronKisi} onChange={(e) => setChronKisi(e.target.value)} />
          </div>
          <div>
            <label htmlFor="chronTarih">Tarih (yıl-ay-gün, isteğe bağlı)</label>
            <input
              id="chronTarih"
              placeholder="2024-01-15"
              value={chronTarih}
              onChange={(e) => setChronTarih(e.target.value)}
            />
          </div>
        </div>
        <PdfDropZone
          label="PDF ile belge yükle (metin çıkarılır ve vektör veri tabanına indekslenir)"
          hint="Önce dosya kimliğini (UUID) girin. Taranmış PDF’ler için sistemde Tesseract kurulu olmalıdır."
          disabled={chronPdfBusy}
          onPdfFile={ingestChronPdf}
        />
        {chronPdfMsg ? (
          <p className={chronPdfMsg.includes("yüklenemedi") || chronPdfMsg.includes("başarısız") ? "pdf-status warn" : "pdf-status"}>
            {chronPdfMsg}
          </p>
        ) : null}
        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" disabled={loading || !caseId.trim()} onClick={loadTimeline}>
            {loading ? "Yükleniyor…" : "Zaman çizgisini getir"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {chronoItems.length > 0 && (
          <div style={{ marginTop: "1rem" }}>
            <Chrono items={chronoItems} mode="VERTICAL_ALTERNATING" scrollable={{ scrollbar: true }} />
          </div>
        )}
        {!loading && !error && chronoItems.length === 0 && caseId && (
          <p style={{ color: "#64748b" }}>Bu dosya için olay bulunamadı veya henüz belge yüklenmedi.</p>
        )}
      </div>

      <div className="panel">
        <h2>LexiCross — Çapraz ifade incelemesi</h2>
        <div className="row">
          <div>
            <label htmlFor="cxCase">Dosya kimliği (UUID)</label>
            <input
              id="cxCase"
              placeholder="Karşılaştırma yapılacak dava dosyası"
              value={cxCaseId}
              onChange={(e) => setCxCaseId(e.target.value)}
            />
          </div>
        </div>

        <p className="panel-intro">
          Aşağıya PDF yükleyin; belgeler listelenir. İncelemede hangi tür, kişi ve tarih kombinasyonuna odaklanılacağını
          etiketlerden seçin. Hiç seçmezseniz tüm indekslenmiş metinler dikkate alınır.
        </p>

        <div className="row" style={{ marginTop: "0.75rem" }}>
          <div>
            <label htmlFor="cxDoc">Yüklenecek belgenin türü</label>
            <input
              id="cxDoc"
              placeholder="İfade, rapor, tapu…"
              value={cxBelgeTur}
              onChange={(e) => setCxBelgeTur(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="cxKisi">İlgili kişi (isteğe bağlı)</label>
            <input id="cxKisi" value={cxBelgeKisi} onChange={(e) => setCxBelgeKisi(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cxTar">Belge tarihi (isteğe bağlı)</label>
            <input
              id="cxTar"
              placeholder="2024-01-15"
              value={cxBelgeTarih}
              onChange={(e) => setCxBelgeTarih(e.target.value)}
            />
          </div>
        </div>

        <PdfDropZone
          label="Karşılaştırılacak belgeleri yükle"
          hint="PDF seçildiğinde metin çıkarılır ve bu dosyada karşılaştırma için indekslenir. Birden fazla belge için işlemi tekrarlayın."
          disabled={cxPdfBusy}
          onPdfFile={ingestCrossPdf}
        />
        {cxPdfMsg ? (
          <p className={cxPdfMsg.includes("başarısız") ? "pdf-status warn" : "pdf-status"}>{cxPdfMsg}</p>
        ) : null}

        {belgeler.length > 0 && (
          <div className="belge-blok">
            <h3 className="belge-baslik">Yüklenen belgeler</h3>
            <ul className="belge-liste">
              {belgeler.map((b) => (
                <li key={b.id} className="belge-satir">
                  <span className="belge-adi">{b.dosya_adi}</span>
                  <span className="belge-oz">
                    {b.dokuman_turu}
                    {(b.kisi_adi || "").trim() ? ` · ${b.kisi_adi}` : ""}
                    {b.tarih_iso ? ` · ${b.tarih_iso.slice(0, 10)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {benzersizEtiketler.length > 0 && (
          <div className="etiket-blok">
            <h3 className="etiket-baslik">İncelemede kullanılacak kayıtlar</h3>
            <p className="etiket-aciklama">Aşağıdaki etiketlere tıklayarak seçin veya seçimi kaldırın.</p>
            <div className="etiket-kutu">
              {benzersizEtiketler.map(([anahtar, d]) => (
                <button
                  key={anahtar}
                  type="button"
                  className={`etiket ${secilenEtiketler.has(anahtar) ? "etiket-secili" : ""}`}
                  onClick={() => etiketTikla(anahtar)}
                >
                  {etiketEtiketGoster(d)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <label htmlFor="cxQ">Ne incelemek istiyorsunuz?</label>
          <textarea
            id="cxQ"
            rows={4}
            placeholder="Örn: Tanık ifadesi ile olay yeri tutanağı arasında saat veya yer bakımından bir uyumsuzluk var mı?"
            value={cxQuery}
            onChange={(e) => setCxQuery(e.target.value)}
          />
        </div>

        <div style={{ marginTop: "0.75rem" }}>
          <button type="button" disabled={cxLoading || !cxCaseId.trim()} onClick={runCrossExam}>
            {cxLoading ? "Analiz ediliyor…" : "Belgeleri analiz et"}
          </button>
        </div>
        {cxAnswer && (
          <div className="analiz-sonuc" style={{ marginTop: "1rem", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {cxAnswer}
          </div>
        )}
      </div>
    </div>
  );
}
