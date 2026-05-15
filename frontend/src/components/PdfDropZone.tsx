import { useCallback, useRef, useState } from "react";

type Props = {
  label: string;
  hint?: string;
  disabled?: boolean;
  onPdfFile: (file: File) => void | Promise<void>;
  onImageFile?: (file: File) => void | Promise<void>;
};

const imageTypes = new Set(["image/jpeg", "image/png"]);

export function PdfDropZone({
  label,
  hint,
  disabled,
  onPdfFile,
  onImageFile,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length || disabled) return;
      const selectedFiles = Array.from(files);
      const pdfFiles = selectedFiles.filter((f) =>
        f.name.toLowerCase().endsWith(".pdf"),
      );
      const imageFiles = selectedFiles.filter((f) => imageTypes.has(f.type));
      const unsupportedFiles = selectedFiles.filter(
        (f) => !pdfFiles.includes(f) && !imageFiles.includes(f),
      );

      for (const f of imageFiles) {
        if (onImageFile) {
          await onImageFile(f);
        } else {
          window.alert("Lütfen yalnızca PDF dosyası seçin.");
        }
      }

      for (const f of pdfFiles) {
        await onPdfFile(f);
      }

      if (unsupportedFiles.length > 0) {
        window.alert(
          onImageFile
            ? "Lütfen PDF, JPG veya PNG dosyası seçin."
            : "Lütfen yalnızca PDF dosyası seçin.",
        );
      }
    },
    [disabled, onImageFile, onPdfFile],
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
        <p className="dropzone-text">
          {onImageFile
            ? "PDF veya fotoğraf sürükleyip bırakın"
            : "PDF sürükleyip bırakın veya dosya seçin"}
        </p>
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
          accept={
            onImageFile
              ? "application/pdf,.pdf,image/jpeg,image/png"
              : "application/pdf,.pdf"
          }
          multiple={Boolean(onImageFile)}
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
