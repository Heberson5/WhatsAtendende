import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Columns3, Download, FileSpreadsheet, FileText } from "lucide-react";
import { api } from "../../lib/api";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { SatisfactionReport } from "../../components/reports/SatisfactionReport";

type ReportKind = "attendance" | "per-agent" | "messages" | "satisfaction";

const TABS: { key: ReportKind; label: string }[] = [
  { key: "attendance", label: "Atendimentos" },
  { key: "per-agent", label: "Por atendente" },
  { key: "messages", label: "Mensagens" },
  { key: "satisfaction", label: "Pesquisa de satisfação" },
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
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  // Hidden columns, kept per report tab (each has a different column set) —
  // see PROMPT: "poder remover algumas colunas, para que o relatório fique
  // melhor apresentável ao visualizar ou extrair". Applies to both the
  // on-screen table and every export format.
  const [hiddenColumnsByTab, setHiddenColumnsByTab] = useState<Partial<Record<ReportKind, string[]>>>({});
  const columnsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) setColumnsMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    // The satisfaction tab has its own screen and query (SatisfactionReport).
    enabled: tab !== "satisfaction",
  });

  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : [];
  const allColumns = rows[0] ? Object.keys(rows[0]) : [];
  const hiddenColumns = hiddenColumnsByTab[tab] ?? [];
  const visibleColumns = allColumns.filter((c) => !hiddenColumns.includes(c));

  function toggleColumn(column: string) {
    setHiddenColumnsByTab((prev) => {
      const current = prev[tab] ?? [];
      const next = current.includes(column) ? current.filter((c) => c !== column) : [...current, column];
      return { ...prev, [tab]: next };
    });
  }

  // See PROMPT: "Relatórios poder extrair em PDF e em xlsx" — alongside the
  // pre-existing CSV export, same three formats on every tab.
  async function download(format: "csv" | "pdf" | "xlsx", satisfactionTable?: "responses" | "agents") {
    setExportMenuOpen(false);
    const res = await api.get(`/reports/${tab}`, {
      params: {
        period: period.period,
        from: period.from,
        to: period.to,
        connectionId: connectionIds.length ? connectionIds : undefined,
        format,
        columns: allColumns.length && !satisfactionTable ? visibleColumns.join(",") : undefined,
        table: satisfactionTable,
        tzOffsetMinutes: new Date().getTimezoneOffset(),
      },
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", satisfactionTable ? `relatorio-pesquisa-${satisfactionTable === "agents" ? "por-atendente" : "respostas"}.${format}` : `relatorio-${tab}.${format}`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
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

        <div className="flex flex-wrap items-center gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
          {tab !== "messages" && tab !== "satisfaction" && allColumns.length > 0 && (
            <div ref={columnsMenuRef} className="relative">
              <button
                onClick={() => setColumnsMenuOpen((o) => !o)}
                className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-3 py-2 text-sm font-medium hover:bg-surface-alt"
              >
                <Columns3 className="h-4 w-4" /> Colunas
                {hiddenColumns.length > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary">{visibleColumns.length}</span>}
                <ChevronDown className="h-3.5 w-3.5 text-muted" />
              </button>
              {columnsMenuOpen && (
                <div className="shadow-soft absolute right-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-card border border-border bg-surface p-2">
                  {allColumns.map((column) => (
                    <label key={column} className="flex cursor-pointer items-center gap-2 rounded-card px-2 py-1.5 text-sm hover:bg-surface-alt">
                      <input type="checkbox" checked={!hiddenColumns.includes(column)} onChange={() => toggleColumn(column)} />
                      {column}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
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
                <div className={`shadow-soft absolute right-0 top-full z-20 mt-1 rounded-card border border-border bg-surface p-1 ${tab === "satisfaction" ? "w-60" : "w-44"}`}>
                  {tab === "satisfaction" ? (
                    (
                      [
                        { table: "responses", label: "Respostas (cliente e nota)" },
                        { table: "agents", label: "Notas por atendente" },
                      ] as const
                    ).map((group) => (
                      <div key={group.table} className="py-1">
                        <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.label}</p>
                        {EXPORT_FORMATS.map((f) => (
                          <button
                            key={f.key}
                            onClick={() => download(f.key, group.table)}
                            className="focus-ring flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-sm hover:bg-surface-alt"
                          >
                            <f.icon className="h-4 w-4 text-muted" /> {f.label}
                          </button>
                        ))}
                      </div>
                    ))
                  ) : (
                    EXPORT_FORMATS.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => download(f.key)}
                        className="focus-ring flex w-full items-center gap-2 rounded-card px-2.5 py-2 text-left text-sm hover:bg-surface-alt"
                      >
                        <f.icon className="h-4 w-4 text-muted" /> {f.label}
                      </button>
                    ))
                  )}
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

      {tab === "satisfaction" && <SatisfactionReport period={period} connectionIds={connectionIds} />}

      {tab !== "messages" && tab !== "satisfaction" && (
        <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
              <tr>{visibleColumns.map((key) => <th key={key} className="whitespace-nowrap px-4 py-3">{key}</th>)}</tr>
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
                  {visibleColumns.map((key) => (
                    <td key={key} className="whitespace-nowrap px-4 py-2.5">
                      {String(row[key] ?? "-")}
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
