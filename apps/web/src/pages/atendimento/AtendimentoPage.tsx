import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessagesSquare, Plus, Radio, Search } from "lucide-react";
import type { ConversationListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { ConversationCard, minutesWaiting, NO_REPLY_WARNING_MINUTES } from "../../components/atendimento/ConversationCard";
import { ClientPanel } from "../../components/atendimento/ClientPanel";
import { contactDisplayName } from "../../lib/contact-display";
import { useNow } from "../../hooks/useNow";
import { ChatPanel } from "../../components/atendimento/ChatPanel";
import { ReadOnlyConversationDrawer } from "../../components/gestao/ReadOnlyConversationDrawer";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { NovaConversaModal } from "../../components/atendimento/NovaConversaModal";
import { useActiveConversationStore } from "../../store/active-conversation-store";
import { useAuthStore } from "../../store/auth-store";

const CLIENT_PANEL_KEY = "client-panel-collapsed";
// Below this width the chat needs the room, so the panel starts collapsed.
const CLIENT_PANEL_AUTO_COLLAPSE_PX = 1280;

function readClientPanelCollapsed() {
  try {
    const stored = localStorage.getItem(CLIENT_PANEL_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // storage blocked: fall back to the screen-size default
  }
  return window.innerWidth < CLIENT_PANEL_AUTO_COLLAPSE_PX;
}

type ListFilter = "all" | "unread" | "noReply";

export default function AtendimentoPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "mine" | "transferred">("mine");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [novaConversaOpen, setNovaConversaOpen] = useState(false);
  const [listSearch, setListSearch] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [clientPanelCollapsed, setClientPanelCollapsed] = useState(readClientPanelCollapsed);
  const now = useNow();
  function toggleClientPanel() {
    setClientPanelCollapsed((c) => {
      try {
        localStorage.setItem(CLIENT_PANEL_KEY, c ? "0" : "1");
      } catch {
        // storage blocked: the choice just won't persist
      }
      return !c;
    });
  }
  // A transferred-out conversation opens read-only (ReadOnlyConversationDrawer,
  // variant="inline") in the SAME right-column slot ChatPanel normally
  // fills — not a floating overlay like Gestão's own use of that
  // component — it's no longer this agent's to act on, only to watch. Kept
  // as a separate piece of state from selectedId (the two are mutually
  // exclusive, cleared of each other wherever either is set) rather than
  // reusing it, since a transferred-out row isn't in mineQuery's data at
  // all. See PROMPT: "possa abrir a conversa para acompanhar em tempo real
  // sem poder interferir" and "a tela de visualizar as conversas em Transf,
  // deve abrir normalmente... sem as funções de interagir, transferência e
  // encerramento".
  const [watchingConversation, setWatchingConversation] = useState<ConversationListItemDTO | null>(null);
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setActiveConversationId = useActiveConversationStore((s) => s.setActiveConversationId);
  // AGENT always attends a single fixed connection — the server ignores
  // this filter for them anyway — so only MANAGER/ADMIN, who see every
  // connection's queue combined by default, get the filter UI at all.
  const canFilterByConnection = user?.role === "MANAGER" || user?.role === "ADMIN";
  const hasFixedConnection = Boolean(user?.whatsappConnectionName);

  // Realtime listening itself (toasts, desktop notifications, the socket
  // room join that keeps an open chat live) now lives in AppLayout so it
  // keeps working on every screen, not just this one — this just publishes
  // which conversation is currently open here so that global listener can
  // still skip the redundant toast for a message already visible live.
  // Cleared on unmount (leaving Atendimento entirely) so a stale id doesn't
  // keep suppressing that conversation's notifications from another page.
  useEffect(() => {
    setActiveConversationId(selectedId);
    return () => setActiveConversationId(null);
  }, [selectedId, setActiveConversationId]);

  const queueQuery = useQuery({
    queryKey: ["queue", connectionIds],
    queryFn: async () =>
      (
        await api.get<ConversationListItemDTO[]>("/conversations/queue", {
          params: { connectionId: canFilterByConnection && connectionIds.length ? connectionIds : undefined },
        })
      ).data,
    refetchInterval: 20_000,
  });

  const mineQuery = useQuery({
    queryKey: ["mine"],
    queryFn: async () => (await api.get<ConversationListItemDTO[]>("/conversations/mine")).data,
    refetchInterval: 20_000,
  });

  // Deep link from the notification bell (?open=<conversationId>) — both
  // notification types (new message, transfer received) only ever point at
  // a conversation this agent already owns, so "Ativos" is always the
  // right place to select it. See PROMPT: "ao clicar em cima de alguma,
  // será direcionado para o local".
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const openId = searchParams.get("open");
    if (!openId || !mineQuery.data) return;
    if (mineQuery.data.some((c) => c.id === openId)) {
      setWatchingConversation(null);
      setSelectedId(openId);
      setTab("mine");
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("open");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, mineQuery.data]);

  const transferredOutQuery = useQuery({
    queryKey: ["transferred-out"],
    queryFn: async () => (await api.get<ConversationListItemDTO[]>("/conversations/transferred-out")).data,
    refetchInterval: 20_000,
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => api.post(`/conversations/${id}/accept`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["mine"] });
      setSelectedId(id);
      setTab("mine");
      toast.success("Conversa aceita. Ela agora é sua com exclusividade.");
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, "Esta conversa já foi assumida por outro atendente."));
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const selectedConversation = mineQuery.data?.find((c) => c.id === selectedId) ?? null;
  // Highlights the Fila tab itself (not just its count) while there's at
  // least one conversation still waiting to be accepted — so an agent
  // parked on "Ativos" notices without having to switch tabs. Goes back to
  // the plain look the instant the queue empties out (accepted/transferred/
  // returned elsewhere), same as the count already does today. See PROMPT:
  // "destaque maior em filas... quando não tem conversas pendentes...
  // continue normalmente sem um destaque".
  const queueCount = queueQuery.data?.length ?? 0;
  const queueHasPending = queueCount > 0;

  const matchesSearch = (c: ConversationListItemDTO) => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return true;
    return contactDisplayName(c.contact, c.channel).toLowerCase().includes(q) || (c.contact.phone ?? "").includes(q.replace(/\D/g, "") || q);
  };
  const mine = mineQuery.data ?? [];
  const unreadCount = mine.filter((c) => c.unreadCount > 0).length;
  const noReplyCount = mine.filter((c) => minutesWaiting(c, now) >= NO_REPLY_WARNING_MINUTES).length;
  const visibleMine = mine.filter(
    (c) =>
      matchesSearch(c) &&
      (listFilter === "all" || (listFilter === "unread" ? c.unreadCount > 0 : minutesWaiting(c, now) >= NO_REPLY_WARNING_MINUTES))
  );
  const visibleQueue = (queueQuery.data ?? []).filter(matchesSearch);
  const visibleTransferred = (transferredOutQuery.data ?? []).filter(matchesSearch);
  const panelConversation = selectedConversation ?? watchingConversation;

  const tabs = [
    { value: "mine" as const, label: "Meus", count: mine.length },
    { value: "queue" as const, label: "Fila", count: queueCount },
    { value: "transferred" as const, label: "Transf.", count: transferredOutQuery.data?.length ?? 0 },
  ];

  return (
    <div
      className={clsx(
        "grid h-full overflow-hidden",
        panelConversation
          ? clientPanelCollapsed
            ? "md:grid-cols-[320px_1fr_auto]"
            : "md:grid-cols-[300px_1fr_260px] xl:grid-cols-[320px_1fr_280px]"
          : "md:grid-cols-[320px_1fr]"
      )}
    >
      <div
        className={clsx(
          "flex-col overflow-hidden border-r border-border bg-surface md:flex",
          selectedConversation || watchingConversation ? "hidden" : "flex"
        )}
      >
        {hasFixedConnection && user?.whatsappConnectionStatus !== "CONNECTED" && (
          <div className="border-b border-danger/20 bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
            Sua conexão de WhatsApp está desconectada — não é possível enviar mensagens nem aceitar conversas até que ela seja reconectada. Avise um administrador.
          </div>
        )}
        <div className="space-y-2.5 border-b border-border px-3 pb-3 pt-3">
          <div className="flex items-center gap-1.5">
            {canFilterByConnection ? (
              <div className="min-w-0 flex-1">
                <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
              </div>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs font-medium text-muted">
                <Radio className="h-3.5 w-3.5 shrink-0 text-primary" /> Conexão: {user?.whatsappConnectionName}
              </span>
            )}
            <button
              onClick={() => setNovaConversaOpen(true)}
              className="focus-ring flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90"
              title="Iniciar nova conversa a partir dos contatos do WhatsApp"
            >
              <Plus className="h-3.5 w-3.5" /> Nova conversa
            </button>
          </div>

          <div className="grid grid-cols-3 rounded-[10px] border border-border bg-surface-alt p-[3px]" role="tablist" aria-label="Conversas">
            {tabs.map((t) => {
              const highlightQueue = t.value === "queue" && queueHasPending;
              return (
                <button
                  key={t.value}
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={clsx(
                    "focus-ring flex items-center justify-center gap-1.5 rounded-[7px] py-1.5 text-[13px] font-medium transition-colors",
                    tab === t.value ? "bg-surface font-semibold text-[var(--color-text)] shadow-sm" : "text-muted hover:text-[var(--color-text)]"
                  )}
                >
                  {t.label}
                  <span
                    className={clsx(
                      "rounded-full px-1.5 text-[11px] font-bold",
                      highlightQueue ? "animate-pulse bg-secondary text-secondary-fg" : "bg-border/70 text-muted"
                    )}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-xs text-muted focus-within:border-primary/50">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              placeholder="Buscar nome ou número"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--color-text)] outline-none placeholder:text-muted"
              aria-label="Buscar conversas por nome ou número"
            />
          </label>

          {tab === "mine" && (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { value: "all", label: "Todas", count: mine.length },
                  { value: "unread", label: "Não lidas", count: unreadCount },
                  { value: "noReply", label: "Sem resposta", count: noReplyCount },
                ] as const
              ).map((f) => (
                <button
                  key={f.value}
                  onClick={() => setListFilter(f.value)}
                  aria-pressed={listFilter === f.value}
                  className={clsx(
                    "focus-ring rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium",
                    listFilter === f.value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-[var(--color-text)]",
                    f.value === "noReply" && f.count > 0 && listFilter !== f.value && "border-warning/40 text-warning"
                  )}
                >
                  {f.label} · {f.count}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "mine" &&
            (visibleMine.length ? (
              visibleMine.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  selected={c.id === selectedId}
                  onSelect={() => {
                    setWatchingConversation(null);
                    setSelectedId((current) => (current === c.id ? null : c.id));
                  }}
                />
              ))
            ) : (
              <EmptyState message={mine.length ? "Nenhuma conversa com esse filtro." : "Nenhum atendimento em andamento."} />
            ))}

          {tab === "queue" &&
            (visibleQueue.length ? (
              visibleQueue.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  onAccept={() => acceptMutation.mutate(c.id)}
                  accepting={acceptMutation.isPending && acceptMutation.variables === c.id}
                  agentPaused={user?.presence === "AWAY"}
                />
              ))
            ) : (
              <EmptyState message="Nenhuma conversa aguardando." />
            ))}

          {tab === "transferred" &&
            (visibleTransferred.length ? (
              visibleTransferred.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  transferredOutView
                  selected={c.id === watchingConversation?.id}
                  onSelect={() => {
                    setSelectedId(null);
                    setWatchingConversation(c);
                  }}
                />
              ))
            ) : (
              <EmptyState message="Você ainda não transferiu nenhuma conversa." />
            ))}
        </div>
      </div>

      <div className={clsx("min-w-0 overflow-hidden bg-[var(--color-bg)]", selectedConversation || watchingConversation ? "block" : "hidden md:block")}>
        {selectedConversation ? (
          <ChatPanel
            conversation={selectedConversation}
            onClosed={() => setSelectedId(null)}
            onBack={() => setSelectedId(null)}
            onConversationStarted={(conv) => {
              queryClient.invalidateQueries({ queryKey: ["mine"] });
              setSelectedId(conv.id);
              setTab("mine");
            }}
            clientPanelOpen={!clientPanelCollapsed}
            onToggleClientPanel={toggleClientPanel}
          />
        ) : watchingConversation ? (
          <ReadOnlyConversationDrawer variant="inline" conversation={watchingConversation} onClose={() => setWatchingConversation(null)} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted">
            <MessagesSquare className="h-10 w-10 opacity-30" />
            Selecione um atendimento para visualizar a conversa
          </div>
        )}
      </div>

      {panelConversation && (
        <div className="hidden min-w-0 overflow-hidden md:block">
          <ClientPanel
            key={panelConversation.id}
            conversation={panelConversation}
            collapsed={clientPanelCollapsed}
            onToggle={toggleClientPanel}
            readOnly={!selectedConversation}
          />
        </div>
      )}

      {novaConversaOpen && (
        <NovaConversaModal
          fixedConnectionId={hasFixedConnection ? user!.whatsappConnectionId : null}
          onClose={() => setNovaConversaOpen(false)}
          onStarted={(conversation) => {
            queryClient.invalidateQueries({ queryKey: ["mine"] });
            setSelectedId(conversation.id);
            setTab("mine");
            setNovaConversaOpen(false);
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-10 text-center text-sm text-muted">{message}</p>;
}
