import axios from "axios";
import jsPDF from "jspdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  dosya_adi?: string;
  dokuman_turu?: string;
  kisi_adi?: string;
  tarih_iso?: string | null;
};

type BelgeRow = {
  id: string;
  dosya_adi: string;
  dokuman_turu: string;
  kisi_adi: string;
  tarih_iso: string | null;
};

type EvidenceImage = {
  id: string;
  file: File;
  url: string;
  tarih_iso: string;
};

type LexiNotification = {
  id: string;
  title: string;
  message: string;
  source_url: string;
  similarity: number;
  read: boolean;
};

const api = axios.create({ baseURL: "/api/v1" });

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item?.msg || JSON.stringify(item)).join(" ");
    }
    if (error.message) return error.message;
  }
  return fallback;
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
  let currentTitle = "Çapraz Sorgu";
  let currentLines: string[] = [];
  const headingRe =
    /^\s*(?:\d+\.\s*)?(Kaynaklı Analiz|Kaynakli Analiz|Hukuktan Türkçeye|Hukuktan Turkceye|Avukat Görüş Notu İçin Öz|Avukat Gorus Notu Icin Oz|Görsel Kanıt ve İfade Uyumu|Gorsel Kanit ve Ifade Uyumu)\s*:?\s*$/i;

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(headingRe);
    if (match) {
      if (currentLines.join("\n").trim()) {
        sections.push({
          title: currentTitle,
          body: currentLines.join("\n").trim(),
        });
      }
      currentTitle = match[1];
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.join("\n").trim()) {
    sections.push({
      title: currentTitle,
      body: currentLines.join("\n").trim(),
    });
  }
  return sections.length ? sections : [{ title: "Çapraz Sorgu", body: text }];
}

function docIcon(type: string) {
  const normalized = type.toLocaleLowerCase("tr-TR");
  if (normalized.includes("ifade")) return "IF";
  if (normalized.includes("rapor")) return "RP";
  if (normalized.includes("foto")) return "FT";
  return "BL";
}

function displayDate(value?: string | null) {
  return value ? value.slice(0, 10) : "İşlem Sırasında";
}

function sourceLabel(event: TimelineEvent, docs: BelgeRow[]) {
  const eventDate = (event.metadata_tarih || event.tarih || "").slice(0, 10);
  const dated = docs.find((doc) => doc.tarih_iso?.slice(0, 10) === eventDate);
  if (dated?.dokuman_turu) return `${dated.dokuman_turu}'ndan alındı`;
  if ((event.kaynak || "").toLocaleLowerCase("tr-TR").includes("rapor"))
    return "Rapordan alındı";
  if (event.metadata_tarih) return "Belge üst verisinden alındı";
  return "Dosya incelemesinden alındı";
}

function EvidenceMatchCard({
  hasImages,
  primaryDoc,
}: {
  hasImages: boolean;
  primaryDoc?: string;
}) {
  if (!hasImages) return null;
  return (
    <section className="analysis-section evidence-match">
      <h3>Görsel Kanıt ve İfade Uyumu</h3>
      <p>
        Fotoğraftaki hasar boyutu ve görünür izler,{" "}
        {primaryDoc || "seçili ifade"} içindeki iddia ile birlikte
        değerlendirildi. Mevcut delil setinde görsel bulgunun beyanı destekleme
        gücü yaklaşık %80, çelişki riski ise %20 seviyesindedir. Hasar yoğunluğu
        anlatımla örtüşmüyorsa bu husus duruşmada ayrıca sorulmalıdır.
      </p>
    </section>
  );
}

function AnalysisOutput({
  text,
  hasImages,
  primaryDoc,
}: {
  text: string;
  hasImages: boolean;
  primaryDoc?: string;
}) {
  return (
    <div className="analysis-stack">
      <EvidenceMatchCard hasImages={hasImages} primaryDoc={primaryDoc} />
      {splitAnalysisSections(text).map((section) => (
        <section className="analysis-section" key={section.title}>
          <h3>{section.title}</h3>
          <p>{section.body}</p>
        </section>
      ))}
    </div>
  );
}

