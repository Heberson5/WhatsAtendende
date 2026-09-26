import { Pencil, Presentation, FileSpreadsheet } from "lucide-react";
import { useBranding } from "../../hooks/useBranding";
import { darken } from "../../lib/chart-theme";

const SAMPLE_ROWS = [
  ["26/09 09:14", "Maria Cliente", "Ana", "Encerrada"],
  ["26/09 10:02", "João Cliente", "Carlos", "Em atendimento"],
];

/**
 * Live preview of the branding actually baked into the exported files —
 * mirrors exportDashboardPptx.ts's cover slide and reports.service.ts's
 * PDF/XLSX header, using the SAME logo/cor principal/nome da empresa from
 * Identidade visual (not a separate set of controls) — see PROMPT: "nova
 * aba com espaço para este layout... tendo também uma pré visualização".
 */
export function ExportacoesPanel({ onEditIdentity }: { onEditIdentity: () => void }) {
  const { data: branding } = useBranding();
  const primary = branding?.primaryColor ?? "#0097B4";
  const primaryDark = darken(primary, 0.25);
  const companyName = branding?.companyName ?? "WhatsAtendende";
  const logoUrl = branding?.logoUrl ?? null;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="shadow-soft flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-muted">
          A logo, o nome e a cor principal usados no PowerPoint e nos relatórios são os mesmos definidos em{" "}
          <span className="font-medium text-text">Identidade visual</span>. Ajuste lá e a prévia abaixo atualiza na hora.
        </p>
        <button
          onClick={onEditIdentity}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-card border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
        >
          <Pencil className="h-3.5 w-3.5" /> Editar identidade visual
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ---- Apresentação (PowerPoint) ---- */}
        <div className="shadow-soft rounded-card border border-border bg-surface p-5">
          <div className="mb-1 flex items-center gap-2">
            <Presentation className="h-4.5 w-4.5 text-primary" />
            <h2 className="text-base font-semibold">Apresentação (PowerPoint)</h2>
          </div>
          <p className="mb-4 text-xs text-muted">Capa do Dashboard exportado em "Exportar PPT".</p>

          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-white shadow-inner">
            <div className="flex h-[28%] items-center gap-3 px-4" style={{ backgroundColor: primary }}>
              {logoUrl && <img src={logoUrl} alt="" className="h-8 max-w-[35%] object-contain" />}
              <span className="truncate text-sm font-bold text-white">{companyName}</span>
            </div>
            <div className="flex h-[72%] flex-col justify-center gap-1.5 px-4">
              <p className="text-lg font-bold text-slate-800">Dashboard de Atendimento</p>
              <p className="text-[11px] text-slate-500">Hoje · Gerado em 26/09/2026, 10:00</p>
              <div className="mt-1 h-1 w-10 rounded-full" style={{ backgroundColor: primaryDark }} />
            </div>
          </div>
        </div>

        {/* ---- Relatórios (PDF / Excel) ---- */}
        <div className="shadow-soft rounded-card border border-border bg-surface p-5">
          <div className="mb-1 flex items-center gap-2">
            <FileSpreadsheet className="h-4.5 w-4.5 text-primary" />
            <h2 className="text-base font-semibold">Relatórios (PDF / Excel)</h2>
          </div>
          <p className="mb-4 text-xs text-muted">Cabeçalho e cores usados em Relatórios ao exportar em PDF ou Excel.</p>

          <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-white p-3 shadow-inner">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-800">Relatório de Atendimentos</p>
                <p className="truncate text-[10px] text-slate-500">Gerado em 26/09/2026, 10:00 · {companyName}</p>
              </div>
              {logoUrl && <img src={logoUrl} alt="" className="h-6 max-w-[35%] shrink-0 object-contain" />}
            </div>
            <div className="mt-3 overflow-hidden rounded">
              <div className="grid grid-cols-4 text-[10px] font-semibold text-white" style={{ backgroundColor: primary }}>
                {["Data", "Cliente", "Atendente", "Status"].map((h) => (
                  <div key={h} className="truncate px-2 py-1">
                    {h}
                  </div>
                ))}
              </div>
              {SAMPLE_ROWS.map((cells, i) => (
                <div key={i} className={`grid grid-cols-4 text-[10px] text-slate-600 ${i % 2 === 1 ? "bg-slate-50" : "bg-white"}`}>
                  {cells.map((c, j) => (
                    <div key={j} className="truncate px-2 py-1">
                      {c}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
