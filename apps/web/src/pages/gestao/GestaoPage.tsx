import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import clsx from "clsx";
import { ArrowRightLeft, CheckCircle2, Eye, GitMerge, Inbox, Search, X } from "lucide-react";
import { PERMISSION, type ConversationListItemDTO, type ConversationStatus } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { contactDisplayName } from "../../lib/contact-display";
import { useAuthStore } from "../../store/auth-store";
import { PeriodFilter, type PeriodValue } from "../../components/common/PeriodFilter";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { ReadOnlyConversationDrawer } from "../../components/gestao/ReadOnlyConversationDrawer";
import { MergeConversationModal } from "../../components/gestao/MergeConversationModal";
import { GestaoTransferModal } from "../../components/gestao/GestaoTransferModal";
import { useNow } from "../../hooks/useNow";
import { formatActivity } from "../../lib/formatActivity";
import { STATUS_COLOR, STATUS_LABEL } from "../../lib/conversationStatus";
import { toastWithUndo } from "../../lib/undoToast";

// Same "still active" scope the backend enforces (see
// assignConversationFromGestao/returnConversationToQueue) — CLOSED/ABANDONED
// are terminal, nothing to route there anymore.
const ROUTABLE_STATUSES = new Set<ConversationStatus>(["IN_FLOW", "NEW", "WAITING", "IN_PROGRESS", "TRANSFERRED", "HANDLED_EXTERNALLY"]);
const ALREADY_QUEUED_STATUSES = new Set<ConversationStatus>(["NEW", "WAITING"]);

// Filter chips (each one a group of statuses), with live counts.
const STATUS_CHIPS: { key: string; label: string; statuses: ConversationStatus[] }[] = [
  { key: "flow", label: "No fluxo", statuses: ["IN_FLOW"] },
  { key: "queue", label: "Na fila", statuses: ["NEW", "WAITING"] },
  { key: "inProgress", label: "Em atendimento", statuses: ["IN_PROGRESS", "TRANSFERRED"] },
  { key: "external", label: "Pelo celular", statuses: ["HANDLED_EXTERNALLY"] },
  { key: "closed", label: "Encerradas", statuses: ["CLOSED"] },
  { key: "abandoned", label: "Abandonadas", statuses: ["ABANDONED"] },
];

// Waiting this long (queue, or customer without a reply) turns amber, then red.
const WAIT_WARNING_MINUTES = 5;
const WAIT_DANGER_MINUTES = 15;

interface AgentOption {
  id: string;
  displayName: string;
}

