import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Phone } from "lucide-react";
import type { ConversationListItemDTO, MessageDTO, PaginatedResult } from "@whatsatendende/types";
import { api } from "../../lib/api";
import { MessageBubble } from "../atendimento/MessageBubble";

async function fetchMessages(conversationId: string, cursor?: string) {
  const res = await api.get<PaginatedResult<MessageDTO>>(`/messages/conversations/${conversationId}`, {
    params: { cursor, limit: 100 },
  });
  return res.data;
}

export function ReadOnlyConversationDrawer({
  conversation,
  onClose,
}: {
  conversation: ConversationListItemDTO;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);

  const messagesQuery = useQuery({
    queryKey: ["oversight-messages", conversation.id],
    queryFn: () => fetchMessages(conversation.id),
  });

  useEffect(() => {
    if (!messagesQuery.data) return;
    setMessages((prev) => (prev.length === 0 ? messagesQuery.data.items : prev));
    setCursor((prev) => prev ?? messagesQuery.data.nextCursor ?? undefined);
  }, [messagesQuery.data]);

  useEffect(() => {
    if (isFirstLoad.current && messages.length > 0) {
      scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight });
      isFirstLoad.current = false;
    }
  }, [messages]);

  // Automatically keeps paging through history until it's all loaded, same
  // as ChatPanel's own conversation view — see PROMPT: "trazer todo o
  // histórico das conversas quando é aberta". Paced with a short delay
  // between pages rather than firing every request back-to-back — a very
  // long conversation could otherwise mean dozens of requests bursting in
  // the same instant against the single API process that is also running
  // the live WhatsApp connection.
  useEffect(() => {
    if (!cursor) return;
    const timer = setTimeout(() => {
      const container = scrollContainerRef.current;
      const prevScrollHeight = container?.scrollHeight ?? 0;
      const prevScrollTop = container?.scrollTop ?? 0;
      fetchMessages(conversation.id, cursor).then((page) => {
        setMessages((prev) => [...page.items, ...prev]);
        setCursor(page.nextCursor ?? undefined);
        requestAnimationFrame(() => {
          if (!container) return;
          container.scrollTop = prevScrollTop + (container.scrollHeight - prevScrollHeight);
        });
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, conversation.id]);

  const isLoading = messagesQuery.isLoading;
  const displayName = conversation.contact.name || conversation.contact.phone;
  const messageById = new Map(messages.map((m) => [m.id, m]));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      {/* Mirrors ChatPanel's own header/message-list styling so oversight
          shows a conversation exactly as it looks in Atendimento — just
          without the composer, since gestores only watch. */}
      <div className="flex h-full w-full max-w-lg flex-col bg-surface shadow-elevated">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-surface-alt text-sm font-semibold text-muted">
              {conversation.contact.photoUrl ? (
                <img src={conversation.contact.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">{displayName.slice(0, 2).toUpperCase()}</div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="flex items-center gap-1 text-xs text-muted">
                <Phone className="h-3 w-3" /> {conversation.contact.phone} · Atendente: {conversation.assignedAgentName ?? "-"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="focus-ring shrink-0 rounded-full p-1.5 text-muted hover:bg-surface-alt" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={scrollContainerRef} className="flex-1 space-y-3 overflow-y-auto bg-[var(--color-bg)] px-4 py-4">
          {(isLoading || cursor) && <p className="text-center text-sm text-muted">Carregando histórico...</p>}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              readOnly
              onReply={() => undefined}
              onReact={() => undefined}
              repliedMessage={m.replyToMessageId ? messageById.get(m.replyToMessageId) : undefined}
            />
          ))}
        </div>

        <div className="border-t border-border px-5 py-3 text-center text-xs text-muted">
          Modo de visualização — gestores não podem interagir nesta conversa.
        </div>
      </div>
    </div>
  );
}
