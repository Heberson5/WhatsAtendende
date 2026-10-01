import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileBarChart2, Inbox, MessageSquare, Timer, UserCheck, Users, Wifi } from "lucide-react";
import { PERMISSION, type PresenceByHourDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { StatCard, formatMinutes } from "../../components/common/StatCard";
import { DistributionChartCard } from "../../components/dashboard/DistributionChartCard";
import { SeriesChartCard } from "../../components/dashboard/SeriesChartCard";
import { WordCloudCard } from "../../components/dashboard/WordCloudCard";
import { PresenceByHourChart, type HourRange } from "../../components/dashboard/PresenceByHourChart";
import { useBranding } from "../../hooks/useBranding";
import { useExportBranding } from "../../hooks/useExportBranding";
import { NEUTRAL_SERIES_COLOR } from "../../lib/chart-theme";
import { exportDashboardPptx } from "../../lib/exportDashboardPptx";

interface AgentOption {
  id: string;
  displayName: string;
}

interface DashboardData {
  conversations: { received: number; unique: number; inProgress: number; closed: number; waiting: number };
  messages: { received: number; sent: number; total: number };
  timings: { avgAcceptMs: number | null; avgFirstResponseMs: number | null; avgHandlingMs: number | null; avgClosingMs: number | null };
  perAgent: { agentId: string; agentName: string; conversations: number; messagesSent: number; messagesReceived: number; avgHandlingMs: number | null }[];
  users: { online: number; active: number; total: number };
}

// Amber for "waiting" doesn't come from the brand (it's a status-severity
// color, same convention as StatCard/queue badges elsewhere), the other two
// slots follow the company's own primary/secondary — see PROMPT: "gráficos
// neste estilo, mais apresentável com estilo de 3d e profundidade".
const WAITING_COLOR = "#F59E0B";

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "today" });
  const [agentId, setAgentId] = useState("all");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [exportingPptx, setExportingPptx] = useState(false);
  const navigate = useNavigate();
  const permissions = useAuthStore((s) => s.permissions);
  const user = useAuthStore((s) => s.user);
  const updatePresenceChartHours = useAuthStore((s) => s.updatePresenceChartHours);
  const canOpenGestao = permissions?.[PERMISSION.GESTAO_ACESSAR];
  const canOpenUsuarios = permissions?.[PERMISSION.USUARIOS_VISUALIZAR];

  // "Aguardando" never carries the dashboard's period filter — the count
  // itself isn't period-scoped server-side (it's "right now", same as
  // listQueue), so applying the period here would open a list that doesn't
  // match the card's own number. "Em atendimento"/"Encerradas" do apply it,
  // since those counts ARE scoped to the selected period. See PROMPT: "já
  // aplicado o filtro do período do dashboard e o filtro do card".
  function goToGestao(statuses: string[], includePeriod: boolean) {
    const params = new URLSearchParams({ status: statuses.join(",") });
    if (includePeriod) {
      params.set("period", period.period);
      if (period.from) params.set("from", period.from);
      if (period.to) params.set("to", period.to);
    }
    navigate(`/gestao?${params.toString()}`);
  }

  const { data: branding } = useBranding();
  const { data: exportBranding } = useExportBranding();
  const primaryColor = branding?.primaryColor ?? "#0097B4";
  const secondaryColor = branding?.secondaryColor ?? "#FFE450";
  const statusColors = [WAITING_COLOR, primaryColor, NEUTRAL_SERIES_COLOR];
  const messageColors = [primaryColor, secondaryColor];
  const agentSeriesColors = [primaryColor, secondaryColor];

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents")).data,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", period, agentId, connectionIds],
    queryFn: async () =>
      (
        await api.get<DashboardData>("/dashboard", {
          params: {
            period: period.period,
            from: period.from,
            to: period.to,
            agentId: agentId === "all" ? undefined : agentId,
            connectionId: connectionIds.length ? connectionIds : undefined,
          },
        })
      ).data,
  });

  const { data: wordCloud, isLoading: isWordCloudLoading } = useQuery({
    queryKey: ["dashboard-word-cloud", period, agentId, connectionIds],
    queryFn: async () =>
      (
        await api.get<{ word: string; count: number }[]>("/dashboard/word-cloud", {
          params: {
            period: period.period,
            from: period.from,
            to: period.to,
            agentId: agentId === "all" ? undefined : agentId,
            connectionId: connectionIds.length ? connectionIds : undefined,
          },
        })
      ).data,
  });

  const { data: presenceByHour, isLoading: isPresenceByHourLoading } = useQuery({
    queryKey: ["dashboard-presence-by-hour", period, agentId],
    queryFn: async () =>
      (
        await api.get<PresenceByHourDTO>("/dashboard/presence-by-hour", {
          params: {
            period: period.period,
            from: period.from,
            to: period.to,
            agentId: agentId === "all" ? undefined : agentId,
          },
        })
      ).data,
  });

  const [activeHourRange, setActiveHourRange] = useState<HourRange | null>(
    user?.presenceChartStartHour != null && user?.presenceChartEndHour != null
      ? { start: user.presenceChartStartHour, end: user.presenceChartEndHour }
      : null
  );

  const saveDefaultHourRangeMutation = useMutation({
    mutationFn: (range: HourRange | null) =>
      api.patch("/settings/presence-chart-hours", { startHour: range?.start ?? null, endHour: range?.end ?? null }),
    onSuccess: (_res, range) => updatePresenceChartHours(range?.start ?? null, range?.end ?? null),
  });

  // Native, editable PowerPoint charts (not screenshots) built straight from
  // the same data already loaded here — see PROMPT: "forma de exportar em
  // Power Point bem formatado para ser apresentável à diretoria".
  async function handleExportPptx() {
    if (!data) return;
    setExportingPptx(true);
    try {
      await exportDashboardPptx({
        data,
        period,
        branding: exportBranding ?? null,
        statusColors,
        messageColors,
        agentSeriesColors,
        wordCloud: wordCloud ?? [],
        presenceByHour,
        presenceHourRange: activeHourRange,
        presenceIsToday: period.period === "today",
        primaryColor,
        secondaryColor,
      });
    } finally {
      setExportingPptx(false);
    }
  }

  return (
    <div className="h-full overflow-auto p-3 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm">
            <option value="all">Todos os atendentes</option>
            {agents?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
          </select>
          <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
        </div>
        <button
          onClick={handleExportPptx}
          disabled={!data || exportingPptx}
          className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-3 py-2 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileBarChart2 className="h-4 w-4" /> {exportingPptx ? "Gerando..." : "Exportar PPT"}
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted">Carregando indicadores...</p>}

      {isError && (
        <p className="text-sm text-red-600">
          Não foi possível carregar os indicadores: {getApiErrorMessage(error, "erro inesperado")}
        </p>
      )}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Usuários</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <StatCard
                label="Online agora"
                value={data.users.online}
                icon={Wifi}
                onClick={canOpenUsuarios ? () => navigate("/usuarios") : undefined}
                goToLabel="Ver Usuários →"
              />
              <StatCard
                label="Ativos"
                value={data.users.active}
                icon={UserCheck}
                onClick={canOpenUsuarios ? () => navigate("/usuarios") : undefined}
                goToLabel="Ver Usuários →"
              />
              <StatCard
                label="Total"
                value={data.users.total}
                icon={Users}
                onClick={canOpenUsuarios ? () => navigate("/usuarios") : undefined}
                goToLabel="Ver Usuários →"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Conversas</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <StatCard label="Recebidas" value={data.conversations.received} icon={Inbox} />
              <StatCard label="Únicas" value={data.conversations.unique} icon={Users} />
              <StatCard
                label="Aguardando"
                value={data.conversations.waiting}
                icon={Timer}
                onClick={canOpenGestao ? () => goToGestao(["NEW", "WAITING"], false) : undefined}
                goToLabel="Ver na Gestão →"
              />
              <StatCard
                label="Em atendimento"
                value={data.conversations.inProgress}
                icon={MessageSquare}
                onClick={canOpenGestao ? () => goToGestao(["IN_PROGRESS", "TRANSFERRED"], true) : undefined}
                goToLabel="Ver na Gestão →"
              />
              <StatCard
                label="Encerradas"
                value={data.conversations.closed}
                icon={Inbox}
                onClick={canOpenGestao ? () => goToGestao(["CLOSED"], true) : undefined}
                goToLabel="Ver na Gestão →"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Mensagens</h2>
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Recebidas" value={data.messages.received} icon={MessageSquare} />
              <StatCard label="Enviadas" value={data.messages.sent} icon={MessageSquare} />
              <StatCard label="Total" value={data.messages.total} icon={MessageSquare} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Distribuição no período</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <DistributionChartCard
                title="Conversas por status"
                data={[
                  { name: "Aguardando", value: data.conversations.waiting },
                  { name: "Em atendimento", value: data.conversations.inProgress },
                  { name: "Encerradas", value: data.conversations.closed },
                ]}
                colors={statusColors}
              />
              <DistributionChartCard
                title="Mensagens recebidas x enviadas"
                data={[
                  { name: "Recebidas", value: data.messages.received },
                  { name: "Enviadas", value: data.messages.sent },
                ]}
                colors={messageColors}
              />
            </div>
          </section>

          <section>
            <WordCloudCard words={wordCloud} isLoading={isWordCloudLoading} />
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Tempos médios de atendimento</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard label="Aceite" value={formatMinutes(data.timings.avgAcceptMs)} icon={Timer} />
              <StatCard label="1ª resposta" value={formatMinutes(data.timings.avgFirstResponseMs)} icon={Timer} />
              <StatCard label="Atendimento" value={formatMinutes(data.timings.avgHandlingMs)} icon={Timer} />
              <StatCard label="Até encerramento" value={formatMinutes(data.timings.avgClosingMs)} icon={Timer} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Atendimentos por atendente</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <SeriesChartCard
                title="Conversas por atendente"
                data={data.perAgent}
                categoryKey="agentName"
                series={[{ key: "conversations", name: "Conversas", color: agentSeriesColors[0] }]}
              />
              <SeriesChartCard
                title="Mensagens enviadas x recebidas por atendente"
                data={data.perAgent}
                categoryKey="agentName"
                series={[
                  { key: "messagesSent", name: "Enviadas", color: messageColors[1] },
                  { key: "messagesReceived", name: "Recebidas", color: messageColors[0] },
                ]}
              />
            </div>
          </section>

          <section>
            <PresenceByHourChart
              data={presenceByHour}
              isLoading={isPresenceByHourLoading}
              isToday={period.period === "today"}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              initialRange={
                user?.presenceChartStartHour != null && user?.presenceChartEndHour != null
                  ? { start: user.presenceChartStartHour, end: user.presenceChartEndHour }
                  : null
              }
              onSaveDefaultRange={(range) => saveDefaultHourRangeMutation.mutate(range)}
              onActiveRangeChange={setActiveHourRange}
            />
          </section>
        </div>
      )}
    </div>
  );
}