export default function GestaoPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: "today" });
  const [agentId, setAgentId] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTransferring, setBulkTransferring] = useState(false);
  const now = useNow();
  const [search, setSearch] = useState("");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<ConversationListItemDTO | null>(null);
  const [merging, setMerging] = useState<ConversationListItemDTO | null>(null);
  const [transferring, setTransferring] = useState<ConversationListItemDTO[] | null>(null);
  const [closing, setClosing] = useState<ConversationListItemDTO | null>(null);
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");
  // Transferir/Enviar p/ fila hit /conversations/:id/gestao-transfer and
  // /gestao-return-to-queue, both gated backend-side by GESTAO_GERENCIAR on
  // top of the GESTAO_ACESSAR umbrella already required to reach this page
  // — see PROMPT: "Mapeie todos os menus e o que tem dentro dos menus e
  // inclua nas permissões".
  const canManage = useAuthStore((s) => s.permissions?.[PERMISSION.GESTAO_GERENCIAR]);
  const queryClient = useQueryClient();

  // Deep link from the Dashboard's Aguardando/Em atendimento/Encerradas
  // cards (?status=a,b&period=...&from=...&to=...) — status may carry more
  // than one value (Em atendimento = IN_PROGRESS + TRANSFERRED), joined
  // with a comma since this page's own filter is a single <select>; it just
  // won't show a matching option when more than one status came in, same
  // as "Todos os status" would. See PROMPT: "direcionado para a tela de
  // gestão, já aplicado o filtro do período do dashboard e o filtro do card".
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const statusParam = searchParams.get("status");
    const periodParam = searchParams.get("period");
    // ?open=<id> from the Ctrl+K palette: open that conversation read-only.
    const openParam = searchParams.get("open");
    if (openParam) {
      api
        .get<ConversationListItemDTO>(`/conversations/${openParam}`)
        .then((res) => setSelected(res.data))
        .catch((err) => toast.error(getApiErrorMessage(err)));
    }
    if (!statusParam && !periodParam && !openParam) return;
    if (statusParam) setStatus(statusParam);
    if (periodParam) {
      setPeriod({
        period: periodParam as PeriodValue["period"],
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
      });
    } else if (statusParam) {
      // The Dashboard's "Aguardando" card carries no period on purpose — it is what is waiting
      // right now, whatever day it arrived — so it must not be narrowed to the page's default "Hoje".
      setPeriod({ period: "all" });
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("status");
        next.delete("period");
        next.delete("from");
        next.delete("to");
        next.delete("open");
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: async () => (await api.get<AgentOption[]>("/agents")).data,
  });

  const returnToQueueMutation = useMutation({
    mutationFn: (conversationId: string) => api.post(`/conversations/${conversationId}/gestao-return-to-queue`),
    onSuccess: (_res, conversationId) => {
      toastWithUndo("Conversa enviada para a fila.", conversationId, queryClient);
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: ({ conversationId, sendClosingMessage }: { conversationId: string; sendClosingMessage: boolean }) =>
      api.post(`/conversations/${conversationId}/gestao-close`, { sendClosingMessage }),
    onSuccess: (_res, { conversationId }) => {
      toastWithUndo("Atendimento encerrado.", conversationId, queryClient);
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
      setClosing(null);
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["oversight", period, agentId, search, connectionIds],
    queryFn: async () =>
      (
        await api.get<ConversationListItemDTO[]>("/conversations/oversight", {
          params: {
            // The period itself — the API turns "hoje", "este mês"... into dates in this browser's time zone
            // (same rule as the Dashboard and Relatórios); only "personalizado" carries from/to, and
            // "Todo o período" sends nothing. Leaving `period` out used to list everything under "Hoje".
            period: period.period === "all" ? undefined : period.period,
            tzOffsetMinutes: new Date().getTimezoneOffset(),
            from: period.from,
            to: period.to,
            agentId: agentId === "all" ? undefined : agentId,
            q: search || undefined,
            connectionId: connectionIds.length ? connectionIds : undefined,
          },
        })
      ).data,
  });

  // Status is filtered here (not server-side) so every chip can show its count.
  const statusSet = status === "all" ? null : new Set(status.split(","));
  const visible = (conversations ?? []).filter((c) => !statusSet || statusSet.has(c.status));
  const countFor = (statuses: ConversationStatus[]) => (conversations ?? []).filter((c) => statuses.includes(c.status)).length;
  const selectable = visible.filter((c) => canManage && ROUTABLE_STATUSES.has(c.status));
  const selectedRows = visible.filter((c) => selectedIds.has(c.id));
  const allSelected = selectable.length > 0 && selectable.every((c) => selectedIds.has(c.id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function waitInfo(c: ConversationListItemDTO): { label: string; minutes: number } | null {
    if (c.status === "NEW" || c.status === "WAITING") {
      const minutes = (now - new Date(c.enteredQueueAt).getTime()) / 60_000;
      return { label: formatDistanceToNow(new Date(c.enteredQueueAt), { locale: ptBR }), minutes };
    }
    // "Atendido pelo celular" too: the customer's new messages stay on that row and never reach the
    // queue, so this is how a manager sees someone has been left waiting on the phone.
    if (c.awaitingReplySince && (c.status === "IN_PROGRESS" || c.status === "TRANSFERRED" || c.status === "HANDLED_EXTERNALLY")) {
      const minutes = (now - new Date(c.awaitingReplySince).getTime()) / 60_000;
      return { label: `sem resposta há ${formatDistanceToNow(new Date(c.awaitingReplySince), { locale: ptBR })}`, minutes };
    }
    return null;
  }

  const bulkReturnMutation = useMutation({
    mutationFn: async (rows: ConversationListItemDTO[]) => {
      const targets = rows.filter((c) => !ALREADY_QUEUED_STATUSES.has(c.status));
      const results = await Promise.allSettled(targets.map((c) => api.post(`/conversations/${c.id}/gestao-return-to-queue`)));
      return { ok: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok) toast.success(`${ok} ${ok === 1 ? "conversa enviada" : "conversas enviadas"} para a fila.`);
      if (failed) toast.error(`${failed} não puderam ser enviadas para a fila.`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["oversight"] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  return (
    <div className="flex h-full flex-col overflow-hidden p-3 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PeriodFilter value={period} onChange={setPeriod} allowAll />

        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="focus-ring rounded-card border border-border bg-surface px-3 py-2 text-sm">
          <option value="all">Todos os atendentes</option>
          {agents?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </select>

        <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-card border border-border bg-surface px-3 py-2 text-sm focus-within:border-primary/50">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
          />
        </label>

        <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
        {[{ key: "all", label: "Todas", statuses: [] as ConversationStatus[] }, ...STATUS_CHIPS].map((chip) => {
          const value = chip.key === "all" ? "all" : chip.statuses.join(",");
          const count = chip.key === "all" ? (conversations?.length ?? 0) : countFor(chip.statuses);
          const active = status === value;
          return (
            <button
              key={chip.key}
              onClick={() => {
                setStatus(value);
                setSelectedIds(new Set());
              }}
              aria-pressed={active}
              className={clsx(
                "focus-ring rounded-full border px-3 py-1 text-xs font-medium",
                active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted hover:text-[var(--color-text)]",
                chip.key === "queue" && count > 0 && !active && "border-warning/40 text-warning"
              )}
            >
              {chip.label} · {count}
            </button>
          );
        })}
      </div>

      {selectedRows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card bg-[var(--color-text)] px-3 py-2 text-sm text-surface">
          <span className="font-medium">
            {selectedRows.length} {selectedRows.length === 1 ? "selecionada" : "selecionadas"}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => setBulkTransferring(true)}
            className="focus-ring flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Transferir
          </button>
          <button
            onClick={() => bulkReturnMutation.mutate(selectedRows)}
            disabled={bulkReturnMutation.isPending || selectedRows.every((c) => ALREADY_QUEUED_STATUSES.has(c.status))}
            className="focus-ring flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
          >
            <Inbox className="h-3.5 w-3.5" /> {bulkReturnMutation.isPending ? "Enviando..." : "Devolver para a fila"}
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="focus-ring rounded-lg p-1 hover:bg-white/10" aria-label="Limpar seleção">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="shadow-soft flex-1 overflow-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-alt text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-10 px-4 py-3">
                {canManage && (
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={() => setSelectedIds(allSelected ? new Set() : new Set(selectable.map((c) => c.id)))}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                )}
              </th>
              <th className="px-3 py-3">Cliente</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Atendente</th>
              <th className="px-3 py-3">Conexão</th>
              <th className="px-3 py-3">Esperando</th>
              <th className="px-3 py-3">Última atividade</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  Nenhuma conversa encontrada para os filtros selecionados.
                </td>
              </tr>
            )}
            {visible.map((c) => {
              const wait = waitInfo(c);
              const isSelected = selectedIds.has(c.id);
              return (
              <tr key={c.id} className={clsx("border-t border-border", isSelected ? "bg-primary/[0.07]" : "hover:bg-surface-alt")}>
                <td className="px-4 py-3">
                  {canManage && ROUTABLE_STATUSES.has(c.status) && (
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${contactDisplayName(c.contact)}`}
                      checked={isSelected}
                      onChange={() => toggleRow(c.id)}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                  )}
                </td>
                <td className="px-3 py-3">
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
                <td className="px-3 py-3">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                </td>
                <td className="px-3 py-3">{c.assignedAgentName ?? <span className="text-muted">—</span>}</td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted">
                    <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c.whatsappConnectionColor }} />
                    {c.whatsappConnectionName}
                  </span>
                </td>
                <td
                  className={clsx(
                    "whitespace-nowrap px-3 py-3 text-xs tabular-nums",
                    !wait
                      ? "text-muted"
                      : wait.minutes >= WAIT_DANGER_MINUTES
                        ? "font-semibold text-danger"
                        : wait.minutes >= WAIT_WARNING_MINUTES
                          ? "font-semibold text-warning"
                          : "text-muted"
                  )}
                  title={`Entrou na fila ${formatDistanceToNow(new Date(c.enteredQueueAt), { locale: ptBR, addSuffix: true })}${c.acceptedAt ? ` · aceita ${formatDistanceToNow(new Date(c.acceptedAt), { locale: ptBR, addSuffix: true })}` : ""}`}
                >
                  {wait?.label ?? "—"}
                </td>
                <td className="max-w-[220px] px-3 py-3 text-xs text-muted">
                  <div className="truncate">{c.lastMessagePreview ?? "—"}</div>
                  <div className="text-[11px] opacity-75">{formatActivity(c.lastMessageAt, now)}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
                    {canManage && ROUTABLE_STATUSES.has(c.status) && (
                      <button
                        onClick={() => setTransferring([c])}
                        className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-primary"
                        title="Transferir para outro atendente"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        <span className="sr-only">Transferir</span>
                      </button>
                    )}
                    {canManage && ROUTABLE_STATUSES.has(c.status) && !ALREADY_QUEUED_STATUSES.has(c.status) && (
                      <button
                        onClick={() => returnToQueueMutation.mutate(c.id)}
                        disabled={returnToQueueMutation.isPending}
                        className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-primary disabled:opacity-50"
                        title="Enviar de volta para a fila, sem atendente"
                      >
                        <Inbox className="h-4 w-4" />
                        <span className="sr-only">Enviar para a fila</span>
                      </button>
                    )}
                    {canManage && ROUTABLE_STATUSES.has(c.status) && (
                      <button
                        onClick={() => setClosing(c)}
                        className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-primary"
                        title="Encerrar este atendimento"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="sr-only">Encerrar</span>
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setMerging(c)}
                        className="focus-ring rounded-lg p-1.5 text-muted hover:bg-surface-alt hover:text-primary"
                        title="Mesclar esta conversa duplicada com outra"
                      >
                        <GitMerge className="h-4 w-4" />
                        <span className="sr-only">Mesclar</span>
                      </button>
                    )}
                    <button onClick={() => setSelected(c)} className="focus-ring ml-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10">
                      <Eye className="h-3.5 w-3.5" /> Visualizar
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-muted">
        Mostrando {visible.length} de {conversations?.length ?? 0} {conversations?.length === 1 ? "conversa" : "conversas"}
      </p>

      {selected && <ReadOnlyConversationDrawer key={selected.id} conversation={selected} onClose={() => setSelected(null)} />}

      {merging && (
        <MergeConversationModal
          conversation={merging}
          onClose={() => setMerging(null)}
          onMerged={() => setMerging(null)}
        />
      )}

      {(transferring || bulkTransferring) && (
        <GestaoTransferModal
          conversations={transferring ?? selectedRows}
          onClose={() => {
            setTransferring(null);
            setBulkTransferring(false);
          }}
          onTransferred={() => {
            if (bulkTransferring) setSelectedIds(new Set());
            setTransferring(null);
            setBulkTransferring(false);
          }}
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
