import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import {
  RELEASE_NOTE_AREAS,
  RELEASE_NOTE_IMAGE_BASE,
  RELEASE_NOTE_TYPE_LABEL,
  type ReleaseNote,
  type ReleaseNoteArea,
  type ReleaseNoteImage,
  type ReleaseNoteType,
} from "../../lib/releaseNotes";
import { useReleaseNotes } from "../../hooks/useReleaseNotes";

const TYPE_STYLE: Record<ReleaseNoteType, string> = {
  novo: "bg-primary/10 text-primary",
  melhoria: "bg-info-soft text-info",
  correcao: "bg-success-soft text-success",
};

type TypeFilter = ReleaseNoteType | "todos";

/** Turns "{1}" into the same numbered amber marker drawn on the screenshots. */
export function WithMarkers({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\d\})/).map((part, i) => {
        const marker = /^\{(\d)\}$/.exec(part);
        return marker ? (
          <span
            key={i}
            className="mx-0.5 inline-grid h-4 w-4 place-items-center rounded-full bg-amber-500 align-[1px] text-[10px] font-bold text-amber-950"
            aria-label={`marcação ${marker[1]}`}
          >
            {marker[1]}
          </span>
        ) : (
          part
        )
      })}
    </>
  );
}

const plain = (text: string) => text.replace(/\{(\d)\}/g, "($1)").replace(/\s+/g, " ").trim();

