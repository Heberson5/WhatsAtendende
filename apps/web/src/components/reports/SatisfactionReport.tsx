import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Eye, Search } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import type { ConversationListItemDTO, SatisfactionCategory, SatisfactionReportDTO, SatisfactionResponseDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { formatPhone } from "../../lib/format-phone";
import { npsZone } from "../../lib/dashboardMetrics";
import { CHART_CARD_SHADOW, CHART_TOOLTIP_PROPS } from "../../lib/chart-theme";
import { ReadOnlyConversationDrawer } from "../gestao/ReadOnlyConversationDrawer";
import type { PeriodValue } from "../common/PeriodFilter";

const formatNps = (nps: number | null) => (nps === null ? "–" : nps > 0 ? `+${nps}` : String(nps));
const formatAverage = (v: number | null) => (v === null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

const CATEGORY: Record<SatisfactionCategory, { label: string; chip: string; color: string }> = {
  promoter: { label: "Promotor", chip: "bg-success-soft text-success", color: "var(--color-success)" },
  passive: { label: "Neutro", chip: "bg-warning-soft text-warning", color: "var(--color-warning)" },
  detractor: { label: "Detrator", chip: "bg-danger-soft text-danger", color: "var(--color-danger)" },
};
const ZONE_TEXT = { success: "text-success", primary: "text-primary", warning: "text-warning", danger: "text-danger" } as const;
const npsTone = (nps: number | null) => (nps === null ? "text-muted" : ZONE_TEXT[npsZone(nps).tone]);

type ResponseFilter = "answered" | SatisfactionCategory | "unanswered";
const RESPONSE_FILTERS: { key: ResponseFilter; label: string }[] = [
  { key: "answered", label: "Respondidas" },
  { key: "detractor", label: "Detratores (0–6)" },
  { key: "passive", label: "Neutros (7–8)" },
  { key: "promoter", label: "Promotores (9–10)" },
  { key: "unanswered", label: "Sem resposta" },
];

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
}

function Kpi({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className={clsx("rounded-card border border-border bg-surface p-4", CHART_CARD_SHADOW)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={clsx("mt-1 text-3xl font-semibold tabular-nums", tone)}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted">{detail}</p>}
    </div>
  );
}

/**
 * Relatórios › Pesquisa de satisfação: NPS and average of the period, the 0–10 spread, how it moved, each
 * attendant and each connection, and every answer with the customer — each one opens the conversation that
 * was rated. See PROMPT: "relatório somente das pesquisas, podendo saber de qual cliente foi a nota e poder
 * olhar a conversa avaliada, poder saber as notas que cada atendente recebe".
 */
export function SatisfactionReport({ period, connectionIds }: { period: PeriodValue; connectionIds: string[] }) {
  const [agentId, setAgentId] = useState<string>("all");
  const [filter, setFilter] = useState<ResponseFilter>("answered");
  const [search, setSearch] = useState("");
  const [openConversation, setOpenConversation] = useState<ConversationListItemDTO | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["report", "satisfaction", period, connectionIds, agentId],
    queryFn: async () =>
      (
        await api.get<SatisfactionReportDTO>("/reports/satisfaction", {
          params: {
            period: period.period,
            from: period.from,
            to: period.to,
            connectionId: connectionIds.length ? connectionIds : undefined,
            agentId: agentId === "all" ? undefined : agentId,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
          },
        })
      ).data,
    placeholderData: (previous) => previous,
  });
  // The attendant filter lists everyone who was rated in the period (kept while one is selected).
  const [knownAgents, setKnownAgents] = useState<{ id: string; name: string }[]>([]);
  const agentOptions = useMemo(() => {
    const fromData = (data?.byAgent ?? []).filter((a) => a.agentId).map((a) => ({ id: a.agentId!, name: a.agentName }));
    const merged = new Map([...knownAgents, ...fromData].map((a) => [a.id, a]));
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [data, knownAgents]);

  const openMutation = useMutation({
    mutationFn: async (conversationId: string) => (await api.get<ConversationListItemDTO>(`/conversations/${conversationId}`)).data,
    onSuccess: setOpenConversation,
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const responses = (data?.responses ?? []).filter((r) => {
    const byFilter =
      filter === "answered" ? r.status === "answered" : filter === "unanswered" ? r.status !== "answered" : r.category === filter;
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const bySearch = !q || (r.contactName ?? "").toLowerCase().includes(q) || (digits.length > 0 && (r.contactPhone ?? "").includes(digits));
    return byFilter && bySearch;
  });

  if (isLoading && !data) return <p className="py-10 text-center text-sm text-muted">Carregando...</p>;
  if (!data || data.totals.sent === 0) {
    return <p className="py-10 text-center text-sm text-muted">Nenhuma pesquisa de satisfação enviada no período selecionado.</p>;
  }

  const { totals } = data;
  const zone = totals.nps === null ? null : npsZone(totals.nps);
  const distribution = totals.distribution.map((count, score) => ({ score: String(score), count, category: (score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor") as SatisfactionCategory }));

  return (
    <div className="flex-1 space-y-4 overflow-y-auto pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={agentId}
          onChange={(e) => {
            setKnownAgents(agentOptions);
            setAgentId(e.target.value);
          }}
          aria-label="Filtrar por atendente"
          className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="all">Todos os atendentes</option>
          {agentOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">Só as pesquisas de nota de 0 a 10 (NPS). As de 1 a 5, de antes do NPS, ficam fora da conta.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="NPS" value={formatNps(totals.nps)} detail={zone?.label ?? "sem respostas"} tone={npsTone(totals.nps)} />
        <Kpi label="Nota média" value={formatAverage(totals.average)} detail="de 0 a 10" />
        <Kpi
          label="Respostas"
          value={totals.answered.toLocaleString("pt-BR")}
          detail={`de ${totals.sent.toLocaleString("pt-BR")} enviadas · ${totals.responseRate ?? 0}%${totals.awaiting ? ` · ${totals.awaiting} aguardando` : ""}`}
        />
        <div className={clsx("rounded-card border border-border bg-surface p-4", CHART_CARD_SHADOW)}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Promotores · Neutros · Detratores</p>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-surface-alt" role="img" aria-label={`Promotores ${totals.promoters}, neutros ${totals.passives}, detratores ${totals.detractors}`}>
            <span className="h-full bg-success" style={{ width: `${percent(totals.promoters, totals.answered)}%` }} />
            <span className="h-full bg-warning" style={{ width: `${percent(totals.passives, totals.answered)}%` }} />
            <span className="h-full bg-danger" style={{ width: `${percent(totals.detractors, totals.answered)}%` }} />
          </div>
          <p className="mt-2 text-xs tabular-nums">
            <span className="font-semibold text-success">{percent(totals.promoters, totals.answered)}%</span>
            <span className="text-muted"> · </span>
            <span className="font-semibold text-warning">{percent(totals.passives, totals.answered)}%</span>
            <span className="text-muted"> · </span>
            <span className="font-semibold text-danger">{percent(totals.detractors, totals.answered)}%</span>
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className={clsx("rounded-card border border-border bg-surface p-4", CHART_CARD_SHADOW)} aria-label="Notas de 0 a 10">
          <h3 className="mb-2 text-sm font-semibold">Notas de 0 a 10</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distribution} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="score" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip {...CHART_TOOLTIP_PROPS} formatter={(v: number) => [v, "Respostas"]} labelFormatter={(l) => `Nota ${l}`} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, formatter: (v: number) => (v ? v : "") }}>
                  {distribution.map((d) => (
                    <Cell key={d.score} fill={CATEGORY[d.category].color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={clsx("rounded-card border border-border bg-surface p-4", CHART_CARD_SHADOW)} aria-label="Evolução do NPS">
          <h3 className="mb-2 text-sm font-semibold">Evolução do NPS no período</h3>
          {data.trend.length < 2 ? (
            <p className="flex h-56 items-center justify-center text-sm text-muted">A evolução aparece quando há respostas em mais de um dia.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 16, right: 12, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis domain={[-100, 100]} ticks={[-100, -50, 0, 50, 100]} tick={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="var(--color-border)" />
                  <Tooltip
                    {...CHART_TOOLTIP_PROPS}
                    formatter={(v: number, name: string) => (name === "nps" ? [formatNps(v), "NPS"] : [v, name])}
                  />
                  <Line type="linear" dataKey="nps" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 3.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className={clsx("overflow-hidden rounded-card border border-border bg-surface", CHART_CARD_SHADOW)} aria-label="Notas por atendente">
        <h3 className="px-4 pb-2 pt-4 text-sm font-semibold">Notas por atendente</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Atendente</th>
                <th className="px-4 py-2.5 text-right">Pesquisas</th>
                <th className="px-4 py-2.5 text-right">Respostas</th>
                <th className="px-4 py-2.5 text-right">Taxa</th>
                <th className="px-4 py-2.5 text-right">Nota média</th>
                <th className="px-4 py-2.5 text-right">NPS</th>
                <th className="px-4 py-2.5 text-right">Promotores</th>
                <th className="px-4 py-2.5 text-right">Neutros</th>
                <th className="px-4 py-2.5 text-right">Detratores</th>
                <th className="px-4 py-2.5 text-right">Menor / maior</th>
              </tr>
            </thead>
            <tbody>
              {data.byAgent.map((a) => (
                <tr key={a.agentId ?? "none"} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{a.agentName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.sent}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.answered}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.responseRate === null ? "–" : `${a.responseRate}%`}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatAverage(a.average)}</td>
                  <td className={clsx("px-4 py-2.5 text-right font-semibold tabular-nums", npsTone(a.nps))}>{formatNps(a.nps)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-success">{a.promoters}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-warning">{a.passives}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-danger">{a.detractors}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{a.lowest === null ? "–" : `${a.lowest} / ${a.highest}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.byConnection.length > 1 && (
        <section className={clsx("overflow-hidden rounded-card border border-border bg-surface", CHART_CARD_SHADOW)} aria-label="Notas por conexão">
          <h3 className="px-4 pb-2 pt-4 text-sm font-semibold">Notas por conexão</h3>
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
            {data.byConnection.map((c) => (
              <div key={c.connectionId} className="flex items-center justify-between gap-3 bg-surface px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.connectionColor }} />
                  <span className="truncate">{c.connectionName}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  <span className={clsx("text-base font-semibold tabular-nums", npsTone(c.nps))}>NPS {formatNps(c.nps)}</span>
                  <br />
                  média {formatAverage(c.average)} · {c.answered} de {c.sent}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={clsx("overflow-hidden rounded-card border border-border bg-surface", CHART_CARD_SHADOW)} aria-label="Respostas">
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
          <h3 className="mr-2 text-sm font-semibold">Respostas</h3>
          {RESPONSE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={clsx(
                "focus-ring rounded-full border px-2.5 py-0.5 text-xs font-medium",
                filter === f.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-[var(--color-text)]"
              )}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto flex h-8 min-w-[200px] items-center gap-2 rounded-lg border border-border px-2.5 text-xs text-muted focus-within:border-primary/50">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar cliente nas respostas"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text)] outline-none placeholder:text-muted"
            />
          </label>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2.5">Data</th>
                <th className="px-4 py-2.5">Cliente</th>
                <th className="px-4 py-2.5">Atendente</th>
                <th className="px-4 py-2.5">Conexão</th>
                <th className="px-4 py-2.5 text-right">Nota</th>
                <th className="px-4 py-2.5">Classificação</th>
                <th className="px-4 py-2.5">
                  <span className="sr-only">Conversa</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {responses.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Nenhuma resposta com esse filtro.
                  </td>
                </tr>
              )}
              {responses.map((r) => (
                <ResponseRow key={r.surveyId} response={r} opening={openMutation.isPending && openMutation.variables === r.conversationId} onOpen={() => openMutation.mutate(r.conversationId)} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openConversation && <ReadOnlyConversationDrawer key={openConversation.id} conversation={openConversation} onClose={() => setOpenConversation(null)} />}
    </div>
  );
}

function ResponseRow({ response: r, opening, onOpen }: { response: SatisfactionResponseDTO; opening: boolean; onOpen: () => void }) {
  return (
    <tr className="border-t border-border hover:bg-surface-alt">
      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{when(r.answeredAt ?? r.sentAt)}</td>
      <td className="px-4 py-2.5">
        <p className="font-medium">{r.contactName ?? (r.contactPhone ? formatPhone(r.contactPhone) : "–")}</p>
        {r.contactName && r.contactPhone && <p className="text-xs tabular-nums text-muted">{formatPhone(r.contactPhone)}</p>}
      </td>
      <td className="px-4 py-2.5">{r.agentName ?? "–"}</td>
      <td className="px-4 py-2.5 text-muted">{r.connectionName}</td>
      <td className="px-4 py-2.5 text-right text-base font-semibold tabular-nums">{r.score ?? "–"}</td>
      <td className="px-4 py-2.5">
        {r.category ? (
          <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", CATEGORY[r.category].chip)}>{CATEGORY[r.category].label}</span>
        ) : (
          <span className="text-xs text-muted">{r.status === "awaiting" ? "Aguardando" : "Sem resposta"}</span>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={onOpen}
          disabled={opening}
          className="focus-ring inline-flex items-center gap-1.5 whitespace-nowrap rounded-card border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-alt disabled:opacity-60"
          aria-label={`Ver a conversa avaliada de ${r.contactName ?? r.contactPhone ?? "cliente"}`}
        >
          <Eye className="h-3.5 w-3.5" /> {opening ? "Abrindo..." : "Ver conversa"}
        </button>
      </td>
    </tr>
  );
}
