import { useCallback, useRef, useState } from "react";

type Props = {
  label: string;
  hint?: string;
  disabled?: boolean;
  onPdfFile: (file: File) => void | Promise<void>;
};

export function PdfDropZone({ label, hint, disabled, onPdfFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || disabled) return;
      const f = files[0];
      if (!f.name.toLowerCase().endsWith(".pdf")) {
        window.alert("Lütfen yalnızca PDF dosyası seçin.");
        return;
      }
      await onPdfFile(f);
    },
    [disabled, onPdfFile]
  );

  return (
    <div className="pdf-drop-field">
      <span className="pdf-drop-label">{label}</span>
      {hint ? <p className="pdf-drop-hint">{hint}</p> : null}
      <div
        className={`dropzone ${drag ? "dropzone-active" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <p className="dropzone-text">PDF sürükleyip bırakın veya dosya seçin</p>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Dosya yükle
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          disabled={disabled}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
