import axios from "axios";
import { useCallback, useMemo, useState } from "react";
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
    /^\s*(?:\d+\.\s*)?(Kaynaklı Analiz|Kaynakli Analiz|Hukuktan Türkçeye|Hukuktan Turkceye|Avukat Görüş Notu İçin Öz|Avukat Gorus Notu Icin Oz)\s*:?\s*$/i;

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
  return value ? value.slice(0, 10) : "Tarih AI bekliyor";
}

function AnalysisOutput({ text }: { text: string }) {
  return (
    <div className="analysis-stack">
      {splitAnalysisSections(text).map((section) => (
        <section className="analysis-section" key={section.title}>
          <h3>{section.title}</h3>
          <p>{section.body}</p>
        </section>
      ))}
    </div>
  );
}

export default function App() {
  const [caseId, setCaseId] = useState("");
  const [belgeler, setBelgeler] = useState<BelgeRow[]>([]);
  const [evidenceImages, setEvidenceImages] = useState<EvidenceImage[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(() => new Set());
  const [selectedImages, setSelectedImages] = useState<Set<string>>(() => new Set());
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [answer, setAnswer] = useState("");
  const [notifications, setNotifications] = useState<LexiNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedPdfRows = useMemo(
    () => belgeler.filter((doc) => selectedDocs.has(doc.id)),
    [belgeler, selectedDocs],
  );

  const selectedImageRows = useMemo(
    () => evidenceImages.filter((image) => selectedImages.has(image.id)),
    [evidenceImages, selectedImages],
  );

  const hasData = belgeler.length > 0 || evidenceImages.length > 0;

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
    const { data } = await api.get<LexiNotification[]>("/lexi-alert/notifications", {
      params: { case_id: id },
    });
    setNotifications(Array.isArray(data) ? data : []);
  }

  const ingestPdf = useCallback(
    async (file: File) => {
      setUploadBusy(true);
      setStatus(null);
      setError(null);
      try {
        const fd = new FormData();
        if (caseId.trim()) fd.append("case_id", caseId.trim());
        fd.append("file", file);
        const { data } = await api.post<PdfIngestResponse>("/documents/pdf/ingest", fd);
        setCaseId(data.case_id);
        await belgeleriYukle(data.case_id);
        setSelectedDocs((prev) => new Set(prev).add(data.belge_kimligi));
        setStatus(
          `${data.dosya_adi || file.name} veri havuzuna eklendi. AI rozetleri: ${data.dokuman_turu || "Belge"} / ${data.kisi_adi || "Kişi yok"} / ${displayDate(data.tarih_iso)}`,
        );
      } catch (err) {
        setError(apiErrorMessage(err, "Belge yüklenemedi."));
      } finally {
        setUploadBusy(false);
      }
    },
    [belgeleriYukle, caseId],
  );

  const addEvidenceImage = useCallback(async (file: File) => {
    const id = `${file.name}-${file.lastModified}-${crypto.randomUUID()}`;
    const image: EvidenceImage = {
      id,
      file,
      url: URL.createObjectURL(file),
      tarih_iso: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
    };
    setEvidenceImages((prev) => [...prev, image]);
    setSelectedImages((prev) => new Set(prev).add(id));
    setStatus(`${file.name} fotoğraf kanıtı olarak zaman çizelgesine bağlandı.`);
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
    try {
      const metadata_filters = selectedPdfRows.map((doc) => ({ document_id: doc.id }));
      const request = {
        case_id: caseId.trim(),
        sorgu:
          "Seçili metin ve görsel kanıtları birlikte incele. Çelişkileri, zaman uyumsuzluklarını, görsel kanıt bulgularını ve güncel yargı kararı uyumluluğu risklerini başlıklandır.",
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
      const timelinePromise = api.get<{ events: TimelineEvent[] }>(`/lexi-chron/${caseId.trim()}`);
      const alertPromise = api.post<LexiNotification | null>("/lexi-alert/simulate-decision", {
        case_id: caseId.trim(),
        baslik: "Yargıtay yeni tazminat ve delil değerlendirme kararı",
        konu: "tazminat hesaplaması ve delil değerlendirmesi",
        hukuki_gerekce: "kusur, zarar, bilirkişi raporu, fotoğraf delili ve çelişkili beyan",
      });

      const [analysis, timeline] = await Promise.all([
        analysisPromise,
        timelinePromise,
        alertPromise,
      ]);
      setAnswer(analysis.data.cevap);
      setEvents(timeline.data.events || []);
      await bildirimleriYukle(caseId.trim());
    } catch (err) {
      setError(apiErrorMessage(err, "Analiz tamamlanamadı."));
    } finally {
      setBusy(false);
    }
  }

  function printAnalysis(kind: "Avukat Görüş Notu" | "Dilekçe Taslağı") {
    const analysis = answer.trim();
    if (!analysis) return;
    const title = `${kind} - Akıllı Yargı Analizi`;
    const body =
      kind === "Dilekçe Taslağı"
        ? `Sayın Mahkemeye,\n\nSeçili belge ve görsel kanıtlar kapsamında yapılan AI incelemesi aşağıdadır.\n\n${analysis}\n\nSonuç ve Talep:\nDelile dayalı tespitlerin yargılama kapsamında dikkate alınmasını saygıyla arz ve talep ederiz.`
        : `Konu: Belge, görsel kanıt ve içtihat uyumluluğu inceleme notu\n\n${analysis}`;
    const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.55;color:#172033;padding:32px}h1{font-size:24px}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(body)}</pre></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI odaklı hukuk asistanı</p>
          <h1>Akıllı Yargı Ekosistemi</h1>
        </div>
        <div className="case-chip">{caseId ? `Dosya ${caseId.slice(0, 8)}` : "Yeni çalışma"}</div>
      </header>

      <section className="upload-band">
        <div>
          <h2>Akıllı Dosya Yükleme Alanı</h2>
          <p>PDF, JPG ve PNG kanıtları tek havuzda toplayın; kişi, tarih ve belge türü rozetleri arka planda çıkarılır.</p>
        </div>
        <PdfDropZone
          label="Merkezi veri havuzu"
          hint="Tüm belgeler aynı dosyada indekslenir ve tek Analiz Et butonuyla birlikte taranır."
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
            <span>Dosya Sidebar</span>
            <small>{belgeler.length + evidenceImages.length} kayıt</small>
          </div>

          <div className="file-list">
            {belgeler.map((doc) => (
              <label className="file-row" key={doc.id}>
                <input
                  type="checkbox"
                  checked={selectedDocs.has(doc.id)}
                  onChange={() => toggleDoc(doc.id)}
                />
                <span className="doc-icon">{docIcon(doc.dokuman_turu)}</span>
                <span className="file-meta">
                  <strong>{doc.dosya_adi}</strong>
                  <span className="badge-line">
                    <span>{doc.dokuman_turu || "Belge"}</span>
                    <span>{doc.kisi_adi || "Kişi AI bekliyor"}</span>
                    <span>{displayDate(doc.tarih_iso)}</span>
                  </span>
                </span>
              </label>
            ))}

            {evidenceImages.map((image) => (
              <label className="file-row" key={image.id}>
                <input
                  type="checkbox"
                  checked={selectedImages.has(image.id)}
                  onChange={() => toggleImage(image.id)}
                />
                <span className="doc-icon">FT</span>
                <span className="file-meta">
                  <strong>{image.file.name}</strong>
                  <span className="badge-line">
                    <span>Fotoğraf</span>
                    <span>Görsel kanıt</span>
                    <span>{image.tarih_iso}</span>
                  </span>
                </span>
              </label>
            ))}
          </div>

          {!hasData ? <p className="empty-note">Henüz belge yüklenmedi.</p> : null}
        </aside>

        <section className="glass-panel timeline-panel">
          <div className="panel-heading">
            <span>Zaman Çizelgesi</span>
            <small>Otomatik olay çıkarımı</small>
          </div>

          {events.length > 0 ? (
            <ol className="timeline-list">
              {events.map((event, index) => {
                const linkedImages = imagesForEvent(event);
                return (
                  <li className="timeline-item" key={`${event.tarih}-${index}`}>
                    <div className="timeline-date">{event.tarih || "Tarih yok"}</div>
                    <div className="timeline-card">
                      <h3>{event.olay || "Tarihli olay"}</h3>
                      {event.kaynak ? <p>{event.kaynak}</p> : null}
                      {linkedImages.length > 0 ? (
                        <div className="timeline-images">
                          {linkedImages.map((image) => (
                            <img src={image.url} alt={image.file.name} key={image.id} />
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
              <strong>Timeline analiz bekliyor</strong>
              <span>Yüklenen belgelerden tarih, olay ve görsel bağlantıları tek analizde çıkarılacak.</span>
            </div>
          )}
        </section>

        <aside className="glass-panel ai-panel">
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
            {busy ? "Analiz ediliyor..." : "Analiz Et"}
          </button>

          {notifications.length > 0 ? (
            <div className="alert-stack">
              {notifications.slice(0, 3).map((notification) => (
                <article className="decision-alert" key={notification.id}>
                  <h3>{notification.title}</h3>
                  <p>{notification.message}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-note">Leksialert yeni karar uyarısı bekliyor.</p>
          )}

          {answer ? (
            <>
              <AnalysisOutput text={answer} />
              <div className="output-actions">
                <button type="button" onClick={() => printAnalysis("Avukat Görüş Notu")}>
                  Görüş notu PDF
                </button>
                <button type="button" onClick={() => printAnalysis("Dilekçe Taslağı")}>
                  Dilekçe taslağı PDF
                </button>
              </div>
            </>
          ) : (
            <div className="analysis-placeholder">
              <span>Çapraz sorgu, çelişki ve sade hukuk notları burada görünür.</span>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
