import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, Phone } from "lucide-react";
import type { ConversationListItemDTO, MessageDTO, PaginatedResult } from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { getSocket } from "../../lib/socket";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { TransferModal } from "./TransferModal";

async function fetchMessages(conversationId: string, cursor?: string) {
  const res = await api.get<PaginatedResult<MessageDTO>>(`/messages/conversations/${conversationId}`, {
    params: { cursor, limit: 30 },
  });
  return res.data;
}

export function ChatPanel({ conversation, onClosed, onBack }: { conversation: ConversationListItemDTO; onClosed: () => void; onBack?: () => void }) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);

  const messagesQuery = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: () => fetchMessages(conversation.id),
  });

  const markReadMutation = useMutation({
    mutationFn: () => api.post(`/conversations/${conversation.id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mine"] }),
  });

  useEffect(() => {
    isFirstLoad.current = true;
    setMessages([]);
    setCursor(undefined);
    // Opening a conversation clears its unread badge.
    markReadMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // While the conversation stays open, any further inbound message is
  // immediately marked read too — the agent is already looking at it live.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversation.id) markReadMutation.mutate();
    };
    socket.on("message:new", handler);
    return () => {
      socket.off("message:new", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  useEffect(() => {
    if (!messagesQuery.data) return;
    // A realtime event (new message, status change) invalidates this query
    // and it silently refetches page 1 (the most recent messages) in the
    // background. Replacing `messages` wholesale on every such refetch would
    // discard any older history the agent had already loaded by scrolling up
    // via loadOlder — so only replace outright on the very first load for
    // this conversation; afterwards, upsert page 1 into what's already there.
    setMessages((prev) => {
      if (prev.length === 0) return messagesQuery.data.items;
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of messagesQuery.data.items) byId.set(m.id, m);
      return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    setCursor((prev) => prev ?? messagesQuery.data.nextCursor ?? undefined);
  }, [messagesQuery.data]);

  useEffect(() => {
    if (isFirstLoad.current && messages.length > 0) {
      bottomRef.current?.scrollIntoView();
      isFirstLoad.current = false;
    }
  }, [messages]);

  async function loadOlder() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchMessages(conversation.id, cursor);
      setMessages((prev) => [...page.items, ...prev]);
      setCursor(page.nextCursor ?? undefined);
    } finally {
      setLoadingMore(false);
    }
  }

  const sendTextMutation = useMutation({
    mutationFn: (input: { body: string; replyToMessageId?: string }) =>
      api.post(`/messages/conversations/${conversation.id}/text`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] }),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const sendFileMutation = useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption?: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (caption) form.append("caption", caption);
      return api.post(`/messages/conversations/${conversation.id}/file`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] }),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const sendLocationMutation = useMutation({
    mutationFn: (input: { latitude: number; longitude: number }) =>
      api.post(`/messages/conversations/${conversation.id}/location`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] }),
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const reactMutation = useMutation({
    mutationFn: (input: { messageId: string; emoji: string | null }) =>
      api.post(`/messages/${input.messageId}/reaction`, { emoji: input.emoji }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages", conversation.id] }),
  });

  const transferMutation = useMutation({
    mutationFn: (input: { toAgentId: string; note: string }) =>
      api.post(`/conversations/${conversation.id}/transfer`, input),
    onSuccess: () => {
      toast.success("Conversa transferida com sucesso.");
      onClosed();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.post(`/conversations/${conversation.id}/close`),
    onSuccess: () => {
      toast.success("Atendimento encerrado.");
      onClosed();
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  const displayName = conversation.contact.name || conversation.contact.phone;
  const messageById = new Map(messages.map((m) => [m.id, m]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="focus-ring shrink-0 rounded-full p-1.5 text-muted hover:bg-surface-alt md:hidden"
              aria-label="Voltar para a lista de atendimentos"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-alt text-sm font-semibold text-muted">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="flex items-center gap-1 text-xs text-muted">
              <Phone className="h-3 w-3" /> {conversation.contact.phone}
            </p>
          </div>
          {conversation.transfer && (
            <span className="rounded-full bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-secondary-fg">
              TRANSFERIDO por {conversation.transfer.fromAgentName}
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setTransferOpen(true)}
            className="focus-ring flex items-center gap-1.5 rounded-card border border-border px-2 py-1.5 text-xs font-medium hover:bg-surface-alt sm:px-3"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Transferir</span>
          </button>
          <button
            onClick={() => setCloseConfirmOpen(true)}
            className="focus-ring flex items-center gap-1.5 rounded-card bg-primary px-2 py-1.5 text-xs font-medium text-primary-fg hover:opacity-90 sm:px-3"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Encerrar</span>
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {cursor && (
          <div className="text-center">
            <button onClick={loadOlder} disabled={loadingMore} className="focus-ring text-xs text-primary hover:underline">
              {loadingMore ? "Carregando..." : "Carregar mensagens anteriores"}
            </button>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            repliedMessage={message.replyToMessageId ? messageById.get(message.replyToMessageId) : undefined}
            onReply={setReplyTo}
            onReact={(m, emoji) => reactMutation.mutate({ messageId: m.id, emoji })}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <Composer
        disabled={sendTextMutation.isPending}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSendText={async (text, replyToMessageId) => {
          await sendTextMutation.mutateAsync({ body: text, replyToMessageId });
        }}
        onSendFile={async (file, caption) => {
          await sendFileMutation.mutateAsync({ file, caption });
        }}
        onSendLocation={async (lat, lng) => {
          await sendLocationMutation.mutateAsync({ latitude: lat, longitude: lng });
        }}
      />

      {transferOpen && (
        <TransferModal
          onClose={() => setTransferOpen(false)}
          onConfirm={async (agentId, note) => {
            await transferMutation.mutateAsync({ toAgentId: agentId, note });
          }}
        />
      )}

      {closeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-card border border-border bg-surface p-5 shadow-elevated">
            <h2 className="text-base font-semibold">Encerrar atendimento?</h2>
            <p className="mt-2 text-sm text-muted">
              Esta ação encerra a conversa com {displayName}. O histórico permanece disponível na gestão.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setCloseConfirmOpen(false)} className="focus-ring flex-1 rounded-card border border-border py-2 text-sm">
                Cancelar
              </button>
              <button
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                className="focus-ring flex-1 rounded-card bg-primary py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
              >
                {closeMutation.isPending ? "Encerrando..." : "Encerrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
