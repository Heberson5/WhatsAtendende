import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Presentation, FileSpreadsheet } from "lucide-react";
import { api, getApiErrorMessage } from "../../lib/api";
import { useExportBranding } from "../../hooks/useExportBranding";
import { darken } from "../../lib/chart-theme";

const SAMPLE_ROWS = [
  ["26/09 09:14", "Maria Cliente", "Ana", "Encerrada"],
  ["26/09 10:02", "João Cliente", "Carlos", "Em atendimento"],
];

/**
 * Own logo/nome/cor for the PowerPoint cover and PDF/Excel reports, with a
 * live preview — deliberately independent from Identidade visual (that one
 * drives the in-app theme; this one only drives exported files). See
 * PROMPT: "Na guia Exportações, eu quero poder editar, trocando logo, cor
 * etc. Não é para ter vínculo com a Identidade Visual."
 */
export function ExportacoesPanel() {
  const { data: exportBranding } = useExportBranding();
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState(exportBranding?.companyName ?? "");
  const [primaryColor, setPrimaryColor] = useState(exportBranding?.primaryColor ?? "#0097B4");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  if (exportBranding && !initialized.current) {
    initialized.current = true;
    setCompanyName(exportBranding.companyName);
    setPrimaryColor(exportBranding.primaryColor);
  }

  const primaryDark = darken(primaryColor, 0.25);
  const logoUrl = exportBranding?.logoUrl ?? null;

  const saveMutation = useMutation({
    mutationFn: () => api.patch("/settings/export-branding", { companyName, primaryColor }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-branding"] });
      toast.success("Identidade de exportação atualizada.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const logoMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.post("/settings/export-branding/logo", form, { headers: { "Content-Type": "multipart/form-data" } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-branding"] });
      toast.success("Logo de exportação atualizada.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="shadow-soft rounded-card border border-border bg-surface p-5">
        <h2 className="mb-1 text-base font-semibold">Identidade de exportação</h2>
        <p className="mb-4 text-xs text-muted">
          Logo, nome e cor usados apenas no PowerPoint e nos relatórios exportados — independente da Identidade visual do aplicativo.
        </p>

        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="mb-2 text-sm font-medium">Logo</p>
            {logoUrl && <img src={logoUrl} alt="Logo atual" className="mb-2 h-14 max-w-[10rem] object-contain" />}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => e.target.files?.[0] && logoMutation.mutate(e.target.files[0])}
            />
            <button
              onClick={() => logoInputRef.current?.click()}
              className="focus-ring rounded-card border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
            >
              Enviar logo
            </button>
          </div>

          <label className="min-w-[14rem] flex-1">
            <span className="mb-1 block text-sm font-medium">Nome da empresa</span>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
            />
          </label>

          <label>
            <span className="mb-1 block text-sm font-medium">Cor principal</span>
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-9 w-9 shrink-0 rounded border border-border" />
              <input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="focus-ring w-28 rounded-card border border-border bg-transparent px-3 py-2 text-sm"
              />
            </div>
          </label>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="focus-ring rounded-card bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
          >
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
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
            <div className="flex h-[28%] items-center gap-3 px-4" style={{ backgroundColor: primaryColor }}>
              {logoUrl && <img src={logoUrl} alt="" className="h-8 max-w-[35%] object-contain" />}
              <span className="truncate text-sm font-bold text-white">{companyName || "WhatsAtendende"}</span>
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
                <p className="truncate text-[10px] text-slate-500">Gerado em 26/09/2026, 10:00 · {companyName || "WhatsAtendende"}</p>
              </div>
              {logoUrl && <img src={logoUrl} alt="" className="h-6 max-w-[35%] shrink-0 object-contain" />}
            </div>
            <div className="mt-3 overflow-hidden rounded">
              <div className="grid grid-cols-4 text-[10px] font-semibold text-white" style={{ backgroundColor: primaryColor }}>
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
