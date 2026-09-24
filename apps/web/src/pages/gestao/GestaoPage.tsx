import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRightLeft, CheckCircle2, Eye, GitMerge, Inbox } from "lucide-react";
import { PERMISSION, type ConversationListItemDTO, type ConversationStatus } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { contactDisplayName } from "../../lib/contact-display";
import { useAuthStore } from "../../store/auth-store";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { ReadOnlyConversationDrawer } from "../../components/gestao/ReadOnlyConversationDrawer";
import { MergeConversationModal } from "../../components/gestao/MergeConversationModal";
import { GestaoTransferModal } from "../../components/gestao/GestaoTransferModal";

// Same "still active" scope the backend enforces (see
// assignConversationFromGestao/returnConversationToQueue) — CLOSED/ABANDONED
// are terminal, nothing to route there anymore.
const ROUTABLE_STATUSES = new Set<ConversationStatus>(["NEW", "WAITING", "IN_PROGRESS", "TRANSFERRED", "HANDLED_EXTERNALLY"]);
const ALREADY_QUEUED_STATUSES = new Set<ConversationStatus>(["NEW", "WAITING"]);

const STATUS_LABEL: Record<string, string> = {
  NEW: "Nova",
  WAITING: "Aguardando",
  IN_PROGRESS: "Em atendimento",
  TRANSFERRED: "Transferida",
  CLOSED: "Encerrada",
  ABANDONED: "Abandonada",
  HANDLED_EXTERNALLY: "Atendido pelo celular",
};

const STATUS_COLOR: Record<string, string> = {
  NEW: "bg-secondary/50 text-secondary-fg",
  WAITING: "bg-secondary/50 text-secondary-fg",
  IN_PROGRESS: "bg-primary/15 text-primary",
  TRANSFERRED: "bg-purple-100 text-purple-700",
  CLOSED: "bg-gray-100 text-gray-600",
  ABANDONED: "bg-red-100 text-red-700",
  HANDLED_EXTERNALLY: "bg-yellow-100 text-yellow-700",
};

interface AgentOption {
  id: string;
  displayName: string;
}

