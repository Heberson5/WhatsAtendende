import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { RELEASE_NOTE_TYPE_LABEL } from "../../lib/releaseNotes";
import { useReleaseNotes } from "../../hooks/useReleaseNotes";

// How many highlights the popup lists before pointing to the full page.
const HIGHLIGHT_COUNT = 5;

/**
 * One-time "O que há de novo" popup after an update: shows the newest
 * release this user hasn't seen yet (only notes for areas they can access).
 * Closing it, or opening the full notes, marks the release as seen.
 */
export function WhatsNewModal() {
  const { latest, hasUnseen, markSeen } = useReleaseNotes();
  const location = useLocation();
  const navigate = useNavigate();

  if (!latest || !hasUnseen || location.pathname === "/notas-de-versao") return null;

  const highlights = [...latest.notes.filter((n) => n.type === "novo"), ...latest.notes.filter((n) => n.type !== "novo")].slice(0, HIGHLIGHT_COUNT);
  const remaining = latest.notes.length - highlights.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={markSeen}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-border p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-muted">Versão {latest.version}</p>
            <h2 id="whats-new-title" className="text-lg font-semibold">
              O que há de novo: {latest.name}
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">{latest.summary}</p>
          </div>
          <button type="button" onClick={markSeen} className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="flex-1 space-y-3 overflow-y-auto p-5">
          {highlights.map((note) => (
            <li key={note.title} className="flex gap-2.5">
              <span className="mt-0.5 h-fit shrink-0 rounded-md bg-primary/10 px-1.5 py-px text-[10.5px] font-bold text-primary">{RELEASE_NOTE_TYPE_LABEL[note.type]}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{note.title}</p>
                <p className="line-clamp-2 text-[13px] text-muted">{note.text ?? note.after}</p>
              </div>
            </li>
          ))}
          {remaining > 0 && <li className="text-[13px] text-muted">E mais {remaining} {remaining === 1 ? "novidade" : "novidades"} nas telas que você usa.</li>}
        </ul>
        <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={markSeen} className="focus-ring rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-alt">
            Fechar
          </button>
          <button
            type="button"
            onClick={() => navigate("/notas-de-versao")}
            className="focus-ring rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90"
          >
            Ver todas as novidades
          </button>
        </div>
      </div>
    </div>
  );
}
