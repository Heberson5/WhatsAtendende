import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Inbox, MessageSquare, Timer, Users } from "lucide-react";
import { api } from "../../lib/api";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { StatCard, formatMinutes } from "../../components/common/StatCard";

interface AgentOption {
  id: string;
  displayName: string;
}

interface DashboardData {
  conversations: { received: number; unique: number; inProgress: number; closed: number; waiting: number };
  messages: { received: number; sent: number; total: number };
  timings: { avgAcceptMs: number | null; avgFirstResponseMs: number | null; avgHandlingMs: number | null; avgClosingMs: number | null };
  perAgent: { agentId: string; agentName: string; conversations: number; messagesSent: number; avgHandlingMs: number | null }[];
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "today" });
  const [agentId, setAgentId] = useState("all");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents")).data,
  });

  const { data, isLoading } = useQuery({
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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
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

      {isLoading && <p className="text-sm text-muted">Carregando indicadores...</p>}

      {data && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted">Conversas</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <StatCard label="Recebidas" value={data.conversations.received} icon={Inbox} />
              <StatCard label="Únicas" value={data.conversations.unique} icon={Users} />
              <StatCard label="Aguardando" value={data.conversations.waiting} icon={Timer} />
              <StatCard label="Em atendimento" value={data.conversations.inProgress} icon={MessageSquare} />
              <StatCard label="Encerradas" value={data.conversations.closed} icon={Inbox} />
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
            <div className="shadow-soft rounded-card border border-border bg-surface p-4">
              {data.perAgent.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">Sem dados no período selecionado.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.perAgent}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="agentName" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="conversations" name="Conversas" fill="#0097B4" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="messagesSent" name="Mensagens enviadas" fill="#FFE450" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
