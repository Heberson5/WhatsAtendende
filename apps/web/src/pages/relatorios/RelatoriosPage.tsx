import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { api } from "../../lib/api";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";

type ReportKind = "attendance" | "per-agent" | "messages";

const TABS: { key: ReportKind; label: string }[] = [
  { key: "attendance", label: "Atendimentos" },
  { key: "per-agent", label: "Por atendente" },
  { key: "messages", label: "Mensagens" },
];

const EXPORT_FORMATS: { key: "csv" | "pdf" | "xlsx"; label: string; icon: typeof Download }[] = [
  { key: "csv", label: "CSV", icon: Download },
  { key: "pdf", label: "PDF", icon: FileText },
  { key: "xlsx", label: "Excel (XLSX)", icon: FileSpreadsheet },
];

export default function RelatoriosPage() {
  const [tab, setTab] = useState<ReportKind>("attendance");
  const [period, setPeriod] = useState<PeriodValue>({ period: "month" });
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["report", tab, period, connectionIds],
    queryFn: async () => {
      const res = await api.get(`/reports/${tab}`, {
        params: {
          period: period.period,
          from: period.from,
          to: period.to,
          connectionId: connectionIds.length ? connectionIds : undefined,
        },
      });
      return res.data;
    },
  });

  // See PROMPT: "Relatórios poder extrair em PDF e em xlsx" — alongside the
  // pre-existing CSV export, same three formats on every tab.
  async function download(format: "csv" | "pdf" | "xlsx") {
    setExportMenuOpen(false);
    const res = await api.get(`/reports/${tab}`, {
      params: {
        period: period.period,
        from: period.from,
        to: period.to,
        connectionId: connectionIds.length ? connectionIds : undefined,
        format,
      },
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `relatorio-${tab}.${format}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="shadow-soft flex gap-1 rounded-card border border-border bg-surface p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-card px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-primary text-primary-fg" : "text-muted hover:bg-surface-alt"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen((o) => !o)}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-3 py-2 text-sm font-medium hover:bg-surface-alt"
            >
              <Download className="h-4 w-4" /> Exportar <ChevronDown className="h-3.5 w-3.5 text-muted" />
            </button>
            {exportMenuOpen && (
              <>
                <button className="fixed inset-0 z-10 cursor-default" onClick={() => setExportMenuOpen(false)} aria-label="Fechar menu de exportação" />
                <div className="shadow-soft absolute right-0 top-full z-20 mt-1 w-44 rounded-card border border-border bg-surface p-1">
                  {EXPORT_FORMATS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => download(f.key)}
                      className="focus-ring flex w-full items-center gap-2 rounded-card px-2.5 py-2 text-left text-sm hover:bg-surface-alt"
                    >
                      <f.icon className="h-4 w-4 text-muted" /> {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {tab === "messages" && data && (
        <div className="grid grid-cols-3 gap-4">
          {Object.entries(data as Record<string, number>).map(([key, value]) => (
            <div key={key} className="shadow-soft rounded-card border border-border bg-surface p-4">
              <p className="text-xs uppercase text-muted">{key}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab !== "messages" && (
        <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
              <tr>{rows[0] && Object.keys(rows[0]).map((key) => <th key={key} className="whitespace-nowrap px-4 py-3">{key}</th>)}</tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td className="px-4 py-8 text-center text-muted">Carregando...</td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-muted">Nenhum dado para o período selecionado.</td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border hover:bg-surface-alt">
                  {Object.values(row).map((value, j) => (
                    <td key={j} className="whitespace-nowrap px-4 py-2.5">
                      {String(value ?? "-")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