export default function GestaoPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "today" });
  const [agentId, setAgentId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<ConversationListItemDTO | null>(null);
  const [merging, setMerging] = useState<ConversationListItemDTO | null>(null);
  const [transferring, setTransferring] = useState<ConversationListItemDTO | null>(null);
  const [closing, setClosing] = useState<ConversationListItemDTO | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");
  // Transferir/Enviar p/ fila hit /conversations/:id/gestao-transfer and
  // /gestao-return-to-queue, both gated backend-side by GESTAO_GERENCIAR on
  // top of the GESTAO_ACESSAR umbrella already required to reach this page
  // — see PROMPT: "Mapeie todos os menus e o que tem dentro dos menus e
  // inclua nas permissões".
  const canManage = useAuthStore((s) => s.permissions?.[PERMISSION.GESTAO_GERENCIAR]);
  const queryClient = useQueryClient();

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents")).data,
  });

  const returnToQueueMutation = useMutation({
    mutationFn: (conversationId: string) => api.post(`/conversations/${conversationId}/gestao-return-to-queue`),
    onSuccess: () => {
      toast.success("Conversa enviada para a fila.");
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: ({ conversationId, sendClosingMessage }: { conversationId: string; sendClosingMessage: boolean }) =>
      api.post(`/conversations/${conversationId}/gestao-close`, { sendClosingMessage }),
    onSuccess: () => {
      toast.success("Atendimento encerrado.");
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
      setClosing(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["oversight", period, agentId, status, search, connectionIds],
    queryFn: async () =>
      (
        await api.get<ConversationListItemDTO[]>("/conversations/oversight", {
          params: {
            from: period.from,
            to: period.to,
            agentId: agentId === "all" ? undefined : agentId,
            status: status === "all" ? undefined : status,
            q: search || undefined,
            connectionId: connectionIds.length ? connectionIds : undefined,
          },
        })
      ).data,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />

        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm">
          <option value="all">Todos os atendentes</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>

        <select value={status} onChange={(e) => setStatus(e.target.value)} className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm">
          <option value="all">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          className="focus-ring flex-1 min-w-[200px] rounded-card border border-border bg-surface px-3 py-2 text-sm"
        />

        <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
      </div>

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Atendente</th>
              <th className="px-4 py-3">Conexão</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Entrada na fila</th>
              <th className="px-4 py-3">Aceite</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && conversations?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  Nenhuma conversa encontrada para os filtros selecionados.
                </td>
              </tr>
            )}
            {conversations?.map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-surface-alt">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    {c.contact.photoUrl ? (
                      <img src={c.contact.photoUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-alt text-xs font-semibold text-muted">
                        {contactDisplayName(c.contact).slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{contactDisplayName(c.contact)}</div>
                      {c.contact.phone && <div className="text-xs text-muted">{c.contact.phone}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{c.assignedAgentName ?? "-"}</td>
                <td className="px-4 py-3 text-muted">{c.whatsappConnectionName}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                </td>
                <td className="px-4 py-3 text-muted">{formatDistanceToNow(new Date(c.enteredQueueAt), { locale: ptBR, addSuffix: true })}</td>
                <td className="px-4 py-3 text-muted">{c.acceptedAt ? formatDistanceToNow(new Date(c.acceptedAt), { locale: ptBR, addSuffix: true }) : "-"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {canManage && ROUTABLE_STATUSES.has(c.status) && (
                      <button
                        onClick={() => setTransferring(c)}
                        className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary hover:underline"
                        title="Transferir para outro atendente"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Transferir
                      </button>
                    )}
                    {canManage && ROUTABLE_STATUSES.has(c.status) && !ALREADY_QUEUED_STATUSES.has(c.status) && (
                      <button
                        onClick={() => returnToQueueMutation.mutate(c.id)}
                        disabled={returnToQueueMutation.isPending}
                        className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary hover:underline disabled:opacity-50"
                        title="Enviar de volta para a fila, sem atendente"
                      >
                        <Inbox className="h-3.5 w-3.5" /> Enviar p/ fila
                      </button>
                    )}
                    {canManage && ROUTABLE_STATUSES.has(c.status) && (
                      <button
                        onClick={() => setClosing(c)}
                        className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary hover:underline"
                        title="Encerrar este atendimento"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Encerrar
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setMerging(c)}
                        className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-primary hover:underline"
                        title="Mesclar esta conversa duplicada com outra"
                      >
                        <GitMerge className="h-3.5 w-3.5" /> Mesclar
                      </button>
                    )}
                    <button onClick={() => setSelected(c)} className="focus-ring inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      <Eye className="h-3.5 w-3.5" /> Visualizar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && <ReadOnlyConversationDrawer conversation={selected} onClose={() => setSelected(null)} />}

      {merging && (
        <MergeConversationModal
          conversation={merging}
          onClose={() => setMerging(null)}
          onMerged={() => setMerging(null)}
        />
      )}

      {transferring && (
        <GestaoTransferModal
          conversation={transferring}
          onClose={() => setTransferring(null)}
          onTransferred={() => setTransferring(null)}
        />
      )}

      {closing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Encerrar atendimento?</h2>
            <p className="mt-2 text-sm text-muted">
              Encerrar a conversa com {contactDisplayName(closing.contact)}. Deseja enviar a mensagem de encerramento
              configurada para o cliente?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => closeMutation.mutate({ conversationId: closing.id, sendClosingMessage: true })}
                disabled={closeMutation.isPending}
                className="focus-ring rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
              >
                {closeMutation.isPending ? "Encerrando..." : "Encerrar e enviar mensagem"}
              </button>
              <button
                onClick={() => closeMutation.mutate({ conversationId: closing.id, sendClosingMessage: false })}
                disabled={closeMutation.isPending}
                className="focus-ring rounded-card border border-border py-2 text-sm font-medium disabled:opacity-60"
              >
                Encerrar sem enviar mensagem
              </button>
              <button
                onClick={() => setClosing(null)}
                disabled={closeMutation.isPending}
                className="focus-ring py-2 text-sm text-muted disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
