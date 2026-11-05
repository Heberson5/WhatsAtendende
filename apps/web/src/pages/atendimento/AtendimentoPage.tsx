import { useEffect, useState } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Inbox, Plus, Radio, Users2 } from "lucide-react";
import type { ConversationListItemDTO } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { ConversationCard } from "../../components/atendimento/ConversationCard";
import { ChatPanel } from "../../components/atendimento/ChatPanel";
import { ConnectionFilter } from "../../components/common/ConnectionFilter";
import { NovaConversaModal } from "../../components/atendimento/NovaConversaModal";
import { useActiveConversationStore } from "../../store/active-conversation-store";
import { useAuthStore } from "../../store/auth-store";
import { useDraftStore } from "../../store/draft-store";
import { useMediaDraftStore } from "../../store/media-draft-store";
import { useEscapeKey } from "../../hooks/useEscapeKey";

export default function AtendimentoPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"queue" | "mine">("mine");
  const [connectionIds, setConnectionIds] = useState<string[]>([]);
  const [novaConversaOpen, setNovaConversaOpen] = useState(false);
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setActiveConversationId = useActiveConversationStore((s) => s.setActiveConversationId);
  // AGENT always attends a single fixed connection — the server ignores
  // this filter for them anyway — so only MANAGER/ADMIN, who see every
  // connection's queue combined by default, get the filter UI at all.
  const canFilterByConnection = user?.role === "MANAGER" || user?.role === "ADMIN";
  const hasFixedConnection = Boolean(user?.whatsappConnectionName);
  // The connection the top banner is already warning about — its cards skip their own "Conexão desconectada" badge.
  const bannerConnectionId = hasFixedConnection && user?.whatsappConnectionStatus !== "CONNECTED" ? (user?.whatsappConnectionId ?? null) : null;
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false);

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

  // Drafts (text, a paused recording, files waiting) of conversations that left this person's list are dropped.
  useEffect(() => {
    if (!user?.id || !mineQuery.data) return;
    const ids = mineQuery.data.map((c) => c.id);
    useDraftStore.getState().prune(user.id, ids);
    useMediaDraftStore.getState().prune(user.id, ids);
  }, [user?.id, mineQuery.data]);

  // Esc closes the open conversation exactly like clicking its card again, even with the cursor in the message box:
  // the text stays as the draft, and a recording or files waiting in the preview are kept too (the Composer pauses
  // them into a draft, WhatsApp-style). It's the bottom Esc layer (hooks/useEscapeKey): anything opened over the
  // conversation — transfer, the picture viewer, the emoji panel — closes first, and fields with an Esc of their own
  // (the search in the conversation, the quick-reply list) take it before this.
  function closeOpenChat() {
    const cardId = selectedId;
    setSelectedId(null);
    // Focus back on the card it came from, so the keyboard carries on from the list.
    if (cardId) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardId)}"]`)?.focus());
  }
  useEscapeKey(closeOpenChat, Boolean(selectedConversation));

  return (
    <div className="grid h-full overflow-hidden md:grid-cols-[340px_1fr]">
      <div
        className={clsx(
          "flex-col overflow-hidden border-r border-border bg-surface md:flex",
          selectedConversation ? "hidden" : "flex"
        )}
      >
        {bannerConnectionId && (
          <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" role="status">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-hidden />
              <strong className="min-w-0 truncate font-semibold">WhatsApp desconectado</strong>
              <button
                type="button"
                onClick={() => setConnectionDetailsOpen((open) => !open)}
                aria-expanded={connectionDetailsOpen}
                className="focus-ring ml-auto shrink-0 rounded font-semibold underline underline-offset-2"
              >
                {connectionDetailsOpen ? "Ocultar" : "Detalhes"}
              </button>
            </div>
            {connectionDetailsOpen && (
              <p className="mt-1.5 font-medium">
                Sua conexão de WhatsApp está desconectada — não é possível enviar mensagens nem aceitar conversas até que ela seja reconectada. Avise um administrador.
              </p>
            )}
          </div>
        )}
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-alt px-3 py-2">
          {canFilterByConnection ? (
            <div className="flex-1">
              <ConnectionFilter value={connectionIds} onChange={setConnectionIds} />
            </div>
          ) : (
            <span className="flex flex-1 items-center gap-1.5 text-xs font-medium text-muted">
              <Radio className="h-3.5 w-3.5 text-primary" /> Conexão: {user?.whatsappConnectionName}
            </span>
          )}
          <button
            onClick={() => setNovaConversaOpen(true)}
            className="focus-ring flex shrink-0 items-center gap-1 rounded-card bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-fg hover:opacity-90"
            title="Iniciar nova conversa a partir dos contatos do WhatsApp"
          >
            <Plus className="h-3.5 w-3.5" /> Nova conversa
          </button>
        </div>
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("mine")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium ${tab === "mine" ? "border-b-2 border-primary text-primary" : "text-muted"}`}
          >
            <Users2 className="h-4 w-4" /> Ativos ({mineQuery.data?.length ?? 0})
          </button>
          <button
            onClick={() => setTab("queue")}
            className={`flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium ${tab === "queue" ? "border-b-2 border-primary text-primary" : "text-muted"}`}
          >
            <Inbox className="h-4 w-4" /> Fila ({queueQuery.data?.length ?? 0})
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {tab === "mine" &&
            (mineQuery.data?.length ? (
              mineQuery.data.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  connectionWarningShown={c.whatsappConnectionId === bannerConnectionId}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId((current) => (current === c.id ? null : c.id))}
                />
              ))
            ) : (
              <EmptyState message="Nenhum atendimento em andamento." />
            ))}

          {tab === "queue" &&
            (queueQuery.data?.length ? (
              queueQuery.data.map((c) => (
                <ConversationCard
                  key={c.id}
                  conversation={c}
                  connectionWarningShown={c.whatsappConnectionId === bannerConnectionId}
                  onAccept={() => acceptMutation.mutate(c.id)}
                  accepting={acceptMutation.isPending && acceptMutation.variables === c.id}
                />
              ))
            ) : (
              <EmptyState message="Nenhuma conversa aguardando." />
            ))}
        </div>
      </div>

      <div className={clsx("overflow-hidden bg-[var(--color-bg)]", selectedConversation ? "block" : "hidden md:block")}>
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
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            Selecione um atendimento para visualizar a conversa
          </div>
        )}
      </div>

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
  return <p className="px-2 py-8 text-center text-sm text-muted">{message}</p>;
}
