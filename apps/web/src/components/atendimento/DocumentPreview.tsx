import { useEffect, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import type { MessageAttachmentDTO } from "@whatsatendende/types";
import { withAuthToken } from "../../lib/api";

type DocumentKind = "pdf" | "docx" | "doc" | "other";

// Bigger files still open normally — they just don't get a thumbnail drawn in the chat.
const MAX_PREVIEW_BYTES = 15 * 1024 * 1024;
const THUMBNAIL_WIDTH = 220;
// Width of a Word page (A4 at 96 dpi). The thumbnail shows only its left part,
// scaled down, so the text stays readable.
const WORD_PAGE_WIDTH = 816;
const WORD_VISIBLE_WIDTH = 540;

const KIND_STYLE: Record<DocumentKind, { label: string; badge: string }> = {
  pdf: { label: "PDF", badge: "bg-red-600 text-white" },
  docx: { label: "Word", badge: "bg-blue-600 text-white" },
  doc: { label: "Word", badge: "bg-blue-600 text-white" },
  other: { label: "", badge: "bg-black/10" },
};

export function documentKind(att: Pick<MessageAttachmentDTO, "mimeType" | "fileName">): DocumentKind {
  const name = att.fileName.toLowerCase();
  if (att.mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (att.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
  if (att.mimeType === "application/msword" || name.endsWith(".doc")) return "doc";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(withAuthToken(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** True once the element has scrolled into view — thumbnails are only built for messages the agent actually sees. */
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setSeen(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return [ref as React.RefObject<T>, seen];
}

/** First page of a PDF, drawn small. Reports the page count once known. */
function PdfThumbnail({ url, onPages }: { url: string; onPages: (pages: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
        const pdf = await pdfjs.getDocument({ data: await loadBytes(url) }).promise;
        if (cancelled) return;
        onPages(pdf.numPages);
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: (THUMBNAIL_WIDTH / base.width) * ratio });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (context) await page.render({ canvas, canvasContext: context, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (failed) return null;
  return <canvas ref={canvasRef} className="block w-full bg-white" aria-hidden="true" />;
}

const VIEWER_PAGE_WIDTH = 900;
// A very long PDF is drawn up to here; the download button gets the rest.
const VIEWER_MAX_PAGES = 100;

/** Every page of a PDF drawn one after another, so the viewer looks the same in any browser or in the installed app. */
function PdfPages({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error: boolean }>({ pages: 0, error: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
        const pdf = await pdfjs.getDocument({ data: await loadBytes(url) }).promise;
        const container = containerRef.current;
        if (!container || cancelled) return;
        setState({ pages: pdf.numPages, error: false });
        const ratio = window.devicePixelRatio || 1;
        for (let n = 1; n <= Math.min(pdf.numPages, VIEWER_MAX_PAGES) && !cancelled; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const cssWidth = Math.min(VIEWER_PAGE_WIDTH, container.clientWidth || VIEWER_PAGE_WIDTH);
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-3 block max-w-full bg-white shadow";
          canvas.style.width = `${cssWidth}px`;
          container.appendChild(canvas);
          const context = canvas.getContext("2d");
          if (context) await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      } catch {
        if (!cancelled) setState({ pages: 0, error: true });
      }
    })();
    const container = containerRef.current;
    return () => {
      cancelled = true;
      container?.replaceChildren();
    };
  }, [url]);

  return (
    <>
      {state.error && <p className="mt-10 text-center text-sm text-white/80">Não foi possível mostrar este PDF. Use o botão de baixar.</p>}
      {state.pages > VIEWER_MAX_PAGES && <p className="mb-3 text-center text-xs text-white/70">Mostrando as primeiras {VIEWER_MAX_PAGES} páginas de {state.pages}. Baixe o arquivo para ver tudo.</p>}
      <div ref={containerRef} />
    </>
  );
}

/** The start of a .docx, rendered at page size and scaled down into the card. */
function WordThumbnail({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        const container = containerRef.current;
        if (!container) return;
        await renderAsync(await loadBytes(url), container, undefined, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: true });
        if (cancelled) container.replaceChildren();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return null;
  return (
    <div className="relative h-[150px] w-full overflow-hidden bg-white" aria-hidden="true">
      <div ref={containerRef} className="pointer-events-none absolute start-0 top-0 origin-top-left text-black" style={{ width: WORD_PAGE_WIDTH, transform: `scale(${THUMBNAIL_WIDTH / WORD_VISIBLE_WIDTH})` }} />
    </div>
  );
}

/** Full-size viewer — the browser's own PDF viewer, or the Word document rendered in place. */
function DocumentViewer({ att, kind, onClose }: { att: MessageAttachmentDTO; kind: DocumentKind; onClose: () => void }) {
  const wordRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind !== "docx") return;
    let cancelled = false;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        const container = wordRef.current;
        if (!container) return;
        await renderAsync(await loadBytes(att.url), container);
        if (cancelled) container.replaceChildren();
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [att.url, kind]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={onClose} role="dialog" aria-modal="true" aria-label={att.fileName}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-sm">{att.fileName}</p>
        <div className="flex shrink-0 items-center gap-2">
          <a href={withAuthToken(att.url)} download={att.fileName} className="focus-ring rounded-full p-2 hover:bg-white/10" aria-label="Baixar">
            <Download className="h-4 w-4" />
          </a>
          <button onClick={onClose} className="focus-ring rounded-full p-2 hover:bg-white/10" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        {kind === "pdf" ? (
          <PdfPages url={att.url} />
        ) : error ? (
          <p className="mt-10 text-center text-sm text-white/80">Não foi possível mostrar este documento. Use o botão de baixar.</p>
        ) : (
          <div ref={wordRef} className="mx-auto w-fit max-w-full overflow-auto rounded bg-white text-black" />
        )}
      </div>
    </div>
  );
}

/** A document in a message: PDFs and Word files get a preview of the first page and open in a viewer; anything else is a plain download card. */
export function DocumentAttachment({ att }: { att: MessageAttachmentDTO }) {
  const kind = documentKind(att);
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [cardRef, inView] = useInView<HTMLButtonElement>();
  const previewable = (kind === "pdf" || kind === "docx") && att.sizeBytes <= MAX_PREVIEW_BYTES;
  const style = KIND_STYLE[kind];

  const details = (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${kind === "other" ? style.badge : "bg-black/10"}`}>
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{att.fileName}</p>
        <p className="text-xs opacity-75">
          {style.label && <span className={`me-1.5 rounded px-1 py-px text-[10px] font-bold ${style.badge}`}>{style.label}</span>}
          {pages ? `${pages} ${pages === 1 ? "página" : "páginas"} · ` : ""}
          {formatBytes(att.sizeBytes)}
        </p>
      </div>
    </div>
  );

  if (!previewable) {
    return (
      <a href={withAuthToken(att.url)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-black/10 bg-black/5 hover:bg-black/10">
        {details}
      </a>
    );
  }

  return (
    <>
      <button
        ref={cardRef}
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring block w-[220px] max-w-full overflow-hidden rounded border border-black/10 bg-black/5 text-left hover:bg-black/10"
        aria-label={`Visualizar ${att.fileName}`}
      >
        {inView && (
          <div className="max-h-[150px] overflow-hidden border-b border-black/10">
            {kind === "pdf" ? <PdfThumbnail url={att.url} onPages={setPages} /> : <WordThumbnail url={att.url} />}
          </div>
        )}
        {details}
      </button>
      {open && <DocumentViewer att={att} kind={kind} onClose={() => setOpen(false)} />}
    </>
  );
}