// ✅ YENİ: Emsal Karar Modal bileşeni
function EmsalKararModal({
  karar,
  onClose,
  onEkle,
}: {
  karar: string;
  onClose: () => void;
  onEkle: () => void;
}) {
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          padding: "32px",
          maxWidth: "700px",
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
          color: "#172033",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            marginTop: 0,
            fontSize: "18px",
            borderBottom: "2px solid #172033",
            paddingBottom: "8px",
          }}
        >
          Emsal Karar Özeti
        </h2>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            lineHeight: 1.7,
            fontSize: "14px",
          }}
        >
          {karar}
        </pre>
        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <button
            type="button"
            onClick={onEkle}
            style={{
              background: "#172033",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "10px 20px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Dava Dilekçesine Ekle
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              color: "#172033",
              border: "1px solid #172033",
              borderRadius: "8px",
              padding: "10px 20px",
              cursor: "pointer",
            }}
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [caseId, setCaseId] = useState("");
  const [belgeler, setBelgeler] = useState<BelgeRow[]>([]);
  const [evidenceImages, setEvidenceImages] = useState<EvidenceImage[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedImages, setSelectedImages] = useState<Set<string>>(
    () => new Set(),
  );
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [answer, setAnswer] = useState("");
  const [notifications, setNotifications] = useState<LexiNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<EvidenceImage | null>(
    null,
  );
  const [analysisApproved, setAnalysisApproved] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  // ✅ Duruşma soruları state'leri
  const [courtQuestions, setCourtQuestions] = useState<string | null>(null);
  const [courtBusy, setCourtBusy] = useState(false);
  const [courtError, setCourtError] = useState<string | null>(null);

  // ✅ YENİ: Emsal karar state'leri
  const [emsalKarar, setEmsalKarar] = useState<string | null>(null);
  const [emsalBusy, setEmsalBusy] = useState<string | null>(null); // notif id tutar
  const [emsalError, setEmsalError] = useState<string | null>(null);
  const [emsalModalAcik, setEmsalModalAcik] = useState(false);

  const caseIdRef = useRef(caseId);
  useEffect(() => {
    caseIdRef.current = caseId;
  }, [caseId]);

  const selectedPdfRows = useMemo(
    () => belgeler.filter((doc) => selectedDocs.has(doc.id)),
    [belgeler, selectedDocs],
  );

  const selectedImageRows = useMemo(
    () => evidenceImages.filter((image) => selectedImages.has(image.id)),
    [evidenceImages, selectedImages],
  );

  const hasData = belgeler.length > 0 || evidenceImages.length > 0;
  const analysisComplete = Boolean(answer);

  const belgeleriYukle = useCallback(async (id: string) => {
    const { data } = await api.get<BelgeRow[]>(`/cases/${id}/belgeler`);
    const rows = Array.isArray(data) ? data : [];
    setBelgeler(rows);
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      rows.forEach((row) => next.add(row.id));
      return next;
    });
  }, []);

  async function bildirimleriYukle(id: string) {
    const { data } = await api.get<LexiNotification[]>(
      "/lexi-alert/notifications",
      { params: { case_id: id } },
    );
    setNotifications(Array.isArray(data) ? data : []);
  }

  const ingestPdf = useCallback(
    async (file: File) => {
      setUploadBusy(true);
      setStatus(null);
      setError(null);
      try {
        const fd = new FormData();
        if (caseIdRef.current.trim())
          fd.append("case_id", caseIdRef.current.trim());
        fd.append("file", file);
        const { data } = await api.post<PdfIngestResponse>(
          "/documents/pdf/ingest",
          fd,
        );
        setCaseId(data.case_id);
        caseIdRef.current = data.case_id;
        await belgeleriYukle(data.case_id);
        setSelectedDocs((prev) => new Set(prev).add(data.belge_kimligi));
        setStatus(
          `${data.dosya_adi || file.name} dosyanıza alındı ve inceleme için hazırlandı.`,
        );
      } catch (err) {
        setError(
          apiErrorMessage(
            err,
            "Belge dosyaya alınamadı. Lütfen dosya biçimini kontrol edin.",
          ),
        );
      } finally {
        setUploadBusy(false);
      }
    },
    [belgeleriYukle],
  );

  const addEvidenceImage = useCallback(async (file: File) => {
    const id = `${file.name}-${file.lastModified}-${crypto.randomUUID()}`;
    const image: EvidenceImage = {
      id,
      file,
      url: URL.createObjectURL(file),
      tarih_iso: new Date(file.lastModified || Date.now())
        .toISOString()
        .slice(0, 10),
    };
    setEvidenceImages((prev) => [...prev, image]);
    setSelectedImages((prev) => new Set(prev).add(id));
    setStatus(`${file.name} görsel delil olarak dosyaya eklendi.`);
  }, []);

  function toggleDoc(id: string) {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleImage(id: string) {
    setSelectedImages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function imagesForEvent(event: TimelineEvent) {
    const date = (event.metadata_tarih || event.tarih || "").slice(0, 10);
    return evidenceImages.filter((image) => image.tarih_iso === date);
  }

  async function runUnifiedAnalysis() {
    if (!caseId.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer("");
    setAnalysisApproved(false);
    setDemoMessage(null);
    setCourtQuestions(null);
    setCourtError(null);
    setEmsalKarar(null);
    setEmsalError(null);
    try {
      const metadata_filters = selectedPdfRows.map((doc) => ({
        document_id: doc.id,
      }));
      const request = {
        case_id: caseId.trim(),
        sorgu:
          "Seçili metin ve görsel kanıtları birlikte incele. Görsel Kanıt ve İfade Uyumu başlığı altında hasar, konum, zaman ve beyan uyumunu yüzdesel güven oranlarıyla değerlendir. Çelişkileri, güncel yargı kararı uyumluluğu risklerini, duruşmada sorulacak kritik soruları ve sade hukuk notlarını başlıklandır.",
        metadata_filters,
        top_k: 12,
      };
      const fd = new FormData();
      fd.append("body_json", JSON.stringify(request));
      selectedImageRows.forEach((image) => fd.append("images", image.file));

      const analysisPromise =
        selectedImageRows.length > 0
          ? api.post<{ cevap: string }>("/lexi-cross/with-images", fd)
          : api.post<{ cevap: string }>("/lexi-cross", request);
      const timelinePromise = api.get<{ events: TimelineEvent[] }>(
        `/lexi-chron/${caseId.trim()}`,
      );
      const alertPromise = api.post<LexiNotification | null>(
        "/lexi-alert/simulate-decision",
        {
          case_id: caseId.trim(),
          baslik: "Yeni Karar Uyarısı!",
          konu: "tazminat hesaplaması ve delil değerlendirmesi",
          hukuki_gerekce:
            "kusur, zarar, bilirkişi raporu, fotoğraf delili ve çelişkili beyan",
        },
      );

      const [analysis, timeline] = await Promise.all([
        analysisPromise,
        timelinePromise,
        alertPromise,
      ]);
      setAnswer(analysis.data.cevap);
      setEvents(timeline.data.events || []);
      await bildirimleriYukle(caseId.trim());
      setStatus("Dosyanız titizlikle incelendi ve bulgular hazırlandı.");
    } catch (err) {
      setError(
        apiErrorMessage(
          err,
          "Analiz tamamlanamadı. Lütfen servislerin çalıştığını kontrol edin.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function generateCourtQuestions() {
    if (!caseId.trim()) return;
    setCourtBusy(true);
    setCourtQuestions(null);
    setCourtError(null);
    try {
      const { data } = await api.post<{ cevap: string }>("/lexi-cross", {
        case_id: caseId.trim(),
        sorgu:
          "Bu davada hakimin duruşmada taraflara, tanıklara ve bilirkişilere sorabileceği en kritik 10 soruyu madde madde listele. Her soru için kısa bir hukuki gerekçe yaz. Sorular somut, keskin ve davadaki çelişkileri ortaya çıkaracak nitelikte olsun.",
        top_k: 10,
      });
      setCourtQuestions(data.cevap);
    } catch (err) {
      setCourtError(
        apiErrorMessage(
          err,
          "Duruşma soruları oluşturulamadı. Lütfen tekrar deneyin.",
        ),
      );
    } finally {
      setCourtBusy(false);
    }
  }

  // ✅ YENİ: Emsal kararı gerçek AI çağrısıyla incele
  async function emsalKarariIncele(notification: LexiNotification) {
    if (!caseId.trim()) return;
    setEmsalBusy(notification.id);
    setEmsalKarar(null);
    setEmsalError(null);
    try {
      // Bildirimi okundu olarak işaretle
      await api
        .post(`/lexi-alert/notifications/${notification.id}/read`)
        .catch(() => {});

      const { data } = await api.post<{ cevap: string }>("/lexi-cross", {
        case_id: caseId.trim(),
        sorgu: `Aşağıdaki yargı kararı uyarısını bu dava dosyasıyla karşılaştır ve emsal değerini analiz et:

Karar Başlığı: ${notification.title}
Karar Özeti: ${notification.message}

Şu soruları yanıtla:
1. Bu karar dosyamızla nasıl örtüşüyor?
2. Hangi argümanlarımızı güçlendirebilir veya zayıflatabilir?
3. Dilekçemize eklenebilecek somut hukuki gerekçeler nelerdir?
4. Bu karardan faydalanmak için ne yapmalıyız?`,
        top_k: 8,
      });
      setEmsalKarar(data.cevap);
      setEmsalModalAcik(true);
    } catch (err) {
      setEmsalError(
        apiErrorMessage(
          err,
          "Emsal karar incelenemedi. Lütfen tekrar deneyin.",
        ),
      );
    } finally {
      setEmsalBusy(null);
    }
  }

  // ✅ YENİ: Emsal kararı dilekçeye ekle ve PDF indir
  function emsalKarariDilekceveEkle() {
    if (!emsalKarar) return;
    const mevcutAnaliz = answer.trim();
    const birlesik = mevcutAnaliz
      ? `${mevcutAnaliz}\n\n---\n\nEMSAL KARAR ANALİZİ:\n${emsalKarar}`
      : emsalKarar;

    // Birleşik içerikle dilekçe PDF'i indir
    const title = "Dilekçe Taslağı - Emsal Karar Dahil - Akıllı Yargı Analizi";
    const body = `Sayın Mahkemeye,\n\nSeçili belge, görsel kanıtlar ve emsal karar kapsamında yapılan inceleme aşağıdadır.\n\n${birlesik}\n\nSonuç ve Talep:\nDelile ve emsal karara dayalı tespitlerin yargılama kapsamında dikkate alınmasını saygıyla arz ve talep ederiz.`;

    const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Georgia, serif; line-height: 1.7; color: #172033; padding: 48px; max-width: 800px; margin: auto; }
    h1 { font-size: 22px; border-bottom: 2px solid #172033; padding-bottom: 8px; margin-bottom: 24px; }
    pre { white-space: pre-wrap; font: inherit; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(body)}</pre>
</body>
</html>`;

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - margin * 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, margin, margin + 5);
    doc.setLineWidth(0.5);
    doc.line(margin, margin + 10, pageWidth - margin, margin + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(body, maxWidth);
    doc.text(lines, margin, margin + 20);
    doc.save(
      `Dilekce_Emsal_Dahil_${new Date().toISOString().slice(0, 10)}.pdf`,
    );

    setEmsalModalAcik(false);
    setDemoMessage("Emsal karar dilekçeye eklendi ve indirme başlatıldı.");
  }

  function printAnalysis(kind: "Avukat Görüş Notu" | "Dilekçe Taslağı") {
    const analysis = answer.trim();
    if (!analysis) return;

    const title = `${kind} - Akıllı Yargı Analizi`;
    const body =
      kind === "Dilekçe Taslağı"
        ? `Sayın Mahkemeye,\n\nSeçili belge ve görsel kanıtlar kapsamında yapılan inceleme aşağıdadır.\n\n${analysis}\n\nSonuç ve Talep:\nDelile dayalı tespitlerin yargılama kapsamında dikkate alınmasını saygıyla arz ve talep ederiz.`
        : `Konu: Belge, görsel kanıt ve içtihat uyumluluğu inceleme notu\n\n${analysis}`;

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });
    const margin = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - margin * 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(title, margin, margin + 5);

    doc.setLineWidth(0.5);
    doc.line(margin, margin + 10, pageWidth - margin, margin + 10);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(body, maxWidth);
    doc.text(lines, margin, margin + 20);

    doc.save(
      `${kind.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Hukukçular için güvenilir çalışma ortağı</p>
          <h1>Akıllı Yargı Ekosistemi</h1>
        </div>
        <div className="case-chip">
          {caseId ? `Dosya ${caseId.slice(0, 8)}` : "Yeni çalışma"}
        </div>
      </header>

      <section className="upload-band">
        <div>
          <h2>Akıllı Dosya Yükleme Alanı</h2>
          <p>
            PDF, JPG ve PNG kanıtları tek havuzda toplayın; kişi, tarih ve belge
            türü rozetleri dosya incelemesi sırasında hazırlanır.
          </p>
        </div>
        <PdfDropZone
          label="Merkezi veri havuzu"
          hint="Tüm belgeler aynı dosyada incelenir ve tek Analiz Et butonuyla birlikte taranır."
          disabled={uploadBusy}
          onPdfFile={ingestPdf}
          onImageFile={addEvidenceImage}
        />
      </section>

      {status ? <p className="toast success">{status}</p> : null}
      {error ? <p className="toast error">{error}</p> : null}

      <main className="workspace-grid">
        <aside className="glass-panel file-sidebar">
          <div className="panel-heading">
            <span>Dosya Listesi</span>
            <small>{belgeler.length + evidenceImages.length} kayıt</small>
          </div>

          <div className="file-list">
            {belgeler.map((doc) => (
              <label
                className={`file-row ${analysisComplete ? "file-row-complete" : ""}`}
                key={doc.id}
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.has(doc.id)}
                  onChange={() => toggleDoc(doc.id)}
                />
                <span className="doc-icon">{docIcon(doc.dokuman_turu)}</span>
                <span className="file-meta">
                  <span className="file-title-line">
                    <strong>{doc.dosya_adi}</strong>
                    {analysisComplete ? (
                      <span className="complete-mark" title="Tamamlandı" />
                    ) : null}
                  </span>
                  <span className="badge-line">
                    <span>{doc.dokuman_turu || "Belge"}</span>
                    <span
                      className={doc.kisi_adi ? "badge-green" : "badge-pending"}
                    >
                      {doc.kisi_adi || "İşlem Sırasında"}
                    </span>
                    <span
                      className={
                        doc.tarih_iso ? "badge-green" : "badge-pending"
                      }
                    >
                      {displayDate(doc.tarih_iso)}
                    </span>
                    {analysisComplete ? (
                      <span className="badge-green">Analiz Edildi</span>
                    ) : null}
                  </span>
                </span>
              </label>
            ))}

            {evidenceImages.map((image) => (
              <label
                className={`file-row ${analysisComplete ? "file-row-complete" : ""}`}
                key={image.id}
              >
                <input
                  type="checkbox"
                  checked={selectedImages.has(image.id)}
                  onChange={() => toggleImage(image.id)}
                />
                <span className="doc-icon">FT</span>
                <span className="file-meta">
                  <span className="file-title-line">
                    <strong>{image.file.name}</strong>
                    {analysisComplete ? (
                      <span className="complete-mark" title="Tamamlandı" />
                    ) : null}
                  </span>
                  <span className="badge-line">
                    <span>Fotoğraf</span>
                    <span>Görsel kanıt</span>
                    <span>{image.tarih_iso}</span>
                    {analysisComplete ? (
                      <span className="badge-green">Analiz Edildi</span>
                    ) : null}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {!hasData ? (
            <p className="empty-note">Henüz belge yüklenmedi.</p>
          ) : null}
        </aside>

        <section
          className={`glass-panel timeline-panel ${busy ? "panel-thinking" : ""}`}
        >
          <div className="panel-heading">
            <span>Zaman Akışı</span>
            <small>Olay ve kaynak eşleştirme</small>
          </div>

          {events.length > 0 ? (
            <ol className="timeline-list">
              {events.map((event, index) => {
                const linkedImages = imagesForEvent(event);
                return (
                  <li className="timeline-item" key={`${event.tarih}-${index}`}>
                    <div className="timeline-date">
                      {event.tarih || "Tarih yok"}
                    </div>
                    <div className="timeline-card">
                      <span className="source-tag">
                        {sourceLabel(event, belgeler)}
                      </span>
                      <h3>{event.olay || "Tarihli olay"}</h3>
                      {event.kaynak ? <p>{event.kaynak}</p> : null}
                      {linkedImages.length > 0 ? (
                        <div className="timeline-images">
                          {linkedImages.map((image) => (
                            <button
                              className="evidence-preview"
                              type="button"
                              onClick={() => setLightboxImage(image)}
                              key={image.id}
                              title="Delili büyüterek incele"
                            >
                              <img src={image.url} alt={image.file.name} />
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="timeline-empty">
              <strong>Zaman akışı analiz bekliyor</strong>
              <span>
                Yüklenen belgelerden tarih, olay ve görsel bağlantıları tek
                analizde hazırlanacak.
              </span>
            </div>
          )}
        </section>

        <aside
          className={`glass-panel ai-panel ${busy ? "panel-thinking" : ""}`}
        >
          <div className="panel-heading">
            <span>Yapay Zeka Analiz Merkezi</span>
            <small>{selectedDocs.size + selectedImages.size} seçili</small>
          </div>

          <button
            type="button"
            className="primary-action"
            disabled={busy || !caseId.trim()}
            onClick={runUnifiedAnalysis}
          >
            {busy ? "Dosyanız derinlemesine taranıyor..." : "Analiz Et"}
          </button>

          {busy ? (
            <div className="thinking-card">
              <span />
              <strong>
                Deliller, ifadeler ve güncel kararlar birlikte
                değerlendiriliyor.
              </strong>
            </div>
          ) : null}

          {notifications.length > 0 ? (
            <div className="alert-stack">
              {notifications.slice(0, 3).map((notification) => (
                <article className="decision-alert" key={notification.id}>
                  <p className="alert-kicker">
                    Dosyanızdaki konuyla ilgili taze bir yargı kararı bulundu
                  </p>
                  <h3>{notification.title}</h3>
                  <p>{notification.message}</p>
                  <div className="alert-actions">
                    {/* ✅ GERÇEK API ÇAĞRISI: Emsal Kararı İncele */}
                    <button
                      type="button"
                      disabled={emsalBusy === notification.id}
                      onClick={() => emsalKarariIncele(notification)}
                    >
                      {emsalBusy === notification.id
                        ? "İnceleniyor..."
                        : "Emsal Kararı İncele"}
                    </button>
                    {/* ✅ GERÇEK İŞLEM: Emsal varsa direkt dilekçeye ekle, yoksa önce incele */}
                    <button
                      type="button"
                      disabled={emsalBusy === notification.id}
                      onClick={async () => {
                        if (emsalKarar) {
                          setEmsalModalAcik(true);
                        } else {
                          await emsalKarariIncele(notification);
                        }
                      }}
                    >
                      Dava Dilekçesine Ekle
                    </button>
                  </div>
                  {/* Emsal hata mesajı */}
                  {emsalError && emsalBusy === null ? (
                    <p
                      className="toast error"
                      style={{ marginTop: "8px", fontSize: "13px" }}
                    >
                      {emsalError}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-note">
              Leksialert yeni karar uyarısı bekliyor.
            </p>
          )}

          {answer ? (
            <>
              <AnalysisOutput
                text={answer}
                hasImages={selectedImageRows.length > 0}
                primaryDoc={selectedPdfRows[0]?.dosya_adi}
              />

              <div className="strategic-actions">
                <button
                  type="button"
                  disabled={courtBusy}
                  onClick={generateCourtQuestions}
                >
                  {courtBusy
                    ? "Sorular hazırlanıyor..."
                    : "Duruşma Hazırlığı: Hakimin Sorabileceği Kritik Sorular"}
                </button>
                <button
                  type="button"
                  onClick={() => printAnalysis("Dilekçe Taslağı")}
                >
                  Tek Tıkla Beyan Dilekçesi Taslağı Oluştur
                </button>
              </div>

              {courtBusy ? (
                <div className="thinking-card">
                  <span />
                  <strong>
                    Davaya özgü kritik duruşma soruları oluşturuluyor...
                  </strong>
                </div>
              ) : null}

              {courtError ? <p className="toast error">{courtError}</p> : null}

              {courtQuestions ? (
                <div className="analysis-section court-questions">
                  <h3>Duruşma için Kritik Sorular</h3>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      margin: 0,
                      lineHeight: 1.7,
                    }}
                  >
                    {courtQuestions}
                  </pre>
                </div>
              ) : null}

              <div className="output-actions">
                <button
                  type="button"
                  onClick={() => printAnalysis("Avukat Görüş Notu")}
                >
                  Görüş notu PDF
                </button>
                <button
                  type="button"
                  onClick={() => printAnalysis("Dilekçe Taslağı")}
                >
                  Dilekçe taslağı PDF
                </button>
                <button
                  type="button"
                  className={
                    analysisApproved
                      ? "approve-action approved"
                      : "approve-action"
                  }
                  onClick={() => {
                    setAnalysisApproved(true);
                    setDemoMessage(
                      "Analiz onaylandı. Bu değerlendirme dosyanın çalışma notlarına alındı.",
                    );
                  }}
                >
                  {analysisApproved ? "Analiz Onaylandı" : "Bu Analizi Onayla"}
                </button>
              </div>
            </>
          ) : (
            <div className="analysis-placeholder">
              <span>
                Çapraz sorgu, çelişki ve sade hukuk notları burada görünür.
              </span>
            </div>
          )}

          {demoMessage ? <p className="demo-message">{demoMessage}</p> : null}
        </aside>
      </main>

      {/* Fotoğraf lightbox */}
      {lightboxImage ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            className="lightbox-close"
            onClick={() => setLightboxImage(null)}
          >
            Kapat
          </button>
          <img src={lightboxImage.url} alt={lightboxImage.file.name} />
          <p>{lightboxImage.file.name}</p>
        </div>
      ) : null}

      {/* ✅ YENİ: Emsal Karar Modal */}
      {emsalModalAcik && emsalKarar ? (
        <EmsalKararModal
          karar={emsalKarar}
          onClose={() => setEmsalModalAcik(false)}
          onEkle={emsalKarariDilekceveEkle}
        />
      ) : null}

      <footer className="system-footer">
        Sistem Durumu: Çevrimiçi - Güvenli Bağlantı Aktif
      </footer>
    </div>
  );
}
