import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../../lib/api";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";

type ReportKind = "attendance" | "per-agent" | "messages";

const TABS: { key: ReportKind; label: string }[] = [
  { key: "attendance", label: "Atendimentos" },
  { key: "per-agent", label: "Por atendente" },
  { key: "messages", label: "Mensagens" },
];

export default function RelatoriosPage() {
  const [tab, setTab] = useState<ReportKind>("attendance");
  const [period, setPeriod] = useState<PeriodValue>({ period: "month" });
  const [connectionIds, setConnectionIds] = useState<string[]>([]);

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

  async function download() {
    const res = await api.get(`/reports/${tab}`, {
      params: {
        period: period.period,
        from: period.from,
        to: period.to,
        connectionId: connectionIds.length ? connectionIds : undefined,
        format: "csv",
      },
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `relatorio-${tab}.csv`);
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
          {tab !== "messages" && (
            <button
              onClick={download}
              className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-3 py-2 text-sm font-medium hover:bg-surface-alt"
            >
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          )}
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
