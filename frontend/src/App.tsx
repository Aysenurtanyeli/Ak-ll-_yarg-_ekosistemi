import axios from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PdfDropZone } from "./components/PdfDropZone";

type TimelineEvent = {
  tarih: string;
  olay: string;
  kaynak: string;
  metadata_tarih?: string | null;
};

type PdfIngestResponse = {
  case_id: string;
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

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item?.msg || JSON.stringify(item)).join(" ");
    }
    if (error.message) {
      return error.message;
    }
  }
  return fallback;
}

function etiketAnahtar(
  d: Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">,
) {
  return JSON.stringify([d.dokuman_turu, d.kisi_adi, d.tarih_iso ?? ""]);
}

function etiketEtiketGoster(
  d: Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">,
) {
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

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    return "&gt;";
  });
}

function splitAnalysisSections(text: string) {
  const sections: Array<{ title: string; body: string }> = [];
  let currentTitle = "Analiz";
  let currentLines: string[] = [];
  const headingRe =
    /^\s*(?:\d+\.\s*)?(Kaynakl[ıi] Analiz|Hukuktan T[üu]rk[çc]eye|Avukat G[öo]r[üu][şs] Notu I[çc]in [ÖO]z|Avukat G[öo]r[üu][şs] Notu İçin Öz)\s*:?\s*$/i;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(headingRe);
    if (match) {
      if (currentLines.join("\n").trim()) {
        sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
      }
      currentTitle = match[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join("\n").trim()) {
    sections.push({ title: currentTitle, body: currentLines.join("\n").trim() });
  }
  return sections.length ? sections : [{ title: "Analiz", body: text }];
}

function CitationText({ text }: { text: string }) {
  const parts = text.split(/(\[(?:Sayfa \d+(?:,\s*Paragraf \d+)?|Kaynak konumu belirtilmedi)\])/g);
  return (
    <>
      {parts.map((part, index) => {
        if (/^\[(?:Sayfa \d+(?:,\s*Paragraf \d+)?|Kaynak konumu belirtilmedi)\]$/.test(part)) {
          return (
            <span className="source-badge" key={`${part}-${index}`}>
              {part.slice(1, -1)}
            </span>
          );
        }
        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </>
  );
}

function AnalysisOutput({ text }: { text: string }) {
  const sections = splitAnalysisSections(text);
  return (
    <div className="analysis-grid">
      {sections.map((section) => (
        <section className="analysis-section" key={section.title}>
          <h3>{section.title}</h3>
          <div className="analysis-copy">
            <CitationText text={section.body} />
          </div>
        </section>
      ))}
    </div>
  );
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
    "Bu dosyadaki ifadeler ile teknik raporlar arasında çelişki var mı? Varsa maddeler halinde özetle.",
  );
  const [cxAnswer, setCxAnswer] = useState("");
  const [cxLoading, setCxLoading] = useState(false);
  const [cxBelgeTur, setCxBelgeTur] = useState("Genel");
  const [cxBelgeKisi, setCxBelgeKisi] = useState("");
  const [cxBelgeTarih, setCxBelgeTarih] = useState("");
  const [cxPdfBusy, setCxPdfBusy] = useState(false);
  const [cxPdfMsg, setCxPdfMsg] = useState<string | null>(null);
  const [visionPrompt, setVisionPrompt] = useState(
    "Görselde fren izi, araç hasarı, yol durumu, trafik işareti veya olay yeri açısından hukuki önem taşıyabilecek bulguları incele. Görsel net değilse hangi açıdan veya hangi orijinal fotoğrafla tekrar yüklenmesi gerektiğini belirt.",
  );
  const [visionAnswer, setVisionAnswer] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const [belgeler, setBelgeler] = useState<BelgeRow[]>([]);
  const [secilenEtiketler, setSecilenEtiketler] = useState<Set<string>>(
    () => new Set(),
  );

  const benzersizEtiketler = useMemo(() => {
    const m = new Map<
      string,
      Pick<BelgeRow, "dokuman_turu" | "kisi_adi" | "tarih_iso">
    >();
    for (const b of belgeler) {
      const k = etiketAnahtar(b);
      if (!m.has(k))
        m.set(k, {
          dokuman_turu: b.dokuman_turu,
          kisi_adi: b.kisi_adi,
          tarih_iso: b.tarih_iso,
        });
    }
    return Array.from(m.entries());
  }, [belgeler]);

  const belgeleriYukle = useCallback(async (dosyaKimligi: string) => {
    try {
      const { data } = await api.get<BelgeRow[]>(
        `/cases/${dosyaKimligi}/belgeler`,
      );
      setBelgeler(Array.isArray(data) ? data : []);
    } catch {
      setBelgeler([]);
    }
  }, []);

  useEffect(() => {
    const id = cxCaseId.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
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
      const currentCaseId = caseId.trim();
      setChronPdfBusy(true);
      setChronPdfMsg(null);
      try {
        const fd = new FormData();
        if (currentCaseId) {
          fd.append("case_id", currentCaseId);
        }
        fd.append("file", file);
        fd.append("dokuman_turu", chronDocType);
        fd.append("kisi_adi", chronKisi);
        if (chronTarih.trim()) {
          fd.append("tarih", chronTarih.trim());
        }
        const { data } = await api.post<PdfIngestResponse>(
          "/documents/pdf/ingest",
          fd,
        );
        setCaseId(data.case_id);
        let msg =
          data.indekslenen_parcalar > 0
            ? `Vektör veri tabanına indekslendi: ${data.indekslenen_parcalar} parça. Belge no: ${data.belge_kimligi}`
            : `Belge kaydedildi. Vektör indeksleme beklemede/atlanmış görünüyor. Belge no: ${data.belge_kimligi}`;
        if (data.ocr_kullanildi) msg += " (görüntüden metin tanıma kullanıldı)";
        if (data.uyari) msg += ` — ${data.uyari}`;
        setChronPdfMsg(
          `${currentCaseId ? "PDF mevcut dosyaya eklendi." : "Yeni dosya oluşturuldu; ID otomatik atandı."} ${msg}`,
        );
      } catch (err) {
        setChronPdfMsg(
          apiErrorMessage(
            err,
            "PDF yüklenemedi veya metin çıkarılamadı. Sunucu yapılandırmasını, anahtarları ve ağ erişimini kontrol edin.",
          ),
        );
      } finally {
        setChronPdfBusy(false);
      }
    },
    [caseId, chronDocType, chronKisi, chronTarih],
  );

  const ingestCrossPdf = useCallback(
    async (file: File) => {
      const currentCaseId = cxCaseId.trim();
      setCxPdfBusy(true);
      setCxPdfMsg(null);
      try {
        const fd = new FormData();
        if (currentCaseId) {
          fd.append("case_id", currentCaseId);
        }
        fd.append("file", file);
        fd.append("dokuman_turu", cxBelgeTur);
        fd.append("kisi_adi", cxBelgeKisi);
        if (cxBelgeTarih.trim()) {
          fd.append("tarih", cxBelgeTarih.trim());
        }
        const { data } = await api.post<PdfIngestResponse>(
          "/documents/pdf/ingest",
          fd,
        );
        setCxCaseId(data.case_id);
        let msg =
          data.indekslenen_parcalar > 0
            ? `Eklendi: ${data.indekslenen_parcalar} parça indekslendi.`
            : "Belge kaydedildi. Vektör indeksleme beklemede/atlanmış görünüyor.";
        if (data.ocr_kullanildi) msg += " Görüntüden metin tanıma kullanıldı.";
        if (data.uyari) msg += ` ${data.uyari}`;
        setCxPdfMsg(
          `${currentCaseId ? "PDF mevcut dosyaya eklendi." : "Yeni dosya oluşturuldu; ID otomatik atandı."} ${msg}`,
        );
        await belgeleriYukle(data.case_id);
      } catch (err) {
        setCxPdfMsg(
          apiErrorMessage(
            err,
            "Yükleme başarısız. Ağ erişimini ve sunucu anahtarlarını kontrol edin.",
          ),
        );
      } finally {
        setCxPdfBusy(false);
      }
    },
    [cxCaseId, cxBelgeTur, cxBelgeKisi, cxBelgeTarih, belgeleriYukle],
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
      const { data } = await api.get<{ events: TimelineEvent[] }>(
        `/lexi-chron/${caseId.trim()}`,
      );
      setEvents(data.events || []);
    } catch (err) {
      setError(
        apiErrorMessage(
          err,
          "Zaman çizelgesi yüklenemedi. Dosya kimliğini ve sunucu erişimini kontrol edin.",
        ),
      );
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
        secilenEtiketler.size === 0
          ? []
          : Array.from(secilenEtiketler).map((k) => etikettenFiltre(k));
      const { data } = await api.post<{ cevap: string }>("/lexi-cross", {
        case_id: cxCaseId.trim(),
        sorgu: cxQuery,
        metadata_filters,
        top_k: 10,
      });
      setCxAnswer(data.cevap);
    } catch (e) {
      setCxAnswer(
        apiErrorMessage(
          e,
          "İstek tamamlanamadı. Ollama servisinin ve modellerin çalıştığını doğrulayın.",
        ),
      );
    } finally {
      setCxLoading(false);
    }
  }

  async function analyzeEvidenceImage(file: File | null) {
    if (!file) return;
    setVisionAnswer("");
    setVisionBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("prompt", visionPrompt);
      const { data } = await api.post<{ cevap: string }>("/vision/analyze", fd);
      setVisionAnswer(data.cevap);
    } catch (e) {
      setVisionAnswer(
        apiErrorMessage(
          e,
          "Görsel analiz tamamlanamadı. Ollama servisinin ve vision destekli modelin çalıştığını doğrulayın.",
        ),
      );
    } finally {
      setVisionBusy(false);
    }
  }

  function printAnalysis(kind: "Avukat Görüş Notu" | "Dilekçe Taslağı") {
    const analysis = cxAnswer.trim();
    const visual = visionAnswer.trim();
    if (!analysis && !visual) return;
    const title = `${kind} - Akıllı Yargı Analizi`;
    const body =
      kind === "Dilekçe Taslağı"
        ? `Sayın Mahkemeye,\n\nAşağıda belirtilen belge ve kanıt incelemesi kapsamında, dosyada öne çıkan hususların değerlendirilmesi arz olunur.\n\n${analysis}\n\nGörsel Kanıt Değerlendirmesi:\n${visual || "Görsel kanıt analizi eklenmemiştir."}\n\nSonuç ve Talep:\nDelile dayalı tespitlerin yargılama kapsamında dikkate alınmasını saygıyla arz ve talep ederiz.`
        : `Konu: Belge ve kanıt inceleme notu\n\n${analysis}\n\nGörsel Kanıt Değerlendirmesi:\n${visual || "Görsel kanıt analizi eklenmemiştir."}`;
    const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;line-height:1.55;color:#172033;padding:32px}h1{font-size:24px}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(body)}</pre></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Belge destekli hukuk analizi</p>
          <h1>Akıllı Yargı Analizi</h1>
        </div>
        <span className="system-status">Ollama yerel model</span>
      </header>

      <div className="panel">
        <h2>Dosya zaman akışı</h2>
        <div className="row">
          <div>
            <div className="field-label-row">
              <label htmlFor="case">Dosya kimliği (UUID)</label>
              <span className="auto-badge">Otomatik atanır</span>
            </div>
            <input
              id="case"
              placeholder="PDF yüklenince otomatik atanır"
              value={caseId}
              readOnly
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
            <input
              id="chronKisi"
              value={chronKisi}
              onChange={(e) => setChronKisi(e.target.value)}
            />
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
          label="Belge yükle"
          hint="PDF yüklendiğinde dosya kimliği otomatik oluşur ve metin analiz için indekslenir."
          disabled={chronPdfBusy}
          onPdfFile={ingestChronPdf}
        />
        {chronPdfMsg ? (
          <p
            className={
              chronPdfMsg.includes("yüklenemedi") ||
              chronPdfMsg.includes("başarısız")
                ? "pdf-status warn"
                : "pdf-status"
            }
          >
            {chronPdfMsg}
          </p>
        ) : null}
        <div style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            disabled={loading || !caseId.trim()}
            onClick={loadTimeline}
          >
            {loading ? "Yükleniyor..." : "Zaman akışını getir"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {events.length > 0 && (
          <ol className="timeline-list">
            {events.map((event, index) => (
              <li className="timeline-item" key={`${event.tarih}-${index}`}>
                <div className="timeline-date">
                  {event.tarih || "Tarih yok"}
                </div>
                <div className="timeline-card">
                  <h3>{event.olay || "Tarihli olay"}</h3>
                  {(event.kaynak || event.metadata_tarih) && (
                    <p>{event.kaynak || event.metadata_tarih}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {!loading && !error && events.length === 0 && caseId && (
          <p style={{ color: "#64748b" }}>
            Bu dosya için olay bulunamadı veya henüz belge yüklenmedi.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Belge karşılaştırma</h2>
        <div className="row">
          <div>
            <div className="field-label-row">
              <label htmlFor="cxCase">Dosya kimliği (UUID)</label>
              <span className="auto-badge">Otomatik atanır</span>
            </div>
            <input
              id="cxCase"
              placeholder="PDF yüklenince otomatik atanır"
              value={cxCaseId}
              readOnly
            />
          </div>
        </div>

        <p className="panel-intro">
          Belgeleri aynı dosyada toplayın, ardından sistemden ifadeler, raporlar
          ve tarihler arasındaki uyumsuzlukları incelemesini isteyin.
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
            <input
              id="cxKisi"
              value={cxBelgeKisi}
              onChange={(e) => setCxBelgeKisi(e.target.value)}
            />
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
          hint="Birden fazla belge için yükleme işlemini tekrarlayın; tüm belgeler aynı dosyada değerlendirilir."
          disabled={cxPdfBusy}
          onPdfFile={ingestCrossPdf}
        />
        {cxPdfMsg ? (
          <p
            className={
              cxPdfMsg.includes("başarısız") ? "pdf-status warn" : "pdf-status"
            }
          >
            {cxPdfMsg}
          </p>
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
            <p className="etiket-aciklama">
              Etiketlere tıklayarak analizin odaklanacağı kayıtları seçin.
            </p>
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

        <div className="evidence-panel">
          <div>
            <h3 className="etiket-baslik">Görsel kanıt analizi</h3>
            <p className="etiket-aciklama">
              Fotoğraf yükleyerek hasar, iz, yol durumu veya olay yeri
              bulgularını ayrıca inceletebilirsiniz.
            </p>
          </div>
          <label htmlFor="visionPrompt">Görsel inceleme notu</label>
          <textarea
            id="visionPrompt"
            rows={3}
            value={visionPrompt}
            onChange={(e) => setVisionPrompt(e.target.value)}
          />
          <div className="image-upload-row">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={visionBusy}
              onChange={(e) => {
                void analyzeEvidenceImage(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </div>
          {visionAnswer && (
            <div className="analiz-sonuc evidence-result">{visionAnswer}</div>
          )}
        </div>

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
          <button
            type="button"
            disabled={cxLoading || !cxCaseId.trim()}
            onClick={runCrossExam}
          >
            {cxLoading ? "Analiz ediliyor…" : "Belgeleri analiz et"}
          </button>
        </div>
        {cxAnswer && (
          <>
            <AnalysisOutput text={cxAnswer} />
            <div className="output-actions">
              <button type="button" onClick={() => printAnalysis("Avukat Görüş Notu")}>
                Avukat görüş notu PDF
              </button>
              <button type="button" onClick={() => printAnalysis("Dilekçe Taslağı")}>
                Dilekçe taslağı PDF
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