function NoteCard({ note, onZoom }: { note: ReleaseNote; onZoom: (image: ReleaseNoteImage) => void }) {
  return (
    <article className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={clsx("rounded-md px-1.5 py-px text-[10.5px] font-bold", TYPE_STYLE[note.type])}>{RELEASE_NOTE_TYPE_LABEL[note.type]}</span>
        <h3 className="text-[14.5px] font-semibold">{note.title}</h3>
      </div>
      {note.text && <p className="max-w-[70ch] text-[13.5px] leading-relaxed">{note.text}</p>}
      {note.before && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13px] leading-relaxed">
          <dt className="mt-0.5 self-start rounded-md bg-warning-soft px-1.5 py-px text-[10.5px] font-bold text-warning">Antes</dt>
          <dd>{note.before}</dd>
          <dt className="mt-0.5 self-start rounded-md bg-success-soft px-1.5 py-px text-[10.5px] font-bold text-success">Agora</dt>
          <dd>{note.after}</dd>
        </dl>
      )}
      {note.steps && (
        <div className="rounded-lg bg-surface-alt px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Como usar</p>
          <ol className="mt-1.5 list-decimal space-y-1 ps-5 text-[13px] leading-relaxed">
            {note.steps.map((step) => (
              <li key={step}>
                <WithMarkers text={step} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {note.where && (
        <p className="text-xs text-muted">
          Onde fica: <span className="font-semibold text-[var(--color-text)]">{note.where}</span>
        </p>
      )}
      {note.images && (
        <div className="flex flex-wrap items-start gap-2.5">
          {note.images.map((image) => (
            <figure key={image.file} className={clsx("flex max-w-full flex-col gap-1.5", image.size === "small" && "sm:max-w-[340px]", image.size === "tiny" && "max-w-[150px]")}>
              <button
                type="button"
                onClick={() => onZoom(image)}
                className="focus-ring block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface-alt"
                aria-label={`Ampliar print: ${plain(image.caption)}`}
              >
                <img src={`${RELEASE_NOTE_IMAGE_BASE}${image.file}.webp`} alt={plain(image.caption)} loading="lazy" className="block h-auto w-full" />
              </button>
              <figcaption className="text-xs leading-normal text-muted">
                <WithMarkers text={image.caption} />
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * Notas de versão: what changed in each release, limited to the areas this
 * user can open (see lib/releaseNotes.ts). Opening it marks the newest
 * release as seen, clearing the sidebar's "Novo" badge.
 */
export default function NotasDeVersaoPage() {
  const { releases, markSeen } = useReleaseNotes();
  const [searchParams, setSearchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("todos");
  const [zoomed, setZoomed] = useState<ReleaseNoteImage | null>(null);

  useEffect(() => {
    markSeen();
  }, [markSeen]);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const release = releases.find((r) => r.version === searchParams.get("versao")) ?? releases[0];
  if (!release) return null;

  const counts: Record<TypeFilter, number> = { todos: release.notes.length, novo: 0, melhoria: 0, correcao: 0 };
  release.notes.forEach((n) => counts[n.type]++);
  const filtered = typeFilter === "todos" ? release.notes : release.notes.filter((n) => n.type === typeFilter);
  const areas = (Object.keys(RELEASE_NOTE_AREAS) as ReleaseNoteArea[])
    .map((area) => ({ area, notes: filtered.filter((n) => n.area === area) }))
    .filter((g) => g.notes.length > 0);

  function selectVersion(version: string) {
    setTypeFilter("todos");
    setSearchParams({ versao: version }, { replace: true });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Versões" className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-0 lg:flex-col lg:self-start lg:overflow-visible lg:pb-0">
          <p className="hidden px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted lg:block">Versões</p>
          {releases.map((r, i) => (
            <button
              key={r.version}
              type="button"
              onClick={() => selectVersion(r.version)}
              aria-current={r.version === release.version ? "true" : undefined}
              className={clsx(
                "focus-ring grid shrink-0 grid-cols-[1fr_auto] gap-x-2 rounded-lg border px-2.5 py-2 text-left",
                r.version === release.version ? "border-border bg-surface-alt" : "border-transparent hover:bg-surface-alt"
              )}
            >
              <span className="font-mono text-[12.5px] font-semibold">
                {r.version}
                {i === 0 && <span className="ms-1.5 rounded-full bg-primary/10 px-1.5 py-px align-[1px] font-sans text-[9.5px] font-bold uppercase text-primary">Atual</span>}
              </span>
              <span className="col-start-2 row-span-2 row-start-1 self-center text-[11px] font-semibold tabular-nums text-muted">{r.notes.length}</span>
              <span className="col-start-1 text-[11.5px] text-muted">
                {r.date} · {r.name}
              </span>
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          <header className="flex flex-col gap-2.5 border-b border-border pb-4">
            <p className="font-mono text-xs text-muted">
              Versão {release.version} · {release.date}
            </p>
            <h2 className="text-xl font-semibold tracking-tight">{release.name}</h2>
            <p className="max-w-[64ch] text-[13.5px] text-muted">{release.summary}</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
              {(["todos", "novo", "melhoria", "correcao"] as const)
                .filter((t) => t === "todos" || counts[t] > 0)
                .map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    aria-pressed={typeFilter === t}
                    className={clsx(
                      "focus-ring rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                      typeFilter === t ? "border-[var(--color-text)] text-[var(--color-text)]" : "border-border text-muted hover:text-[var(--color-text)]"
                    )}
                  >
                    {t === "todos" ? "Todas" : RELEASE_NOTE_TYPE_LABEL[t]} {counts[t]}
                  </button>
                ))}
            </div>
          </header>

          {areas.map(({ area, notes }) => (
            <section key={area} className="mt-6">
              <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted">{RELEASE_NOTE_AREAS[area].label}</h2>
              <div className="flex flex-col gap-3">
                {notes.map((note) => (
                  <NoteCard key={note.title} note={note} onZoom={setZoomed} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {zoomed && (
        <div className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/80 p-4" onClick={() => setZoomed(null)} role="dialog" aria-modal="true" aria-label="Print ampliado">
          <button type="button" className="focus-ring absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
          <img src={`${RELEASE_NOTE_IMAGE_BASE}${zoomed.file}.webp`} alt={plain(zoomed.caption)} className="max-h-[85vh] max-w-full rounded-lg shadow-elevated" />
          <p className="max-w-[80ch] text-center text-[13px] text-white/90">
            <WithMarkers text={zoomed.caption} />
          </p>
        </div>
      )}
    </div>
  );
}
